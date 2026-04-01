#!/usr/bin/env -S bun

import { existsSync } from 'fs'
import { execSync, spawn } from 'child_process'
import { validateApiEnv, apiEnvIsValid, validateApiEnvSafe } from '@repo/env'
import zod from 'zod/v4'

interface EntrypointConfig {
  diagnosePath: string
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
 * Register current mesh node in global DB (idempotent)
 */
function registerMeshNode(config: EntrypointConfig): void {
  if (!existsSync(config.registerMeshNodeCommand)) {
    console.log('⚠️  cli command entrypoint not found at', config.registerMeshNodeCommand, ', skipping')
    return
  }

  try {
    console.log('🌐 Registering mesh node in global DB...')
    execSync(`bun --bun ${config.registerMeshNodeCommand} register-mesh-node`, { stdio: 'inherit' })
  } catch (error) {
    console.error('⚠️  Mesh node registration failed (continuing):', error)
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
    registerMeshNodeCommand: 'src/cli.ts',
  }

  console.log('🎯 API Development Entrypoint Started\n')

  // Validate environment before starting
  validateEnvironment()

  runDiagnostics(config)

  // Register this API node in global mesh metadata on every startup
  registerMeshNode(config)

  // Database setup is orchestrated by dedicated one-shot Docker services:
  // migrate -> default-admin -> seed
  console.log('⏭️  Skipping DB setup in API entrypoint (handled by setup services)')
  
  startProcesses()
}

main()
