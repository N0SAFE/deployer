#!/usr/bin/env -S bun

import { existsSync, readFileSync } from 'fs'
import { execSync, spawn, spawnSync } from 'child_process'
import http from 'http'
import { apiEnvIsValid, validateApiEnvSafe } from '@repo/env'
import zod from 'zod/v4'
import figlet from 'figlet'

// ─── Version ───────────────────────────────────────────────────────────────────
// Read deployer version from package.json at module load time using
// readFileSync (not require()) to work with verbatimModuleSyntax + ESM.
// ─── Swarm state tracking ────────────────────────────────────────────────
// On boot, detect if swarm was already active. On exit, tear down the swarm
// workloads we started AND leave swarm — but ONLY if swarm was NOT active
// before boot (we initialized it, so we own cleanup). Tearing the workloads
// down is what restores the pre-boot state: the container-era supervisors can
// then recreate plain containers with no service/name/port conflicts.
let swarmWasActiveBeforeBoot = false

/** Engine API result over the local unix socket. */
interface DockerApiResult {
  status: number
  body: string
}

/** Minimal Docker Engine API call over the unix socket (never throws). */
async function dockerApi(method: 'GET' | 'DELETE', path: string): Promise<DockerApiResult> {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path, method },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, body: '' }) })
    req.end()
  })
}

/** Parse a JSON body, returning null when the engine returned non-JSON. */
function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

const swarmServiceListSchema = zod.array(
  zod.object({
    ID: zod.string().min(1),
    Spec: zod.object({ Name: zod.string().default('') }).optional(),
  }),
)

const swarmNetworkListSchema = zod.array(
  zod.object({
    Id: zod.string().min(1),
    Name: zod.string(),
    Driver: zod.string().default(''),
    Scope: zod.string().default(''),
  }),
)

const swarmInspectSchema = zod.object({
  LocalNodeState: zod.string().default('inactive'),
})

const swarmInfoBodySchema = zod.object({
  Swarm: swarmInspectSchema.optional(),
})

/** True when the local engine is an active swarm member. */
async function checkSwarmState(): Promise<boolean> {
  const res = await dockerApi('GET', '/info')
  const parsed = swarmInfoBodySchema.safeParse(parseJsonBody(res.body))
  if (!parsed.success) return false
  return parsed.data.Swarm?.LocalNodeState === 'active'
}

/** Engine-managed networks that must survive a swarm teardown. */
const SWARM_RESERVED_NETWORKS = new Set(['ingress', 'docker_gwbridge'])

/** Max time to let swarm tasks shut down gracefully before leaving the swarm. */
const SWARM_GRACEFUL_STOP_MS = 25_000

/**
 * Remove every SWARM WORKLOAD we started: services (their task containers go
 * with them) and the overlay networks they used. Only run when this boot
 * created the swarm — see `leaveSwarmIfWeInitiated`.
 *
 * Services are removed WITHOUT `?force=true`: the daemon then sends SIGTERM to
 * each task and honors the stop grace period, so STATEFUL workloads (the
 * managed Postgres) checkpoint and shut down cleanly. Force-removal SIGKILLs
 * them, which corrupts the data directory ("could not locate a valid
 * checkpoint record") and breaks the next setup run.
 */
async function removeSwarmWorkloads(): Promise<void> {
  const servicesRes = await dockerApi('GET', '/services')
  const services = swarmServiceListSchema.safeParse(parseJsonBody(servicesRes.body))

  if (!services.success) {
    console.log('⚠️  Could not list swarm services — skipping workload teardown')
  } else if (services.data.length === 0) {
    console.log('   (no swarm services to remove)')
  } else {
    let removedServices = 0
    for (const service of services.data) {
      const name = service.Spec?.Name ?? service.ID.slice(0, 12)
      const res = await dockerApi('DELETE', `/services/${service.ID}`)
      if (res.status === 200) {
        removedServices += 1
        console.log(`   🗑️  Removed swarm service ${name} (graceful stop)`)
      } else {
        console.log(`   ⚠️  Swarm service ${name} not removed (HTTP ${String(res.status)})`)
      }
    }
    console.log(`   ${String(removedServices)}/${String(services.data.length)} swarm service(s) removed`)
    await waitForSwarmServicesToStop()
  }

  const networksRes = await dockerApi('GET', '/networks')
  const networks = swarmNetworkListSchema.safeParse(parseJsonBody(networksRes.body))
  if (!networks.success) return

  const overlays = networks.data.filter(
    (network) =>
      network.Scope === 'swarm' &&
      network.Driver === 'overlay' &&
      !SWARM_RESERVED_NETWORKS.has(network.Name),
  )
  for (const network of overlays) {
    const res = await dockerApi('DELETE', `/networks/${network.Id}`)
    if (res.status === 200) {
      console.log(`   🗑️  Removed overlay network ${network.Name}`)
    }
  }
}

