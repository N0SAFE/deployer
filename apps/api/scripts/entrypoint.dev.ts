#!/usr/bin/env -S bun

import { existsSync, readFileSync } from 'fs'
import { execSync, spawn, spawnSync } from 'child_process'
import { validateApiEnv, apiEnvIsValid, validateApiEnvSafe } from '@repo/env'
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
  diagnosePath: string
  cliEntrypoint: string
  startupCheckCommand: string
  registerMeshNodeCommand: string
}

// ─── Startup Protocol ──────────────────────────────────────────────────────────

/**
 * Phase 1: Extract deployer version from package.json.
 * This is always the first step — version drives all subsequent decisions.
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
 * Calls `bun --bun src/cli.ts node-startup-check` which reads the local
 * SQLite database and returns the current setup state as JSON on stdout.
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

  // Try to parse JSON output
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
    // Fallback: parse from exit code
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
      execSync(`bun --bun --watch ${config.diagnosePath}`, { stdio: 'inherit' })
    } catch (error) {
      console.error('⚠️  Diagnostics failed, continuing...')
    }

    console.log('════════════════════════════════════════════════════════')
  }
}

/**
 * Phase 5: Register mesh node in global DB (idempotent)
 *
 * Note: Global DB migrations are NOT run here — they are managed by the
 * mesh layer itself (see docs/global-db-migration.md). The migration
 * coordinator lives in the API/mesh services and checks schema versions
 * across all peer nodes before applying any migration.
 *
 * Exit code handling from the CLI command:
 *   0  Success (registered, already registered, or gracefully skipped)
 *   2  DB not ready (transient — caller may retry)
 *   3  Schema not ready (migrations needed — caller should escalate)
 *   4  Registration error (real failure — caller should escalate)
 */
function phaseRegisterMeshNode(config: EntrypointConfig): void {
  if (!existsSync(config.cliEntrypoint)) {
    console.log('⚠️  CLI entrypoint not found at', config.cliEntrypoint, ', skipping')
    return
  }

  console.log('🌐 Registering mesh node in global DB...')
  const result = spawnSync('bun', ['--bun', config.cliEntrypoint, 'register-mesh-node'], {
    stdio: 'inherit',
    shell: true,
  })

  if (result.status === null) {
    console.log('⚠️  Mesh node registration process was killed or failed to spawn')
  } else if (result.status === 0) {
    console.log('✔️  Mesh node registration finished')
  } else if (result.status === 2) {
    console.log('⏳  Mesh node registration deferred — global DB not ready yet (will retry on next startup)')
  } else if (result.status === 3) {
    console.log('⚠️  Mesh node registration deferred — global DB tables missing (migrations not yet applied)')
  } else {
    console.log(`⚠️  Mesh node registration failed with exit code ${result.status} — check container logs for details`)
  }
}

/**
 * Phase 6: Interpret the startup check result and decide next action
 */
function interpretStartupResult(checkResult: {
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
      // Setup done, version consistent — ready to start
      console.log('✅ Node is properly configured and ready to start.')
      console.log(`   Node ID: ${checkResult.nodeId}`)
      console.log(`   Version: ${checkResult.deployerVersion}`)
      return true // proceed to start

    case 1:
      // Setup done but version mismatch
      console.log('⚠️  Node setup is done but version may have changed.')
      console.log(`   ${checkResult.message}`)
      console.log('   The API will perform a full version check on startup.')
      console.log('   If a version mismatch is detected across the mesh,')
      console.log('   the upgrade protocol will be triggered.')
      return true // proceed to start (version check happens in API)

    case 2:
      // Setup has never been started
      console.log('⏳ Node has not been set up yet.')
      console.log('   ┌─────────────────────────────────────────────────────────┐')
      console.log('   │  The setup wizard is required before first use.         │')
      console.log('   │                                                         │')
      console.log('   │  The API will start in setup mode.                      │')
      console.log('   │  Access the web UI to complete the setup wizard.        │')
      console.log('   │                                                         │')
      console.log('   │  Two strategies are available:                          │')
      console.log('   │    • Local —  Start a new mesh (first/only node)        │')
      console.log('   │    • Remote — Join an existing mesh                     │')
      console.log('   └─────────────────────────────────────────────────────────┘')
      console.log(`   Version: ${checkResult.deployerVersion}`)
      return true // proceed to start in setup mode

    case 3:
      // Setup interrupted
      console.log('❌ Setup was interrupted before completion.')
      console.log('   Please reset the node configuration and run the setup wizard again.')
      return false

    case 4:
      // Upgrade failed
      console.log('❌ A previous upgrade attempt failed.')
      console.log('   Manual intervention or rollback is required.')
      console.log('   Please check the cluster state and resolve before restarting.')
      return false

    case 5:
    default:
      // Error
      console.log('❌ Cannot determine node startup state.')
      console.log(`   ${checkResult.message}`)
      return false
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
 * Main entrypoint — implements the full node startup protocol:
 *
 *   1. Extract deployer version from package.json
 *   2. Check node setup state via CLI
 *   3. Validate environment variables
 *   4. Run diagnostics (dev only)
 *   5. Register mesh node in global DB
 *   6. Interpret startup check result
 *   7. Start API processes
 */
function main(): void {
  const config: EntrypointConfig = {
    diagnosePath: 'scripts/diagnose-build.ts',
    cliEntrypoint: 'src/cli.ts',
    startupCheckCommand: 'node-startup-check',
    registerMeshNodeCommand: 'register-mesh-node',
  }

  console.log('🎯 API Development Entrypoint Started\n')
  console.log('════════════════════════════════════════════════════════')
  console.log('  ██████  ████████  █████  ██████  ████████ ██    ██ ')
  console.log('  ██   ██    ██    ██   ██ ██   ██    ██    ██    ██ ')
  console.log('  ██████     ██    ███████ ██████     ██    ██    ██ ')
  console.log('  ██         ██    ██   ██ ██   ██    ██    ██    ██ ')
  console.log('  ██         ██    ██   ██ ██   ██    ██     ██████  ')
  console.log('════════════════════════════════════════════════════════')
  console.log()

  // ── Phase 1: Version Extraction ──────────────────────────────────────
  const _version = phaseVersionExtraction()

  // ── Phase 2: Startup Check ───────────────────────────────────────────
  const checkResult = phaseStartupCheck(config)

  // ── Phase 3: Environment Validation ──────────────────────────────────
  phaseValidateEnvironment()

  // ── Phase 4: Diagnostics ─────────────────────────────────────────────
  phaseDiagnostics(config)

  // ── Phase 5: Mesh Node Registration ──────────────────────────────────
  // (Only register if setup is done — on fresh nodes this will be
  //  handled by the setup wizard itself)
  if (checkResult.exitCode === 0 || checkResult.exitCode === 1) {
    phaseRegisterMeshNode(config)
  } else {
    console.log('⏭️  Skipping mesh node registration — setup not yet complete')
  }

  // ── Phase 6: Interpret Result ────────────────────────────────────────
  const shouldProceed = interpretStartupResult(checkResult)

  if (!shouldProceed) {
    console.error('❌ Startup check failed — cannot start API')
    process.exit(1)
  }

  // ── Phase 7: Start API ───────────────────────────────────────────────
  // Database setup and mesh connection are handled by the API itself
  // via InitializationService.onModuleInit() and StartupCoordinatorService.
  console.log('⏭️  DB setup and mesh connection handled by API services')

  startProcesses()
}

main()
