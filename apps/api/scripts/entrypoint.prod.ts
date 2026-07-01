#!/usr/bin/env -S bun

import { existsSync, readFileSync } from 'fs'
import { execSync, spawn, spawnSync } from 'child_process'
import { validateApiEnv, apiEnvIsValid, validateApiEnvSafe, validateApiEnvPath } from '@repo/env'
import zod from 'zod/v4'

// ─── Version ───────────────────────────────────────────────────────────────────
// Read deployer version from package.json at module load time using
// readFileSync (not require()) to work with verbatimModuleSyntax + ESM.
const DEPLOYER_VERSION: string = (() => {
  try {
    const raw = readFileSync('package.json', 'utf-8')
    return JSON.parse(raw).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

interface EntrypointConfig {
  skipMigrations: boolean
  diagnosePath: string
  migrateScript: string
  seedScript: string
  cliEntrypoint: string
}

// ─── Startup Protocol ──────────────────────────────────────────────────────────

/**
 * Phase 1: Extract deployer version from package.json.
 */
function phaseVersionExtraction(): string {
  console.log('════════════════════════════════════════════════════════')
  console.log(`📦 Deployer version: ${DEPLOYER_VERSION}`)
  console.log('════════════════════════════════════════════════════════\n')
  return DEPLOYER_VERSION
}

/**
 * Phase 2: Check node setup state via CLI.
 *
 * Exit codes from the CLI command:
 *   0  Setup is done and version is consistent — ready to start
 *   1  Setup is done but version mismatch detected (upgrade may be needed)
 *   2  Setup has never been started (setup wizard required)
 *   3  Setup was in progress but interrupted
 *   4  Setup failed / upgrade failed previous
 *   5  Error reading config or other unexpected failure
 */
function phaseStartupCheck(config: EntrypointConfig): {
  setupState: string
  deployerVersion: string
  nodeId: string | null
  strategy: string | null
  configuredAt: string | null
  message: string
  exitCode: number
} {
  console.log('🔍 Checking node setup state...')

  if (!existsSync(config.cliEntrypoint)) {
    console.log('⚠️  CLI entrypoint not found at', config.cliEntrypoint)
    return {
      setupState: 'unknown',
      deployerVersion: DEPLOYER_VERSION,
      nodeId: null,
      strategy: null,
      configuredAt: null,
      message: `CLI entrypoint not found at ${config.cliEntrypoint}`,
      exitCode: 5,
    }
  }

  const result = spawnSync('bun', ['--bun', config.cliEntrypoint, 'node-startup-check'], {
    encoding: 'utf-8',
    shell: true,
  })

  if (result.status === null) {
    console.log('⚠️  Startup check process was killed or failed to spawn')
    return {
      setupState: 'unknown',
      deployerVersion: DEPLOYER_VERSION,
      nodeId: null,
      strategy: null,
      configuredAt: null,
      message: 'Startup check process was killed or failed to spawn',
      exitCode: 5,
    }
  }

  try {
    const output = JSON.parse(result.stdout ?? '{}')
    console.log(`  State: ${output.setupState ?? 'unknown'}`)
    console.log(`  Node:  ${output.nodeId ?? 'not configured'}`)
    console.log(`  Strategy: ${output.strategy ?? 'not set'}`)
    if (output.configuredAt) {
      console.log(`  Configured at: ${output.configuredAt}`)
    }
    console.log(`  Deployer version: ${output.deployerVersion ?? DEPLOYER_VERSION}`)
    if (output.message) {
      console.log(`  ${output.message}`)
    }
    return output
  } catch {
    console.log(`  Exit code: ${result.status} — no parsable JSON output`)
    return {
      setupState: result.status === 0 ? 'setup_done' : result.status === 2 ? 'not_started' : 'unknown',
      deployerVersion: DEPLOYER_VERSION,
      nodeId: null,
      strategy: null,
      configuredAt: null,
      message: `Exit code ${result.status}`,
      exitCode: result.status ?? 5,
    }
  }
}

/**
 * Phase 3: Validate environment variables
 */
function phaseValidateEnvironment(): void {
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
 * Phase 4: Run diagnostics if available
 */
function phaseDiagnostics(config: EntrypointConfig): void {
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
 * Phase 5: Run database migrations (production)
 */
function phaseRunMigrations(config: EntrypointConfig): void {
  if (config.skipMigrations) {
    console.log('⏭️  SKIP_MIGRATIONS set, skipping migrations and seeding')
    return
  }

  const apiPackageJson = 'package.json'

  if (!existsSync(apiPackageJson)) {
    console.log('⚠️  package.json missing, skipping migrations and seeding')
    return
  }

  console.log('📦 Running database migrations...')
  try {
    execSync(`bun run ${config.migrateScript}`, { stdio: 'inherit' })
    console.log('✅ Database migrations applied')
  } catch (error) {
    console.error('⚠️  db:migrate failed (continuing)')
  }
}

/**
 * Phase 6: Create default admin user if needed
 */
function phaseCreateDefaultAdmin(config: EntrypointConfig): void {
  if (!existsSync(config.cliEntrypoint)) {
    console.log('⚠️  cli entrypoint not found at', config.cliEntrypoint, ', skipping')
    return
  }

  try {
    console.log('👤 Creating default admin user if needed...')
    execSync(`bun --bun ${config.cliEntrypoint} create-default-admin`, { stdio: 'inherit' })
  } catch (error) {
    console.error('⚠️  Failed to create default admin user:', error)
  }
}

/**
 * Phase 7: Register mesh node in global DB (idempotent)
 *
 * Exit code handling from the CLI command:
 *   0  Success (registered, already registered, or gracefully skipped)
 *   2  DB not ready (transient — caller may retry)
 *   3  Schema not ready (migrations needed)
 *   4  Registration error (real failure)
 *   5  Registration DENIED — node code too old for cluster schema
 */
function phaseRegisterMeshNode(config: EntrypointConfig): void {
  if (!existsSync(config.cliEntrypoint)) {
    console.log('⚠️  CLI entrypoint not found at', config.cliEntrypoint, ', skipping')
    return
  }

  console.log('🌐 Registering mesh node in global DB...')
  try {
    execSync(`bun --bun ${config.cliEntrypoint} register-mesh-node`, { stdio: 'inherit' })
    console.log('✔️  Mesh node registration finished')
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status;
      if (status === 2) {
        console.log('⏳  Mesh node registration deferred — global DB not ready yet')
      } else if (status === 3) {
        console.log('⚠️  Mesh node registration deferred — global DB tables missing (migrations not yet applied)')
      } else if (status === 5) {
        console.log('❌  Mesh node registration DENIED — this node\'s code is too old for the cluster schema')
        console.log('    Action: Deploy a newer app version that includes all migrations already applied to the global DB.')
      } else {
        console.log(`⚠️  Mesh node registration failed with exit code ${status} — check container logs for details`)
      }
    } else {
      console.error('⚠️  Mesh node registration failed (continuing):', error)
    }
  }
}

/**
 * Phase 8: Run database seeding (optional, controlled by environment)
 */
function phaseRunSeeding(config: EntrypointConfig): void {
  if (config.skipMigrations) {
    console.log('⏭️  SKIP_MIGRATIONS set, skipping seeding')
    return
  }

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
 * Phase 9: Interpret the startup check result and decide next action
 */
function phaseInterpretResult(checkResult: {
  setupState: string
  deployerVersion: string
  nodeId: string | null
  message: string
  exitCode: number
}): boolean {
  console.log('\n════════════════════════════════════════════════════════')
  console.log(`📋 Startup Check Result: ${checkResult.setupState} (exit code ${checkResult.exitCode})`)
  console.log('════════════════════════════════════════════════════════\n')

  switch (checkResult.exitCode) {
    case 0:
      console.log('✅ Node is properly configured and ready to start.')
      console.log(`   Node ID: ${checkResult.nodeId}`)
      console.log(`   Version: ${checkResult.deployerVersion}`)
      return true

    case 1:
      console.log('⚠️  Node setup is done but version may have changed.')
      console.log(`   ${checkResult.message}`)
      console.log('   The API will perform a full version check on startup.')
      return true

    case 2:
      console.log('⏳ Node has not been set up yet. Starting in setup mode.')
      console.log(`   Version: ${checkResult.deployerVersion}`)
      return true

    case 3:
      console.log('❌ Setup was interrupted before completion.')
      console.log('   Please reset the node configuration and run the setup wizard again.')
      return false

    case 4:
      console.log('❌ A previous upgrade attempt failed.')
      console.log('   Manual intervention or rollback is required.')
      return false

    case 5:
    default:
      console.log('❌ Cannot determine node startup state.')
      console.log(`   ${checkResult.message}`)
      return false
  }
}

/**
 * Start API in production mode
 */
function phaseStartAPI(): void {
  const mode = validateApiEnvPath(process.env.ENABLE_SEEDING, 'ENABLE_SEEDING')
    ? 'production-like (with mock data)'
    : 'production'
  console.log(`🚀 Starting API in ${mode} mode...`)

  try {
    execSync('bun run start:prod', { stdio: 'inherit' })
  } catch (error) {
    console.error('❌ API failed to start:', error)
    process.exit(1)
  }
}

/**
 * Main entrypoint — implements the full node startup protocol:
 *
 *   1. Extract deployer version from package.json
 *   2. Check node setup state via CLI
 *   3. Validate environment variables
 *   4. Run diagnostics
 *   5. Run database migrations
 *   6. Create default admin user
 *   7. Register mesh node in global DB
 *   8. Run database seeding (if enabled)
 *   9. Interpret startup check result
 *  10. Start API process
 */
function main(): void {
  const config: EntrypointConfig = {
    skipMigrations: validateApiEnvPath(process.env.SKIP_MIGRATIONS, 'SKIP_MIGRATIONS'),
    diagnosePath: 'scripts/diagnose-build.ts',
    migrateScript: 'db:migrate:prod',
    seedScript: 'db:seed:prod',
    cliEntrypoint: 'dist/cli.js',
  }

  const mode = validateApiEnvPath(process.env.ENABLE_SEEDING, 'ENABLE_SEEDING')
    ? 'Production-Like (with mock data)'
    : 'Production'
  console.log(`🎯 API ${mode} Entrypoint Started\n`)

  // ── Phase 1: Version Extraction ──────────────────────────────────────
  const _version = phaseVersionExtraction()

  // ── Phase 2: Startup Check ───────────────────────────────────────────
  const checkResult = phaseStartupCheck(config)

  // ── Phase 3: Environment Validation ──────────────────────────────────
  phaseValidateEnvironment()

  // ── Phase 4: Diagnostics ─────────────────────────────────────────────
  phaseDiagnostics(config)

  // ── Phase 5: Database Migrations ─────────────────────────────────────
  phaseRunMigrations(config)

  // ── Phase 6: Default Admin ───────────────────────────────────────────
  phaseCreateDefaultAdmin(config)

  // ── Phase 7: Mesh Node Registration ──────────────────────────────────
  // (Only register if setup is done — on fresh nodes this will be
  //  handled by the setup wizard itself)
  if (checkResult.exitCode === 0 || checkResult.exitCode === 1) {
    phaseRegisterMeshNode(config)
  } else {
    console.log('⏭️  Skipping mesh node registration — setup not yet complete')
  }

  // ── Phase 8: Seeding ─────────────────────────────────────────────────
  phaseRunSeeding(config)

  // ── Phase 9: Interpret Result ────────────────────────────────────────
  const shouldProceed = phaseInterpretResult(checkResult)

  if (!shouldProceed) {
    console.error('❌ Startup check failed — cannot start API')
    process.exit(1)
  }

  // ── Phase 10: Start API ──────────────────────────────────────────────
  console.log('⏭️  Mesh connection and version verification handled by API services')
  phaseStartAPI()
}

main()