/**
 * Wait (bounded) for the removed services' tasks to finish shutting down, so a
 * graceful SIGTERM is never cut short by leaving the swarm immediately.
 */
async function waitForSwarmServicesToStop(): Promise<void> {
  const deadline = Date.now() + SWARM_GRACEFUL_STOP_MS
  while (Date.now() < deadline) {
    const res = await dockerApi('GET', '/services')
    const services = swarmServiceListSchema.safeParse(parseJsonBody(res.body))
    // An unparseable answer means the engine already left the swarm — done.
    if (!services.success) return
    if (services.data.length === 0) {
      console.log('   ✔ All swarm services stopped')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log('   ⚠️  Some swarm services were still stopping after the grace window — leaving anyway')
}

async function leaveSwarmIfWeInitiated(): Promise<void> {
  if (swarmWasActiveBeforeBoot) {
    console.log('🐝 Swarm was already active before boot — leaving it and its workloads untouched')
    return
  }
  console.log('🧹 Swarm was not active before boot — removing swarm workloads, then leaving swarm...')

  // Stop/remove the swarm-scheduled containers FIRST so the next start boots
  // like a clean pre-swarm instance (no orphaned services, no name/port
  // conflicts with the container-era supervisors).
  await removeSwarmWorkloads()

  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path: '/swarm/leave?force=true', method: 'POST' },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('✅ Swarm left successfully')
          } else {
            console.log(`⚠️  Swarm leave returned ${String(res.statusCode)}: ${data}`)
          }
          resolve()
        })
      },
    )
    req.on('error', (err) => {
      console.log(`⚠️  Swarm leave failed: ${err.message}`)
      resolve()
    })
    req.setTimeout(5000, () => { req.destroy(); resolve() })
    req.end()
  })
}

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
}

/** Result of the pre-boot node-startup-check CLI call. */
interface StartupCheckResult {
  setupState: string
  deployerVersion: string
  nodeId: string | null
  strategy: string | null
  configuredAt: string | null
  message: string
  exitCode: number
  /** True when the CLI produced no parseable JSON (failed before it could read). */
  checkUnreadable?: boolean
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
function phaseStartupCheck(config: EntrypointConfig): StartupCheckResult {
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
      checkUnreadable: true,
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
      checkUnreadable: true,
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
    return output as StartupCheckResult
  } catch {
    // Fallback: no parseable JSON (fresh DB before first boot, or CLI failed
    // before it could write). The pre-boot check is ADVISORY — the API
    // orchestrator (Phase 0 / wizard) is the authoritative gate, so continue
    // booting and let it self-resolve.
    console.log(`  Exit code: ${String(result.status)} — no parseable JSON output`)
    return {
      setupState: 'unknown',
      deployerVersion: DEPLOYER_VERSION,
      nodeId: null,
      strategy: null,
      configuredAt: null,
      message: `Startup-state check could not be read (exit ${String(result.status)}). The API will self-resolve during boot.`,
      exitCode: result.status ?? 5,
      checkUnreadable: true,
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
 * Phase 6: Interpret the startup check result and decide next action
 */
function interpretStartupResult(checkResult: StartupCheckResult): boolean {
  console.log('\n════════════════════════════════════════════════════════')
  console.log(`📋 Startup Check Result: ${checkResult.setupState} (exit code ${checkResult.exitCode})`)
  console.log('════════════════════════════════════════════════════════\n')

  // The pre-boot check could not read the node state (fresh install before
  // the first boot, CLI startup failure, ...). This is ADVISORY — the API
  // orchestrator is the authoritative gate (Phase 0 persists the DB candidate,
  // heal/wizard runs setup, main-app starts only when ready). Continue booting.
  if (checkResult.checkUnreadable) {
    console.log('⚠️  Node startup-state check could not be read before boot.')
    console.log(`   ${checkResult.message}`)
    console.log('   This is expected on a fresh install (SQLite is created on first boot).')
    console.log('   Continuing — the API orchestrator will run setup / self-heal during boot.')
    return true // proceed to start
  }

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
  console.log(`[entrypoint] SETUP_AUTO="${process.env.SETUP_AUTO ?? ''}" SETUP_DATABASE_URL=${process.env.SETUP_DATABASE_URL ? 'set' : 'unset'} (Phase 0 / wizard resolves the DB)`)
  // SETUP_AUTO is NOT forced here. If you want auto-provisioning, set
  // SETUP_AUTO=true in your .env or docker environment. Otherwise the
  // app starts without a database and you run the setup wizard manually.
  console.log('🚀 Starting API...')

  const apiProcess = spawn('bun', ['run', 'start:dev'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
    },
  })

  // Vite dev server for the SSR views' client bundle.
  //
  // The SSR library starts Vite in `middlewareMode` (no TCP listener) and then
  // proxies asset requests to `localhost:5173` over TCP — a port nothing ever
  // bound, so those requests hung as 504s and the setup page rendered without
  // its JavaScript. Running the dev server HERE, on that same port, makes the
  // proxy (and the gateway's `/vite` forwarding) resolve to a real listener.
  // Every dev asset is served under `base: '/vite/'`, so the whole asset
  // surface is a single forwardable/whitelistable path.
  console.log('⚡ Starting Vite dev server (SSR client bundle, base /vite/)...')
  const viteProcess = spawn('bun', ['run', 'dev:vite'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
    },
  })

  // Start Drizzle Studio only if setup database URL is available
  // In dev mode with auto-provisioned Postgres, the DB doesn't exist at startup
  // so drizzle-kit studio would fail. Start it when SETUP_DATABASE_URL is set.
  let studioProcess: ReturnType<typeof spawn> | null = null
  if (process.env.SETUP_DATABASE_URL) {
    console.log('   Starting Drizzle Studio...')
    studioProcess = spawn('bun', ['run', 'db:studio', '--host', '0.0.0.0'], {
      stdio: 'inherit',
      shell: true,
    })
  } else {
    console.log('   (Drizzle Studio skipped — no SETUP_DATABASE_URL, Phase 0 will handle setup)')
  }

  // Single shutdown path: EVERY exit route (child exit, SIGINT, SIGTERM)
  // drains the swarm workloads + leaves swarm before the process exits, so the
  // next start boots as a clean pre-swarm instance. Idempotent — the first
  // call wins and later ones join the same promise.
  let shutdownPromise: Promise<void> | null = null

  const shutdown = (reason: string, signal?: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise) return shutdownPromise
    console.log(`${reason}, shutting down...`)
    apiProcess.kill(signal)
    viteProcess.kill(signal)
    if (studioProcess) studioProcess.kill(signal)
    shutdownPromise = leaveSwarmIfWeInitiated().finally(() => {
      process.exit(0)
    })
    return shutdownPromise
  }

