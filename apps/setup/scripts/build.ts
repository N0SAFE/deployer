#!/usr/bin/env -S bun

import { build, type BuildConfig } from 'bun'
import { spawn } from 'child_process'
import { existsSync, rmSync } from 'fs'
import * as path from 'path'

const rootDir = path.join(import.meta.dir, '..')
const srcDir = path.join(rootDir, 'src')
const distDir = path.join(rootDir, 'dist')

/**
 * Build the setup app.
 *
 * THREE outputs, and the third is the point of the file:
 *
 *   1. Vite SSR bundle      the wizard's client + server render bundles
 *   2. dist/main.js         the server that ships
 *   3. dist/compile.js      the boot check — assembles the Nest graph, exits
 *
 * `compile.js` is BUILT, not merely type-checked, so `runCompileCheck` executes
 * the artifact the rest of the build produced. A graph that assembles from
 * source but not from the bundle proves nothing: bundling is where module
 * resolution, decorator emission and entry-point shape actually change.
 *
 * It also closes a gap that existed until now — `package.json` declared
 * `start:prod: bun --bun dist/main.js` while NOTHING in the repo ever produced
 * `dist/main.js`, so the production start could not have worked.
 */

/** Remove the previous build so a stale file cannot masquerade as a fresh one. */
function cleanup(): void {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true })
  }
}

/**
 * Bundle the two Node entry points.
 *
 * `target: 'bun'` and `packages: 'external'` match how the app actually runs:
 * workspace packages and node_modules are resolved at runtime, not inlined.
 * Inlining them would duplicate `reflect-metadata` and every Nest singleton,
 * which breaks decorator metadata and DI ordering in ways that only show up at
 * boot.
 */
async function runBuild(): Promise<void> {
  const config = {
    entrypoints: [
      path.join(srcDir, 'main.ts'),
      path.join(srcDir, 'compile.ts'),
    ],
    outdir: distDir,
    minify: true,
    splitting: true,
    target: 'bun' as const,
    packages: 'external',
    naming: {
      entry: '[dir]/[name].[ext]',
      chunk: 'chunk-[hash].[ext]',
    },
  } as BuildConfig

  console.log('🔨 Building setup entry points...')

  const result = await build(config)

  if (!result.success) {
    console.error('❌ Build failed')
    process.exit(1)
  }

  console.log(`✅ Built to ${distDir}`)
}

/**
 * Run one of the Vite SSR builds declared in `package.json`.
 *
 * Delegated to the npm script rather than reimplemented: the script is the
 * documented entry point and carries the flags (`--ssrManifest`, the
 * `index.html` copy) that make the output loadable by `@nestjs-ssr/react`.
 */
function runSsrBuild(script: 'build:client' | 'build:server'): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`🎨 Building SSR bundle (${script})...`)
    const proc = spawn('bun', ['--bun', 'run', script], {
      stdio: 'inherit',
      shell: false,
      cwd: rootDir,
      env: { ...process.env, NODE_ENV: 'production' },
    })
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ SSR bundle built (${script})`)
        resolve()
      } else {
        reject(new Error(`${script} exited with code ${String(code)}`))
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
 * Bound to the build, it cannot be skipped: there is no separate CI step to
 * forget. The check creates no HTTP adapter and binds no port, so it is safe in
 * CI and alongside a live dev stack.
 */
function runCompileCheck(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('🔎 Verifying the Nest graph assembles (dist/compile.js)...')
    const proc = spawn('bun', ['--bun', path.join(distDir, 'compile.js')], {
      stdio: 'inherit',
      shell: false,
      cwd: rootDir,
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
 * ORDER MATTERS and is not concurrent by accident:
 *   1. Node entry points and SSR bundles are independent — built together
 *   2. compile check MUST be last: it executes what step 1 produced
 */
async function main(): Promise<void> {
  try {
    cleanup()

    await Promise.all([
      runBuild(),
      runSsrBuild('build:client'),
      runSsrBuild('build:server'),
    ])

    await runCompileCheck()

    console.log('\n✅ Build completed successfully!')
  } catch (error) {
    console.error('\n❌ Build failed:', error)
    process.exit(1)
  }
}

await main()
