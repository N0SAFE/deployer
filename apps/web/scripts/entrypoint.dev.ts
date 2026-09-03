#!/usr/bin/env -S bun

import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { validateWebEnvSafe, webEnvIsValid } from '@repo/env'
import zod from 'zod/v4'

const DECLARATIVE_ROUTING_PKG_DIR = join(process.cwd(), '../../packages/bin/declarative-routing')
const DECLARATIVE_ROUTING_DIST = join(DECLARATIVE_ROUTING_PKG_DIR, 'dist/index.js')

/**
 * Build local declarative-routing package and ensure dist/index.js exists.
 * Required in container startup to guarantee dr:build/watch use local package only.
 *
 * Skips the rebuild when dist/index.js already exists (the Dockerfile's
 * `turbo run build --filter=web...` stage builds it at image build time).
 * This avoids a redundant synchronous build on every container start.
 */
function ensureLocalDeclarativeRoutingBuilt(): void {
  const localCliSourcePath = join(DECLARATIVE_ROUTING_PKG_DIR, 'src/index.ts')

  if (!existsSync(localCliSourcePath)) {
    console.error('❌ declarative-routing local package source is missing')
    console.error(`   Expected at: ${localCliSourcePath}`)
    process.exit(1)
  }

  // Already built (image build stage or previous run) — skip the rebuild.
  if (existsSync(DECLARATIVE_ROUTING_DIST)) {
    console.log('✅ Local declarative-routing package already built — skipping rebuild')
    return
  }

  console.log('🔨 Building local @repo/cli-declarative-routing package...')

  const result = spawnSync('bun', ['run', '--cwd', DECLARATIVE_ROUTING_PKG_DIR, 'build'], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    console.error('❌ Failed to build local @repo/cli-declarative-routing package')
    process.exit(1)
  }

  if (!existsSync(DECLARATIVE_ROUTING_DIST)) {
    console.error('❌ local declarative-routing build completed but dist/index.js is missing')
    console.error(`   Expected at: ${DECLARATIVE_ROUTING_DIST}`)
    process.exit(1)
  }

  console.log('✅ Local declarative-routing package built successfully')
}

/**
 * Validate environment variables at startup
 */
function validateEnvironment(): void {
  console.log('🔍 Validating environment variables...')
  
  if (!webEnvIsValid(process.env)) {
    const result = validateWebEnvSafe(process.env)
    console.error('❌ Environment validation failed:')
    if (!result.success) {
      console.error(zod.prettifyError(result.error))
    }
    process.exit(1)
  }
  
  console.log('✅ Environment validation passed\n')
}

/**
 * Ensure routes are generated before starting Next.js
 */
function ensureRoutesGenerated(): void {
  const routesIndexPath = join(process.cwd(), 'src/routes/index.ts')
  
  if (!existsSync(routesIndexPath)) {
    console.log('⚠️  Routes not found, generating initial routes...')
    const result = spawnSync('bun', ['--bun', 'run', 'dr:build'], {
      stdio: 'inherit',
      env: process.env,
    })
    
    if (result.status !== 0) {
      console.error('❌ Failed to generate routes')
      process.exit(1)
    }
    
    console.log('✅ Initial routes generated')
  } else {
    console.log('✅ Routes already exist')
  }
}

/**
 * Start Next.js and Declarative Routing processes concurrently.
 *
 * On slow Docker overlay filesystems, `next dev` with `cacheComponents: true`
 * may exit with code 0 after its initial cache pre-warm completes.
 * This function detects that case and automatically restarts nextjs so the
 * second boot serves with a warm cache and stays running.
 */
