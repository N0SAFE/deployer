#!/usr/bin/env -S bun

import { Glob, Transpiler } from 'bun'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import * as path from 'path'

const __dirname = import.meta.dir
const srcDir = path.join(__dirname, '..', 'src')
const distDir = path.join(__dirname, '..', 'dist')

/**
 * Cleanup function to remove dist directory
 */
function cleanup() {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true })
  }
}

/**
 * Run Bun build for NestJS application
 *
 * THREE entry points, and `compile.ts` is not optional:
 *
 *   main.ts     the server that ships
 *   cli.ts      the database/CLI task runner
 *   compile.ts  the boot check — assembles the whole Nest graph and exits
 *
 * `compile.ts` is BUILT (not just type-checked) so `runCompileCheck` can execute
 * the exact artifact the rest of the build produced. A graph that assembles from
 * source but not from the built output proves nothing.
 */

/**
 * Decorator options that MUST be set explicitly.
 *
 * `emitDecoratorMetadata` is what makes bun write `design:paramtypes`. Nest
 * resolves every plain typed constructor parameter from that metadata, so
 * without it the whole DI graph collapses to `undefined`:
 *
 *   TypeError: undefined is not an object ('this.meshTopology.registerControlEnvelopeHandler')
 *
 * `useDefineForClassFields: false` matches the class-field semantics the source
 * is written for; the ES2022 default (`true`) would define fields AFTER the
 * constructor parameters are assigned and blank them out.
 */
const DECORATOR_TS_CONFIG = {
  compilerOptions: {
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    target: 'ES2022',
    module: 'ES2022',
    useDefineForClassFields: false,
    jsx: 'react-jsx',
    jsxImportSource: 'react',
  },
}

/**
 * `@/a/b` -> the relative specifier reaching the SAME emitted file.
 *
 * REQUIRED, NOT COSMETIC. Per-file output makes `@/core/x` and `./x` distinct
 * module specifiers, and the runtime caches by specifier — so importing one file
 * both ways loads it TWICE. Two module instances means two class objects: Nest
 * registers one as a provider and is asked for the other, and reports the
 * dependency as unresolvable:
 *
 *   Nest can't resolve dependencies of the BootstrapOrchestratorService (…, ?)
 *
 * That is exactly what happened between `platform-supervisors.module.ts`
 * (`./swarm-app-wiring.supervisor.service`) and
 * `bootstrap-orchestrator.service.ts` (`@/core/modules/supervisors/platform/...`).
 *
 * Both sides are computed under `dist` so the specifier reaches the EMITTED
 * file, not the source one.
 */
