#!/usr/bin/env -S bun

import { existsSync } from 'fs'
import { execSync, spawn, spawnSync } from 'child_process'
import { validateApiEnv, apiEnvIsValid, validateApiEnvSafe } from '@repo/env'
import zod from 'zod/v4'

interface EntrypointConfig {
  diagnosePath: string
  migrateScript: string
  registerMeshNodeCommand: string
}

/**
 * Validate environment variables at startup
 */
function validateEnvironment(): void {
  console.log('🔍 Validating environment variables...')
  
  if (!apiEnvIsValid(process.env)) {
    const result = validateApiEnvSafe(process.env)
    console.error('❌ Environment validation failed:')
    if (!result.success) {
      console.error(zod.prettifyError(result.error))
    }
    process.exit(1)
  }
  
  console.log('✅ Environment validation passed\n')
}

/**
 * Run diagnostics if available
 */
function runDiagnostics(config: EntrypointConfig): void {
  if (existsSync(config.diagnosePath)) {
    console.log('════════════════════════════════════════════════════════')
    console.log('Running Build Environment Diagnostics...')
    console.log('════════════════════════════════════════════════════════')

    try {
      execSync(`bun --bun --watch ${config.diagnosePath}`, { stdio: 'inherit' })
    } catch (error) {
      console.error('⚠️  Diagnostics failed, continuing...')
    }

    console.log('════════════════════════════════════════════════════════')
  }
}

/**
 * Run database migrations (Postgres global DB)
 */
function runMigrations(config: EntrypointConfig): void {
  const apiPackageJson = 'package.json'

  if (!existsSync(apiPackageJson)) {
    console.log('⚠️  package.json missing, skipping migrations')
    return
  }

  console.log('📦 Running database migrations...')
  try {
    execSync(`bun run ${config.migrateScript}`, { stdio: 'inherit' })
    console.log('✅ Database migrations completed')
  } catch (error) {
    console.log('⚠️  db:migrate skipped — global DB may not be ready yet (non-fatal)')
  }
}

/**
 * Register current mesh node in global DB (idempotent)
 */
function registerMeshNode(config: EntrypointConfig): void {
  if (!existsSync(config.registerMeshNodeCommand)) {
    console.log('⚠️  cli command entrypoint not found at', config.registerMeshNodeCommand, ', skipping')
    return
  }

  console.log('🌐 Registering mesh node in global DB...')
  const result = spawnSync('bun', ['--bun', config.registerMeshNodeCommand, 'register-mesh-node'], {
    stdio: 'inherit',
    shell: true,
  })

  if (result.status !== 0) {
    console.log('⚠️  Mesh node registration skipped — global DB may not be ready yet (non-fatal)')
  }
}

/**
 * Start API and Drizzle Studio processes concurrently
 */
function startProcesses(): void {
  console.log('🚀 Starting API and Drizzle Studio...')

  const apiProcess = spawn('bun', ['run', 'start:dev'], {
    stdio: 'inherit',
    shell: true,
  })

  const studioProcess = spawn('bun', ['run', 'db:studio', '--host', '0.0.0.0'], {
    stdio: 'inherit',
    shell: true,
  })

  let exitRequested = false

  const handleExit = (code: number | null) => {
    if (!exitRequested) {
      exitRequested = true
      console.log('Process exited, cleaning up...')
      apiProcess.kill()
      studioProcess.kill()
      process.exit(code ?? 1)
    }
  }

  apiProcess.on('exit', handleExit)
  studioProcess.on('exit', handleExit)

  process.on('SIGINT', () => {
    if (!exitRequested) {
      exitRequested = true
      console.log('Received SIGINT, shutting down...')
      apiProcess.kill('SIGINT')
      studioProcess.kill('SIGINT')
    }
  })

  process.on('SIGTERM', () => {
    if (!exitRequested) {
      exitRequested = true
      console.log('Received SIGTERM, shutting down...')
      apiProcess.kill('SIGTERM')
      studioProcess.kill('SIGTERM')
    }
  })
}

/**
 * Main entrypoint
 */
function main(): void {
  const config: EntrypointConfig = {
    diagnosePath: 'scripts/diagnose-build.ts',
    migrateScript: 'db:migrate',
    registerMeshNodeCommand: 'src/cli.ts',
  }

  console.log('🎯 API Development Entrypoint Started\n')

  // Validate environment before starting
  validateEnvironment()

  runDiagnostics(config)

  // Run migrations first (schema must exist before mesh registration)
  // Note: In full docker-compose mode, migrations are also handled by the
  // dedicated api-db-migrate-dev one-shot container. Running them here too
  // makes the dev entrypoint self-sufficient regardless of orchestration.
  runMigrations(config)

  // Register this API node in global mesh metadata on every startup
  registerMeshNode(config)

  startProcesses()
}

main()