function startProcesses(): void {
  console.log('🚀 Starting Next.js and Declarative Routing...')

  let exitRequested = false
  let nextRestartCount = 0
  const MAX_NEXT_RESTARTS = 5

  // ── Debug: file system change watcher ─────────────────────────
  if (process.env.NEXT_DEBUG_COMPILE === "1") {
    console.log('[entrypoint] 🔍 NEXT_DEBUG_COMPILE=1 detected, starting file system watcher...')

    const fsWatcher = spawn('bun', ['--bun', 'run', 'scripts/debug-file-watcher.ts'], {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    })

    fsWatcher.on('error', (err) => {
      console.error('[entrypoint] FS watcher error:', err.message)
    })

    fsWatcher.on('exit', (code) => {
      if (code !== 0 && !exitRequested) {
        console.warn(`[entrypoint] FS watcher exited with code ${code}`)
      }
    })

    // Periodic heartbeat
    let heartbeatCount = 0
    setInterval(() => {
      heartbeatCount++
      console.log(`[entrypoint] ❤️ Heartbeat #${heartbeatCount} — ${new Date().toISOString()}`)
    }, 30_000)
  }
  // ───────────────────────────────────────────────────────────────

  const routingProcess = spawn('bun', ['--bun', 'run', 'dr:build:watch'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_OPTIONS: '--max_old_space_size=256',
    },
  })

  /**
   * Spawn a nextjs dev server and wire up its exit/error handlers.
   * The routing process is kept alive across restarts so declarative
   * route generation does not need to be re-initialised.
   */
  function spawnNext(): void {
    if (exitRequested) return

    const nextProcess = spawn('bun', ['--bun', 'run', 'dev:docker'], {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        NODE_OPTIONS: '--max_old_space_size=3072',
      },
    })

    nextProcess.on('exit', (code, signal) => {
      if (exitRequested) return

      // next dev often exits with code 0 after the initial cacheComponents
      // pre-warm on slow filesystems.  Restart so the warm cache is used.
      if (code === 0 && nextRestartCount < MAX_NEXT_RESTARTS) {
        nextRestartCount++
        console.log(
          `[entrypoint] nextjs exited with code 0, restarting` +
            ` (attempt ${nextRestartCount}/${MAX_NEXT_RESTARTS})…`,
        )
        spawnNext()
        return
      }

      exitRequested = true
      console.error(
        `[entrypoint] nextjs exited` +
          ` (code=${code ?? 'null'}, signal=${signal ?? 'null'})` +
          (code !== 0 ? ' — giving up' : ' — max restarts reached'),
      )
      routingProcess.kill()
      process.exit(code ?? 1)
    })

    nextProcess.on('error', (error) => {
      if (!exitRequested) {
        exitRequested = true
        console.error(`[entrypoint] nextjs process error: ${error.message}`)
        routingProcess.kill()
        process.exit(1)
      }
    })
  }

  spawnNext()

  routingProcess.on('exit', (code, signal) => {
    if (!exitRequested) {
      exitRequested = true
      console.error(
        `[entrypoint] declarative-routing exited` +
          ` (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
      )
      process.exit(code ?? 1)
    }
  })

  routingProcess.on('error', (error) => {
    if (!exitRequested) {
      exitRequested = true
      console.error(
        `[entrypoint] declarative-routing process error: ${error.message}`,
      )
      process.exit(1)
    }
  })

  process.on('SIGINT', () => {
    if (!exitRequested) {
      exitRequested = true
      console.log('Received SIGINT, shutting down...')
      routingProcess.kill('SIGINT')
    }
  })

  process.on('SIGTERM', () => {
    if (!exitRequested) {
      exitRequested = true
      console.log('Received SIGTERM, shutting down...')
      routingProcess.kill('SIGTERM')
    }
  })
}

/**
 * Main entrypoint
 */
async function main(): Promise<void> {
  console.log('🎯 Web Development Entrypoint Started\n')
  
  // Validate environment before starting
  validateEnvironment()

  // Build local declarative-routing package at container startup
  ensureLocalDeclarativeRoutingBuilt()
  
  // Ensure routes are generated before starting Next.js
  ensureRoutesGenerated()
  
  startProcesses()
}

main()
