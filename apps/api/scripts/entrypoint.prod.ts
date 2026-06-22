#!/usr/bin/env -S bun

import { existsSync } from 'fs'
import { execSync, spawn } from 'child_process'
import { validateApiEnv, apiEnvIsValid, validateApiEnvSafe, validateApiEnvPath } from '@repo/env'
import zod from 'zod/v4'

interface EntrypointConfig {
  skipMigrations: boolean
  diagnosePath: string
  migrateScript: string
  seedScript: string
  cliEntrypoint: string
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
      execSync(`bun --bun ${config.diagnosePath}`, { stdio: 'inherit' })
    } catch (error) {
      console.error('⚠️  Diagnostics failed, continuing...')
    }

    console.log('════════════════════════════════════════════════════════')
  }
}

/**
 * Run database migrations
 */
function runMigrations(config: EntrypointConfig): void {
  if (config.skipMigrations) {
    console.log('⏭️  SKIP_MIGRATIONS set, skipping migrations and seeding')
    return
  }

  const apiPackageJson = 'package.json'

  if (!existsSync(apiPackageJson)) {
    console.log('⚠️  package.json missing, skipping migrations and seeding')
    return
  }

  console.log('Found package.json - running migrations')

  try {
    console.log('📦 Running database migrations...')
    execSync(`bun run ${config.migrateScript}`, { stdio: 'inherit' })
  } catch (error) {
    console.error('⚠️  db:migrate failed (continuing)')
  }
}

/**
 * Run database seeding (optional, controlled by environment)
 */
function runSeeding(config: EntrypointConfig): void {
  if (config.skipMigrations) {
    console.log('⏭️  SKIP_MIGRATIONS set, skipping seeding')
    return
  }

  // Only seed if explicitly enabled via ENABLE_SEEDING=true
  if (!validateApiEnvPath(process.env.ENABLE_SEEDING, 'ENABLE_SEEDING')) {
    console.log('⏭️  ENABLE_SEEDING not set, skipping seeding (production mode)')
    return
  }

  try {
    console.log('🌱 Running database seeding...')
    execSync(`bun run ${config.seedScript}`, { stdio: 'inherit' })
  } catch (error) {
    console.error('⚠️  db:seed failed (continuing)')
  }
}

/**
 * Create default admin user if needed
 */
function createDefaultAdmin(): void {
  const cliEntrypoint = 'dist/cli.js'

  if (!existsSync(cliEntrypoint)) {
    console.log('⚠️  cli entrypoint not found at', cliEntrypoint, ', skipping')
    return
  }

  try {
    console.log('👤 Creating default admin user if needed...')
    execSync(`bun --bun ${cliEntrypoint} create-default-admin`, { stdio: 'inherit' })
  } catch (error) {
    console.error('⚠️  Failed to create default admin user:', error)
    // Don't exit - this is not critical
  }
}

/**
 * Register current mesh node in global DB (idempotent)
 */
function registerMeshNode(config: EntrypointConfig): void {
  if (!existsSync(config.cliEntrypoint)) {
    console.log('⚠️  cli entrypoint not found at', config.cliEntrypoint, ', skipping')
    return
  }

  try {
    console.log('🌐 Registering mesh node in global DB...')
    execSync(`bun --bun ${config.cliEntrypoint} register-mesh-node`, { stdio: 'inherit' })
  } catch (error) {
    console.error('⚠️  Mesh node registration failed (continuing):', error)
  }
}

/**
 * Start API in production mode
 */
function startAPI(): void {
  const mode = validateApiEnvPath(process.env.ENABLE_SEEDING, 'ENABLE_SEEDING') ? 'production-like (with mock data)' : 'production'
  console.log(`🚀 Starting API in ${mode} mode...`)

  try {
    execSync('bun run start:prod', { stdio: 'inherit' })
  } catch (error) {
    console.error('❌ API failed to start:', error)
    process.exit(1)
  }
}

/**
 * Main entrypoint
 */
function main(): void {
  const config: EntrypointConfig = {
    skipMigrations: validateApiEnvPath(process.env.SKIP_MIGRATIONS, 'SKIP_MIGRATIONS'),
    diagnosePath: 'scripts/diagnose-build.ts',
    migrateScript: 'db:migrate:prod',
    seedScript: 'db:seed:prod',
    cliEntrypoint: 'dist/cli.js',
  }

  const mode = validateApiEnvPath(process.env.ENABLE_SEEDING, 'ENABLE_SEEDING') ? 'Production-Like (with mock data)' : 'Production'
  console.log(`🎯 API ${mode} Entrypoint Started\n`)

  // Validate environment before starting
  validateEnvironment()

  runDiagnostics(config)
  
  // Run migrations first (schema must exist before any user creation)
  runMigrations(config)
  
  // Create default admin BEFORE seeding so seed can detect existing admin
  createDefaultAdmin()

  // Register this API node in global mesh metadata on every startup
  registerMeshNode(config)
  
  // Run seeding after admin creation (only in production-like mode)
  runSeeding(config)
  
  startAPI()
}

main()
