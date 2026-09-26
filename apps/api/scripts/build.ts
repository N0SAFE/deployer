#!/usr/bin/env -S bun

import { build, BuildConfig } from 'bun'
import { spawn } from 'child_process'
import { existsSync, rmSync } from 'fs'
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
 * source but not from the bundle proves nothing; bundling is where module
 * resolution, decorator emission and entry-point shape actually change.
 */
async function runBuild(): Promise<void> {
  // Main entrypoints with code splitting
  const mainEntrypoints = [
    path.join(srcDir, 'main.ts'),
    path.join(srcDir, 'cli.ts'),
    path.join(srcDir, 'compile.ts'),
  ]

  const mainConfig = {
    entrypoints: mainEntrypoints,
    outdir: distDir,
    // MINIFY IS OFF, deliberately — it is a CORRECTNESS setting here, not a
    // performance one.
    //
    // With minify enabled bun emits some modules' decorators as TC39
    // (`__decoratorStart` / `__decorateElement`) instead of legacy TS, and that
    // path writes NO `design:paramtypes` metadata. Nest resolves plain
    // constructor parameters from that metadata, so the affected providers were
    // constructed with `undefined` for every parameter that had no explicit
    // `@Inject`:
    //
    //   TypeError: undefined is not an object ('this.nodeConfigRepo.find')
    //   TypeError: undefined is not an object ('this.meshTopology.registerControlEnvelopeHandler')
    //
    // WHICH modules get the metadata-less path varies with the bundle graph,
    // which is why the same file built correctly in isolation and wrongly in the
    // full graph — and why this went unnoticed: the unit suites run from SOURCE
    // and never touch the artifact.
    //
    // This matches `pkg-build`, which builds every workspace package with
    // `minify` defaulting to false (`raw.minify === true` is required to turn it
    // on) and `splitting` on for esm.
    //
    // Minify buys nothing for this app anyway: it is one long-lived process that
    // reads its bundle from local disk, not a payload shipped over a network.
    minify: false,
    splitting: true,
    target: 'bun' as const,
    // Workspace and node_modules packages stay EXTERNAL, resolved at runtime.
    //
    // This is not only about duplication. A workspace package that resolves an
    // asset from `import.meta.url` gets the WRONG path once inlined, because
    // `import.meta.url` then points at THIS app's chunk rather than the
    // package's own dist. `@repo/nest-schema` is exactly that case:
    // `LOCAL_MIGRATIONS_DIR` is `new URL("../migrations/local", import.meta.url)`,
    // so bundled it resolved to `apps/api/migrations/local` — a directory
    // nothing creates — the migrations were silently skipped, and the first
    // query died with `no such table: node_config`. External, it resolves
    // inside `packages/nest/schema/dist/`, where the migrations actually live.
    //
    // It also keeps `reflect-metadata` and every Nest singleton single-instance,
    // which DI ordering depends on.
    packages: 'external',
    naming: {
      entry: '[dir]/[name].[ext]',
      chunk: 'chunk-[hash].[ext]',
    },
    // Keep these external — they must be resolved at runtime from node_modules,
    // not inlined into the bundle:
    //
    //   class-transformer, @nestjs/microservices, @nestjs/platform-socket.io
    //     Optional NestJS peers. @nestjs/core requires them lazily and tolerates
    //     their absence; bundling turns that optional require into a hard
    //     build-time failure.
    //
    //   vite, @vitejs/plugin-react
    //     Vite 8 statically references its *optional* peer
    //     `@vitejs/devtools/config` from inside its own node chunk. Bundling
    //     vite therefore fails to resolve a package that is legitimately
    //     absent. Vite is only used by the SSR dev server, which runs from
    //     node_modules in every environment, so it does not need bundling.
    external: [
      "class-transformer",
      "@nestjs/microservices",
      "@nestjs/platform-socket.io",
      "vite",
      "@vitejs/plugin-react",
    ]
  } as BuildConfig

  console.log(`🔨 Building NestJS entry points...`)

  const mainResult = await build(mainConfig)

  if (!mainResult.success) {
    console.error('❌ Main build failed')
    process.exit(1)
  }

  console.log(`✅ Successfully built to ${distDir}`)
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
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ Nest graph assembles cleanly')
        resolve()
      } else {
        reject(new Error(`compile check exited with code ${String(code)}`))
      }
    })
    proc.on('error', reject)
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