  apiProcess.on('exit', () => void shutdown('Process exited'))
  viteProcess.on('exit', () => void shutdown('Vite process exited'))
  if (studioProcess) studioProcess.on('exit', () => void shutdown('Process exited'))

  process.on('SIGINT', () => void shutdown('Received SIGINT', 'SIGINT'))
  process.on('SIGTERM', () => void shutdown('Received SIGTERM', 'SIGTERM'))
}

/**
 * Main entrypoint — implements the full node startup protocol:
 *
 *   1. Extract deployer version from package.json
 *   2. Check node setup state via CLI
 *   3. Validate environment variables
 *   4. Run diagnostics (dev only)
 *   5. Interpret startup check result
 *   6. Start API processes
 */
function main(): void {
  const config: EntrypointConfig = {
    diagnosePath: 'scripts/diagnose-build.ts',
    cliEntrypoint: 'src/cli.ts',
    startupCheckCommand: 'node-startup-check',
  }

  console.log('🎯 API Development Entrypoint Started\n')
  console.log(figlet.textSync('DEPLOYER', {font: 'Standard'}))
  console.log()

  // ── Phase 1: Version Extraction ──────────────────────────────────────
  const _version = phaseVersionExtraction()

  // ── Phase 1.5: Detect swarm state BEFORE bootstrap ─────────────────
  checkSwarmState().then((active) => {
    swarmWasActiveBeforeBoot = active
    console.log(`🐝 Swarm state before boot: ${active ? 'active (will NOT leave on exit)' : 'inactive (will leave on exit if we init it)'}`)
  })

  // ── Phase 2: Startup Check ───────────────────────────────────────────
  const checkResult = phaseStartupCheck(config)

  // ── Phase 3: Environment Validation ──────────────────────────────────
  phaseValidateEnvironment()

  // ── Phase 4: Diagnostics ─────────────────────────────────────────────
  phaseDiagnostics(config)

  // ── Phase 5: Interpret Result ────────────────────────────────────────
  const shouldProceed = interpretStartupResult(checkResult)

  if (!shouldProceed) {
    console.error('❌ Startup check failed — cannot start API')
    process.exit(1)
  }

  // ── Phase 6: Start API ───────────────────────────────────────────────
  // Database setup, auth init, mesh connection, events, and docker validation
  // are handled by the API's v2 Sub-App Trigger Chain:
  //   BootstrapGate → SubAppOrchestrator → [Config, Database, Auth, Mesh, ...]
  // Each sub-app runs in its own ephemeral NestJS context, fires its trigger,
  // and is destroyed. All services are provided via the TriggerRegistry.
  console.log('⏭️  All startup handled by v2 Sub-App Trigger Chain')

  startProcesses()
}

main()