function rewriteAlias(barePath: string, outDir: string): string {
  const target = path.join(distDir, barePath)
  let rel = path.relative(outDir, target).split(path.sep).join('/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

/** The specifier inside `from "…"`, `import("…")` and bare `import "…"`. */
const ALIAS_RX = /(["'])@\/([^"']+)\1/g

/**
 * Transpile `src/**` 1:1 into `dist/`, rewriting `@/` aliases to relative paths.
 *
 * WHY 1:1 AND NOT `bun build`
 * Bundling does not preserve Nest's constructor metadata. bun emits some classes
 * through the TC39 decorator path (`__decoratorStart`), which writes NO
 * `design:paramtypes`, so every plain typed parameter of those classes arrives
 * `undefined` at runtime. Measured on this app: 31 TC39 sites against 640 legacy
 * ones, i.e. ~30 broken classes.
 *
 * WHICH classes lose it varies with the module graph — the failure moved from
 * `SystemMeshConfigService` to `SystemMeshTopicService` after phase 8's
 * deletions — so annotating constructors cannot keep up: fixing the current set
 * would simply relocate the problem to whichever class the graph breaks next.
 *
 * Transpiling per file is how bun runs the source directly, and it emits the
 * metadata reliably: measured 629 `design:paramtypes` for 729 files, against 561
 * from the bundler. It also removes the whole class of bundler-ordering bugs
 * (lazy `__esm` wrappers, hoisting) rather than moving them around.
 */
async function runBuild(): Promise<void> {
  console.log(`🔨 Transpiling ${path.relative(process.cwd(), srcDir)} → dist...`)

  const transpiler = new Transpiler({
    loader: 'tsx',
    target: 'bun',
    tsconfig: DECORATOR_TS_CONFIG,
  })

  let files = 0
  let metadata = 0
  let aliases = 0

  for (const rel of new Glob('**/*.{ts,tsx}').scanSync({ cwd: srcDir })) {
    if (rel.endsWith('.d.ts')) continue

    const abs = path.join(srcDir, rel)
    const outDir = path.join(distDir, path.dirname(rel))
    const out = path.join(distDir, rel).replace(/\.tsx?$/, '.js')

    let source = readFileSync(abs, 'utf8')

    // Rewrite aliases BEFORE transpiling: the transpiler copies import
    // specifiers through verbatim, so one pass here is the single source of
    // truth for how a specifier is spelled in the output.
    source = source.replace(ALIAS_RX, (_m: string, quote: string, bare: string) => {
      aliases += 1
      return `${quote}${rewriteAlias(bare, outDir)}${quote}`
    })

    const code = transpiler.transformSync(source)

    mkdirSync(outDir, { recursive: true })
    writeFileSync(out, code)

    files += 1
    metadata += (code.match(/design:paramtypes/g) ?? []).length
  }

  console.log(
    `✅ Transpiled ${String(files)} files (${String(metadata)} decorator metadata, ` +
      `${String(aliases)} aliases resolved)`,
  )

  // A GUARD, not a statistic. Every Nest provider class needs at least one
  // `design:paramtypes` entry, so a build producing NONE means `emitDecoratorMetadata`
  // was lost — which is silent at build time and fatal at boot (`undefined` for
  // every injected parameter). Failing here turns that into a build error, at the
  // step that caused it, instead of a confusing DI crash in a running process.
  if (files > 0 && metadata === 0) {
    console.error(
      '❌ No decorator metadata was emitted — Nest dependency injection cannot work.',
    )
    process.exit(1)
  }
}

/**
 * Run the Vite SSR builds (client + server bundles consumed by
 * @nestjs-ssr/react in production).
 */
async function runSsrBuild(script: 'build:client' | 'build:server'): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`🎨 Building SSR bundle (${script})...`)
    const proc = spawn('bun', ['--bun', 'run', script], {
      stdio: 'inherit',
      shell: false,
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production' },
    })
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ SSR bundle built (${script})`)
        resolve()
      } else {
        reject(new Error(`${script} exited with code ${code}`))
      }
    })
    proc.on('error', reject)
  })
}

/**
 * Execute the freshly-built boot check.
 *
 * WHY THIS RUNS AS PART OF `build` RATHER THAN AS A SEPARATE SCRIPT
 * `tsc` proves the code type-checks; it proves NOTHING about whether Nest can
 * assemble the application. An unexported provider, an `@Inject(TOKEN)` nobody
 * binds, a module importing something absent — all of that type-checks cleanly
 * and then fails at boot. Those failures were REAL in this repo, invisible to
 * `type-check`, and are exactly what this catches.
 *
 * It runs the BUNDLED `dist/compile.js`, not the source: the bundle is what
 * ships, so it is the artifact worth checking. Bound to the build, it cannot be
 * skipped — no separate CI step to forget.
 *
 * The check builds `AppModule` (the feature graph) and never listens on a port,
 * so it is safe in CI and alongside a live dev stack.
 */
function runCompileCheck(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('🔎 Verifying the Nest graph assembles (dist/compile.js)...')
    const proc = spawn('bun', ['--bun', path.join(distDir, 'compile.js')], {
      stdio: 'inherit',
      shell: false,
      cwd: path.join(__dirname, '..'),
      // Force a non-production boot so the check exercises the same path a
      // developer sees, not the migration/supervisor work of a real deploy.
      env: { ...process.env, NODE_ENV: 'test' },
    })

    // Booting the real graph can leave background handles open after `close()`.
    // When that happened, the child printed its success line and then never
    // exited — so `'exit'` never fired, this promise never settled, and `build`
    // hung until the CI job itself timed out, with no diagnostic pointing here.
    // The timeout converts that silent hang into a named failure.
    const TIMEOUT_MS = 120_000
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(
        new Error(
          `compile check did not exit within ${String(TIMEOUT_MS / 1000)}s ` +
            `— it printed a result but left the event loop alive. ` +
            `Ensure apps/api/src/compile.ts ends with process.exit(0).`,
        ),
      )
    }, TIMEOUT_MS)

    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        console.log('✅ Nest graph assembles cleanly')
        resolve()
      } else {
        reject(new Error(`compile check exited with code ${String(code)}`))
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * Run database generation using Drizzle Kit
 */
function runDbGenerate(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('📦 Generating database schema...')
    const proc = spawn('bun', ['run', 'db:generate'], {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..'),
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ Database schema generated')
        resolve()
      } else {
        reject(new Error(`db:generate exited with code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Main build function.
 *
 * ORDER MATTERS and is not concurrent by accident:
 *   1. `build` + `db:generate`          — independent, run together
 *   2. SSR bundles                      — independent output dirs
 *   3. compile check                    — MUST be last: it executes the
 *                                         artifact step 1 produced, so it can
 *                                         only be meaningful once that exists
 */
async function main(): Promise<void> {
  console.log('🚀 Starting concurrent build and database generation...\n')

  try {
    cleanup()

    // Run both build and db:generate concurrently
    await Promise.all([runBuild(), runDbGenerate()])

    // SSR bundles (after the Nest build — independent output dirs)
    await Promise.all([runSsrBuild('build:client'), runSsrBuild('build:server')])

    // LAST: prove the bundle we just produced can actually assemble the app.
    await runCompileCheck()

    console.log('\n✅ Build completed successfully!')
  } catch (error) {
    console.error('\n❌ Build failed:', error)
    process.exit(1)
  }
}

// @ts-ignore
await main()
