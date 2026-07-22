# Enhanced Database Connection Architecture — Proposal

> Based on deep analysis of the current codebase + research into best patterns for distributed NestJS/Postgres/SQLite systems. This document proposes a new architecture that is **fluent**, **fail-fast**, **resilient**, and handles **every startup scenario**.

---

## Part 1: Core Design Principles

### Principle P1: Fail Fast, Fail Loud
If the database is unreachable at startup, the app **must stop** with a clear diagnostic message. Never silently degrade at startup.

### Principle P2: Single Source of Truth for DB URL
The main app resolves the database URL through exactly two mechanisms. **Environment variables are NEVER read by the main app** — they are only consumed by a dev-mode bootstrap injector that pre-seeds the SQLite node_config before the pipeline starts. The resolution chain is:
```
Mesh peer → Local SQLite cache → Hard error
```

### Principle P3: Single Shared Pool
One `pg.Pool` instance. Not three. The pool is created once, probed, then shared across all drizzle instances and services.

### Principle P4: State Machine at Every Level
The node lifecycle is a well-defined state machine. Every state transition is explicit. Every state is observable via the health endpoint.

### Principle P5: Last Known Good
The SQLite `node_config.databaseUrl` is always the **last known good** URL. Even if the DB is currently unreachable, the URL is preserved for diagnostics and recovery.

### Principle P6: No Database Duplication
Locally managed Postgres containers are **named** and **reused** across restarts. Never create a second Postgres if one already exists.

---

## Part 2: The Node Lifecycle State Machine

```
                         ┌─────────────────────────────────────────┐
                         │                                         │
                         ▼                                         │
                   ┌──────────┐                                    │
            ┌──────│  BOOT    │◄──── (process restart)             │
            │      └────┬─────┘                                    │
            │           │                                          │
            │           ▼                                          │
            │      ┌──────────┐     ┌──────────────────┐          │
            │      │ DISCOVER │────►│  Network Error   │          │
            │      └────┬─────┘     │ → retry or fail  │          │
            │           │           └──────────────────┘          │
            │           ▼                                          │
            │      ┌──────────────────────┐                       │
            │      │  URL FOUND?          │                       │
            │      └──┬───────┬───────────┘                       │
            │         │       │                                   │
            │         ▼       ▼                                   │
            │    ┌────────┐  ┌──────────────┐                    │
            │    │  YES   │  │  NO          │                    │
            │    └───┬────┘  └──────┬───────┘                   │
            │        │              │                            │
            │        ▼              ▼                            │
            │   ┌────────┐   ┌──────────────┐                   │
            │   │  PROBE │   │  SETUP       │                   │
            │   │  DB    │   │  WIZARD      │                   │
            │   └───┬────┘   └──────┬───────┘                   │
            │        │              │                            │
            │        ▼              │                            │
            │   ┌────────┐         │                            │
            │   │  ALIVE? │         │                            │
            │   └──┬──┬──┘         │                            │
            │      │  │            │                            │
            │      ▼  ▼            │                            │
            │  ┌────┐ ┌──────────┐ │                            │
            │  │YES │ │  NO      │ │                            │
            │  └─┬──┘ │ FAIL     │ │                            │
            │    │    │ STOP     │ │                            │
            │    │    └──────────┘ │                            │
            │    ▼                 ▼                            │
            │  ┌────────┐   ┌──────────────┐                   │
            │  │  READY │   │  SETUP       │                   │
            │  │        │   │  COMPLETE    │                   │
            │  └───┬────┘   │  → probe DB  │                   │
            │      │        └──────┬───────┘                   │
            │      ▼               │                            │
            │  ┌────────┐         │                            │
            │  │  MESH  │◄────────┘                            │
            │  │  PEER  │                                      │
            │  └───┬────┘                                      │
            │      │                                           │
            │      ▼                                           │
            │  ┌────────┐     ┌──────────────────┐            │
            │  │ HEALTHY│────►│  DB DISCONNECT   │────────────┘
            │  │        │     │  → circuit open  │
            │  └────────┘     └──────────────────┘
            │
            │  (Node upgrade or config change)
            │
            └──────────────────────────────────────────────────┘
```

### State Definitions

| State | Meaning | Actions |
|-------|---------|---------|
| `BOOT` | Process starts | Initialize SQLite, load node_config from disk |
| `DISCOVER` | Resolve DB URL | Ask mesh → read SQLite cache |
| `URL_FOUND` | URL resolved | Validate format, proceed to PROBE |
| `URL_NOT_FOUND` | No URL anywhere | Launch setup wizard, block further startup |
| `PROBE` | Test DB connectivity | `SELECT 1` with timeout, categorize errors |
| `ALIVE` | DB reachable | Create shared pool, proceed to READY |
| `DEAD` | DB unreachable | Log diagnostic, **exit(1)** — fail fast |
| `READY` | Pool created + probed | Start accepting traffic |
| `MESH_PEER` | Mesh connected | Join cluster, register schema_version |
| `HEALTHY` | Fully operational | All systems go |
| `DEGRADED` | DB lost mid-run | Circuit breaker open, recovery loop active |
| `SETUP_WIZARD` | First-run setup | UI wizard running on port 3010 |

### Startup Decision Matrix

| Scenario | node_config.state | SQLite has URL? | DB Reachable? | Mesh Peer Known? | Action |
|----------|------------------|-----------------|---------------|------------------|--------|
| **Fresh install** | `not_started` | No | N/A | No | → SETUP_WIZARD |
| **Restart, local** | `setup_done` | Yes | Yes | No | → PROBE → READY → HEALTHY |
| **Restart, local, DB gone** | `setup_done` | Yes | **No** | No | → FAIL → **STOP with error** |
| **Restart, remote** | `setup_done` | Yes | Yes | Yes | → PROBE → READY → MESH_PEER → HEALTHY |
| **Restart, remote, mesh down** | `setup_done` | Yes (cached) | Yes | **No** | → PROBE → READY → **warn but continue** |
| **Restart, both down** | `setup_done` | Yes (stale) | **No** | **No** | → FAIL → **STOP with error** |
| **Upgrade** | `upgrade_pending` | Yes | Yes | Yes | → PROBE → READY → MESH_PEER → run migrations |
| **Dev auto-provision** | `not_started` | **Injected by dev bootstrap** | N/A | No | Dev bootstrap injects URL into SQLite → then → PROBE → READY → HEALTHY |
| **SQLite lost** | N/A (file missing) | N/A | N/A | N/A | → fresh SQLite → `not_started` → SETUP_WIZARD |

---

## Part 3: Database URL Resolution Chain

```mermaid
flowchart TB
    START[App starts] --> LOAD_SQLITE[Load SQLite node_config]
    LOAD_SQLITE --> HAS_URL{databaseUrl<br/>exists and non-empty?}
    
    HAS_URL -->|Yes| PROBE[Run SELECT 1 probe<br/>with 5s timeout]
    PROBE --> REACHABLE{Reachable?}
    REACHABLE -->|Yes| STORE_HEALTHY["Mark: lastKnownGood = now()"]
    STORE_HEALTHY --> USE_URL[✅ Use this URL<br/>→ create shared pool]
    
    REACHABLE -->|No| DIAGNOSE{Categorize error}
    DIAGNOSE -->|ECONNREFUSED| STOP_CONN["FAIL: STOP<br/>DB host refused connection<br/>port wrong? DB down?"]
    DIAGNOSE -->|ETIMEDOUT| STOP_TIMEOUT["FAIL: STOP<br/>Connection timed out<br/>network issue? firewall?"]
    DIAGNOSE -->|ENOTFOUND| STOP_DNS["FAIL: STOP<br/>DB hostname not resolved<br/>check DNS / docker network"]
    DIAGNOSE -->|auth/password| STOP_AUTH["FAIL: STOP<br/>Authentication failed<br/>check credentials"]
    DIAGNOSE -->|"does not exist"| STOP_DBNAME["FAIL: STOP<br/>Database does not exist<br/>check database name"]
    DIAGNOSE -->|other| STOP_OTHER["FAIL: STOP<br/>Unknown error: {msg}"]
    
    HAS_URL -->|No| ASK_MESH{Can we reach<br/>a mesh peer?}
    ASK_MESH -->|Yes, known URL| FETCH_FROM_MESH[Request database URL<br/>from mesh peer]
    FETCH_FROM_MESH --> MESH_URL_RETURNED{URL returned?}
    MESH_URL_RETURNED -->|Yes| VALIDATE_MESH_URL[Validate URL format]
    VALIDATE_MESH_URL --> PERSIST_MESH[Persist to SQLite node_config]
    PERSIST_MESH --> PROBE
    
    MESH_URL_RETURNED -->|No| SETUP_NEEDED["⏩ Enter SETUP_WIZARD<br/>No database URL found<br/>by any method"]
    
    ASK_MESH -->|No mesh URL known| SETUP_NEEDED
    
    style SETUP_NEEDED fill:#f96,stroke:#333,stroke-width:2px
```

### Resolution Order (Chain of Responsibility) — Main App Only

**The main app NEVER reads env vars.** Environment variables (`SETUP_DATABASE_URL`) are only consumed by a dev-mode bootstrap injector that runs BEFORE the main pipeline, seeding the SQLite node_config. The main app's resolution is purely:

```typescript
async function resolveDatabaseUrl(): Promise<string | null> {
  // ── Step 1: Try local SQLite cache (fast path) ────────────────
  const cached = nodeConfig.find()?.databaseUrl?.trim()
  if (cached) {
    logger.log('📦 Found cached database URL in node_config')
    return cached  // ← Most common path: restart with existing config
  }

  // ── Step 2: Ask mesh peers (remote strategy) ──────────────────
  if (meshUrls.length > 0) {
    for (const url of meshUrls) {
      try {
        const meshUrl = await meshClient.discoverDatabaseUrl(url)
        if (meshUrl) {
          logger.log(`🌐 Discovered database URL from mesh peer: ${url}`)
          // Persist so next restart is fast-path
          nodeConfig.upsert({ databaseUrl: meshUrl, ... })
          return meshUrl
        }
      } catch (err) {
        logger.warn(`Failed to query mesh peer ${url}: ${err.message}`)
      }
    }
  }

  // ── Step 3: Nothing found ─────────────────────────────────────
  logger.warn('⏳ No database URL found by any method — setup wizard needed')
  return null
}
```

---

## Part 4: Single Shared Pool Architecture

```mermaid
flowchart TB
    subgraph "Before (Current: 3 Pools)"
        F1[Factory: GLOBAL_DATABASE_POOL] --> P1[Pool #1<br/>max:10 default]
        F2[Factory: GLOBAL_DATABASE_CONNECTION] --> P2[Pool #2<br/>max:10 default]
        F3[Factory: GlobalDatabaseService] --> P3[Pool #3<br/>max:10 default]
        P1 -.->|"❌ Unused"| WASTE[30 connections<br/>on startup]
        P2 --> D2[drizzle #1]
        P3 --> D3[drizzle #2]
    end

    subgraph "After (Proposed: 1 Pool)"
        FACTORY_SINGLE[Single factory: createPool]
        FACTORY_SINGLE --> SINGLE_POOL[Single Pool #1<br/>max: 20, min: 2<br/>connectionTimeout: 5s<br/>idleTimeout: 30s]
        SINGLE_POOL --> DRIZZLE_A[drizzle A<br/>GLOBAL_DATABASE_CONNECTION]
        SINGLE_POOL --> DRIZZLE_B[drizzle B<br/>GlobalDatabaseService]
        SINGLE_POOL --> RAW_POOL[Exposed as<br/>GLOBAL_DATABASE_POOL]
        SINGLE_POOL --> PROBE[Startup probe<br/>SELECT 1]
    end
```

### Proposed Module Structure

```typescript
// global-database.module.ts — NEW version with shared pool

const SHARED_POOL: Pool | null = null  // module-scoped singleton

function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 20,
    min: 2,
    connectionTimeoutMillis: 5_000,   // Fail fast: no infinite wait
    idleTimeoutMillis: 30_000,         // Recycle idle connections
    maxUses: 7_500,                    // Prevent connection memory bloat
    application_name: 'deployer-api',  // Shows in pg_stat_activity
    allowExitOnIdle: true,
  })
}

async function probeDatabase(databaseUrl: string): Promise<void> {
  const probePool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  })
  
  try {
    const start = Date.now()
    await probePool.query('SELECT 1')
    const latency = Date.now() - start
    logger.log(`✅ Database reachable (${latency}ms)`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const diagnostic = categorizeDatabaseError(message)
    logger.error(`❌ Database unreachable: ${diagnostic}`)
    throw new Error(diagnostic)  // ← Fail fast: module init fails, app stops
  } finally {
    await probePool.end().catch(() => undefined)
  }
}

function categorizeDatabaseError(message: string): string {
  if (message.includes('ECONNREFUSED'))
    return 'Connection refused — is the database server running? Check: host, port, and that the container is up.'
  if (message.includes('ETIMEDOUT') || message.includes('timeout'))
    return 'Connection timed out — check firewall rules and network connectivity.'
  if (message.includes('ENOTFOUND'))
    return 'Hostname could not be resolved — check DNS or docker network configuration.'
  if (message.includes('password') || message.includes('authentication'))
    return 'Authentication failed — verify username and password in the connection string.'
  if (message.includes('does not exist'))
    return 'Database does not exist — verify the database name in the connection string.'
  return `Unknown database error: ${message}`
}

@Global()
@Module({ ... })
export class GlobalDatabaseModule {
  static async forRoot(nodeConfig: NodeConfigRepository): Promise<DynamicModule> {
    const url = nodeConfig.find()?.databaseUrl?.trim()
    if (!url) {
      throw new Error('Cannot initialize GlobalDatabaseModule: no database URL in node_config')
    }
    
    // ── PROBE FIRST: fail fast if DB unreachable ───────────
    await probeDatabase(url)
    
    // ── Create shared pool ─────────────────────────────────
    const pool = createPool(url)
    
    // ── Pool error handling ────────────────────────────────
    pool.on('error', (err) => {
      logger.error(`🚨 Pool error: ${err.message}`)
      // Circuit breaker would trip here
    })
    
    return {
      module: GlobalDatabaseModule,
      providers: [
        { provide: GLOBAL_DATABASE_POOL, useValue: pool },
        { provide: GLOBAL_DATABASE_CONNECTION, useFactory: (p: Pool) => drizzle(p, { schema: globalSchema }), inject: [GLOBAL_DATABASE_POOL] },
        { provide: GlobalDatabaseService, useFactory: (p: Pool) => new GlobalDatabaseService(drizzle(p, { schema: globalSchema })), inject: [GLOBAL_DATABASE_POOL] },
      ],
      exports: [GlobalDatabaseService, GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL],
    }
  }
}
```

---

## Part 5: Enhanced Startup State Machine

```typescript
// app-lifecycle-state.service.ts — New centralized state manager

type NodePhase =
  | 'boot'              // Process started
  | 'discovering'       // Resolving database URL
  | 'probing'           // Testing DB connectivity
  | 'ready'             // Pool created, DB reachable
  | 'joining_mesh'      // Connecting to mesh peers
  | 'healthy'           // Fully operational
  | 'degraded'          // DB was lost mid-run, recovery loop
  | 'failed'            // Fatal error — will exit
  | 'shutting_down'     // Graceful shutdown in progress

interface NodeState {
  phase: NodePhase
  databaseUrl: string | null
  databaseReachable: boolean | null
  meshConnected: boolean
  lastKnownGoodAt: string | null    // ISO timestamp
  startedAt: string                 // ISO timestamp
  error: string | null
  configStrategy: 'local' | 'remote' | null
}

@Injectable()
export class AppLifecycleStateService {
  private state: NodeState

  constructor() {
    this.state = {
      phase: 'boot',
      databaseUrl: null,
      databaseReachable: null,
      meshConnected: false,
      lastKnownGoodAt: null,
      startedAt: new Date().toISOString(),
      error: null,
      configStrategy: null,
    }
  }

  transition(phase: NodePhase, metadata?: Partial<NodeState>): void {
    const from = this.state.phase
    this.state = { ...this.state, phase, ...metadata }
    this.logger.log(`🔄 State: ${from} → ${phase}${metadata?.error ? ` ❌ ${metadata.error}` : ''}`)
    
    // If transitioning to 'failed', trigger shutdown
    if (phase === 'failed') {
      this.logger.error(`🚨 Fatal error: ${metadata?.error}`)
      process.exit(1)  // ← Fail fast
    }
  }

  getState(): Readonly<NodeState> {
    return this.state
  }
}

// OrchestratorService — Updated startup flow
async onApplicationBootstrap(): Promise<void> {
  this.lifecycle.transition('discovering')
  
  // ── Step 1: Resolve database URL ────────────────────────────
  const url = await this.resolveDatabaseUrl()
  
  if (!url) {
    this.lifecycle.transition('boot', { error: 'No database URL found' })
    // Start setup wizard instead of failing
    await this.startSetupWizard()
    return
  }
  
  // ── Step 2: Probe database ──────────────────────────────────
  this.lifecycle.transition('probing', { databaseUrl: url })
  const probeResult = await this.probeDatabase(url)
  
  if (!probeResult.reachable) {
    this.lifecycle.transition('failed', { 
      error: probeResult.error,
      databaseReachable: false,
    })
    // process.exit(1) is called inside transition('failed')
    return  // ← Never reached
  }
  
  this.lifecycle.transition('ready', { 
    databaseReachable: true,
    lastKnownGoodAt: new Date().toISOString(),
  })
  
  // ── Step 3: Create pool & start main app ────────────────────
  await this.startMainApp()
  
  // ── Step 4: Connect to mesh ─────────────────────────────────
  this.lifecycle.transition('joining_mesh')
  await this.connectToMesh()
  
  this.lifecycle.transition('healthy', { meshConnected: true })
}
```

---

## Part 6: Local Database Auto-Provisioning (Improved)

### Problem with Current Implementation

The current `PostgresContainerService.startPostgresContainer()` creates a container with `autoRemove: true` and a random UUID name. This means:
- Container name changes every time → Docker leaves orphan containers
- `autoRemove: true` → container is deleted when stopped → data lost unless using volumes
- Volume name is not explicitly set → Docker generates random volume names

### Proposed Improvement

```mermaid
flowchart TB
    TRIGGER[Auto-provision triggered] --> CHECK{Container<br/>deployer-postgres-dev<br/>already exists?}
    CHECK -->|Yes| IS_RUNNING{Is it running?}
    IS_RUNNING -->|Yes| GET_URL[Get its connection URL<br/>from container inspect]
    IS_RUNNING -->|No, stopped| START[Start existing container]
    
    CHECK -->|No, doesn't exist| CREATE[Create new container<br/>with FIXED name]
    
    GET_URL --> RETURN_URL[Return URL → persist to node_config]
    START --> WAIT_HEALTH[Wait for pg_isready]
    WAIT_HEALTH --> GET_URL
    
    CREATE --> VOLUME[Use named volume<br/>deployer_postgres_data]
    VOLUME --> FIXED_NAME['container_name: deployer-postgres-dev']
    FIXED_NAME --> HEALTH_CHECK[healthCheck: pg_isready]
    HEALTH_CHECK --> GET_URL
```

### Implementation

```typescript
// enhanced-postgres-container.service.ts
const MANAGED_CONTAINER_NAME = 'deployer-postgres-dev'
const MANAGED_VOLUME_NAME = 'deployer_postgres_data'

async ensurePostgresRunning(): Promise<string> {
  const docker = this.dockerService.getDockerClient()
  
  // ── Step 1: Check for existing container ──────────────────
  try {
    const existing = docker.getContainer(MANAGED_CONTAINER_NAME)
    const info = await existing.inspect()
    
    if (info.State.Running) {
      // Already running — return its connection URL
      this.logger.log('♻️ Reusing existing Postgres container')
      return this.buildConnectionUrl(info)
    }
    
    // Container exists but stopped — restart it
    this.logger.log('🔄 Restarting stopped Postgres container')
    await existing.start()
    await this.waitForPostgresReady(existing)
    return this.buildConnectionUrl(info)
    
  } catch (err: unknown) {
    // Container doesn't exist — need to create it
    if (err instanceof Error && err.message.includes('no such container')) {
      this.logger.log('📦 Creating new Postgres container')
      return this.createPostgresContainer(docker)
    }
    throw err
  }
}

private async createPostgresContainer(docker: Dockerode): Promise<string> {
  // Ensure named volume exists
  const volumes = await docker.listVolumes()
  const hasVolume = volumes.Volumes?.some(v => v.Name === MANAGED_VOLUME_NAME)
  if (!hasVolume) {
    await docker.createVolume({ Name: MANAGED_VOLUME_NAME })
    this.logger.log(`📀 Created named volume: ${MANAGED_VOLUME_NAME}`)
  }
  
  // Create container with FIXED name
  const container = await docker.createContainer({
    name: MANAGED_CONTAINER_NAME,
    Image: 'postgres:16-alpine',
    Env: [
      'POSTGRES_DB=deployer',
      'POSTGRES_USER=deployer',
      'POSTGRES_PASSWORD=deployer',
    ],
    HostConfig: {
      PortBindings: { '5432/tcp': [{ HostPort: '5432' }] },
      Binds: [`${MANAGED_VOLUME_NAME}:/var/lib/postgresql/data`],
      AutoRemove: false,  // ← CRITICAL: don't delete on stop
    },
    Healthcheck: {
      Test: ['CMD-SHELL', 'pg_isready -U deployer -d deployer'],
      Interval: 1_000_000_000,
      Timeout: 5_000_000_000,
      Retries: 30,
      StartPeriod: 5_000_000_000,
    },
  })
  
  await container.start()
  await this.waitForPostgresReady(container)
  return this.buildConnectionUrl(await container.inspect())
}
```

### Volume Persistence Strategy

```mermaid
flowchart LR
    subgraph "Container Lifecycle"
        C1[First start] -->|creates| V1[(deployer_postgres_data<br/>Named Volume)]
        C1 -->|writes to| V1
        C1 -.->|stop| S1[Container stopped<br/>NOT removed, data persists]
        S1 -->|restart| C2[Same container, same name<br/>Same volume → same data]
        C2 -.->|docker compose down| S2[Container removed<br/>Volume RETAINED]
        S2 -->|docker compose up| C3[New container, same name<br/>Attaches to EXISTING volume]
    end
    
    subgraph "Data Safety"
        V1 --> D1[✅ Data persists across restarts]
        V1 --> D2[✅ Survives container recreation]
        V1 --> D3[❌ Only if volume is not pruned]
    end
```

---

## Part 7: Health Check & Resilience

### Enhanced Health Check Endpoint

```typescript
// health.controller.ts — Returns full node state
@Get('/health')
async health(): Promise<HealthResponse> {
  const state = this.lifecycle.getState()
  
  return {
    status: state.phase === 'healthy' ? 'healthy' 
          : state.phase === 'degraded' ? 'degraded' 
          : 'starting',
    phase: state.phase,
    uptime: Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000),
    database: {
      configured: state.databaseUrl !== null,
      reachable: state.databaseReachable,
      lastKnownGood: state.lastKnownGoodAt,
    },
    mesh: {
      connected: state.meshConnected,
      strategy: state.configStrategy,
    },
    version: DEPLOYER_VERSION,
  }
}
```

### Circuit Breaker for DB Operations

```typescript
// db-circuit-breaker.service.ts
@Injectable()
export class DatabaseCircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed'
  private failureCount = 0
  private lastFailureTime = 0
  private readonly threshold = 5
  private readonly resetTimeoutMs = 30_000
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly lifecycle: AppLifecycleStateService,
    private readonly pool: Pool,
  ) {
    // Listen for pool errors
    this.pool.on('error', () => this.recordFailure())
  }

  async execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime
      if (elapsed < this.resetTimeoutMs) {
        throw new ServiceUnavailableError(
          `Database unavailable (circuit open for ${Math.round((this.resetTimeoutMs - elapsed) / 1000)}s more)`
        )
      }
      this.state = 'half-open'
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.recordFailure()
      throw err
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.lifecycle.transition('healthy', { databaseReachable: true })
    }
    this.failureCount = 0
    this.state = 'closed'
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
  }

  private recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.failureCount >= this.threshold) {
      this.state = 'open'
      this.lifecycle.transition('degraded', {
        databaseReachable: false,
        error: `Circuit breaker opened after ${this.failureCount} failures`,
      })
      this.scheduleRecovery()
    }
  }

  private scheduleRecovery(): void {
    const delay = Math.min(1_000 * 2 ** Math.min(this.failureCount - this.threshold, 5), 30_000)
    this.recoveryTimer = setTimeout(async () => {
      try {
        const probePool = new Pool({
          connectionString: this.pool.config.connectionString!,
          max: 1,
          connectionTimeoutMillis: 3_000,
        })
        await probePool.query('SELECT 1')
        await probePool.end()
        this.onSuccess()
      } catch {
        this.scheduleRecovery()  // Exponential backoff
      }
    }, delay)
  }
}
```

### Pool Drain on Shutdown

```typescript
// main.ts shutdown handler — NEW with proper pool drain
async function gracefulShutdown(signal: string) {
  log.info(`${signal} received — draining connections…`)
  
  // 1. Stop accepting new requests
  server.close()
  
  // 2. Drain Postgres pool
  try {
    await pool.end()
    log.info('✅ Postgres pool drained')
  } catch (err) {
    log.error('Error draining Postgres pool', err)
  }
  
  // 3. Close SQLite
  try {
    sqlite.close()
    log.info('✅ SQLite closed')
  } catch { /* best effort */ }
  
  // 4. Force exit after timeout
  setTimeout(() => process.exit(1), 30_000).unref()
}
```

---

## Part 8: Handling DB Disappearance at Restart

When the app restarts and the database URL from `node_config` points to a database that no longer exists:

```mermaid
flowchart TB
    START[App restarts] --> LOAD_SQLITE[Read node_config<br/>databaseUrl: cached]
    LOAD_SQLITE --> PROBE_DB[SELECT 1 probe<br/>5s timeout]
    PROBE_DB --> RESPONSE{Response?}
    
    RESPONSE -->|"✅ SELECT 1 returned"| CONTINUE[Continue startup<br/>DB is healthy]
    
    RESPONSE -->|"⏱ Timeout"| DOCKER_CHECK{Is Docker<br/>available?}
    DOCKER_CHECK -->|Yes| INSPECT[Inspect container<br/>deployer-postgres-dev]
    INSPECT --> EXISTS{Container exists?}
    EXISTS -->|"⚠️ Yes but stopped"| START_DB[Start it<br/>wait for pg_isready]
    START_DB --> RETRY_PROBE[Retry SELECT 1]
    RETRY_PROBE -->|OK| CONTINUE
    
    EXISTS -->|"❌ No (deleted/pruned)"| LAST_RESORT[Last resort:<br/>try to recreate<br/>but warn about data loss]
    LAST_RESORT --> WARN[⚠️ Log WARNING:<br/>'Previous Postgres container<br/>not found. Creating new one.<br/>Data from previous session<br/>may have been lost.']
    WARN --> RECREATE[Create new container<br/>fresh Postgres]
    RECREATE --> RUN_MIGRATIONS[Run migrations]
    RUN_MIGRATIONS --> CONTINUE_WARN[Continue with<br/>⚠️ degraded status flag]
    
    RESPONSE -->|"❌ ECONNREFUSED<br/>(not a Docker scenario)"| FAIL["🚨 FAIL FAST<br/>exit(1) with diagnostic:<br/>'Database at {url} is unreachable.<br/>Check: network, DNS, credentials.'"]
```

### Implementation

```typescript
// database-startup-guard.service.ts
@Injectable()
export class DatabaseStartupGuard {
  async ensureDatabaseAvailable(nodeConfig: NodeConfigRepository): Promise<void> {
    const url = nodeConfig.find()?.databaseUrl?.trim()
    if (!url) return  // No DB configured — skip guard
    
    const probeResult = await this.probe(url)
    if (probeResult.reachable) return  // ✅ All good
    
    // ── DB unreachable — try to recover if Docker is available ──
    if (await this.isDockerAvailable()) {
      const recovered = await this.tryDockerRecovery()
      if (recovered) {
        logger.warn('⚠️ Database recovered via Docker — data may have been lost')
        return
      }
    }
    
    // ── Cannot recover — fail fast ─────────────────────────────
    const diagnostic = this.buildDiagnostic(url, probeResult.error!)
    logger.error(diagnostic)
    throw new Error(diagnostic)
  }
  
  private async tryDockerRecovery(): Promise<boolean> {
    try {
      const docker = new Dockerode()
      const container = docker.getContainer('deployer-postgres-dev')
      const info = await container.inspect()
      
      if (info.State.Running) {
        // Running but not responding — something else is wrong
        return false
      }
      
      // Container exists but stopped — restart it
      logger.log('🔄 Restarting stopped Postgres container...')
      await container.start()
      await this.waitForPostgres(container)
      return true
      
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('no such container')) {
        // Container was deleted — could recreate but data is lost
        logger.warn('❌ Postgres container not found — cannot recover automatically')
        return false
      }
      logger.error(`Docker recovery error: ${(err as Error).message}`)
      return false
    }
  }
  
  private buildDiagnostic(url: string, error: string): string {
    const redacted = url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
    return [
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `❌ DATABASE CONNECTION FAILED`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `  URL: ${redacted}`,
      `  Error: ${error}`,
      ``,
      `  Possible causes:`,
      `  • Database container stopped or deleted`,
      `  • Network changed (new Docker network IP range)`,
      `  • Credentials rotated but node_config not updated`,
      `  • Host not reachable from this container`,
      ``,
      `  Actions:`,
      `  1. Check if the database is running: docker ps | grep postgres`,
      `  2. Verify network: docker network ls`,
      `  3. Run setup-db again: bun run db:setup --url="postgres://..."`,
      `  4. Or reset and re-run setup wizard`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n')
  }
}
```

---

## Part 9: Proposed File Changes Summary

| File | Action | Change |
|------|--------|--------|
| `apps/api/src/core/modules/database/global/global-database.module.ts` | **Rewrite** | Single shared pool, probe before creating, fail fast |
| `apps/api/src/core/modules/database/shared/database.service.ts` | **Update** | Fix empty `catch {}`, add proper error logging |
| `apps/api/src/core/modules/database/database-connection.ts` | **Keep** | Tokens stay, but consolidate to single pool |
| `apps/api/src/core/orchestrator/orchestrator.service.ts` | **Update** | Add fail-fast probe before main-app starts |
| `apps/api/src/core/modules/docker/containers/postgres/postgres-container.service.ts` | **Rewrite** | Fixed container name, named volume, reuse existing |
| `apps/api/src/main.ts` | **Update** | Add pool drain + SQLite close on shutdown |
| `apps/api/src/core/modules/setup/services/local-initialization.service.ts` | **Update** | Use new PostgresContainerService pattern |
| `apps/api/src/core/modules/database/services/database-probe.service.ts` | **New** | Reusable DB probe with categorized errors |
| `apps/api/src/core/modules/lifecycle/app-lifecycle-state.service.ts` | **New** | Centralized state machine |
| `apps/api/src/core/modules/database/services/database-circuit-breaker.service.ts` | **New** | Circuit breaker for DB resilience |
| `apps/api/src/core/modules/database/services/database-startup-guard.service.ts` | **New** | Fail-fast guard with Docker recovery |
| `apps/api/src/core/modules/setup/repositories/node-config.repository.ts` | **Update** | Add `lastKnownGoodAt` field support |

---

## Part 10: Advisor Review — Corrections & Amendments

> The architecture above was reviewed by a senior architect. Below are the corrections and gaps identified.

### 🔴 Correction 1: `process.exit(1)` Inside State Machine

**Original**: `AppLifecycleStateService.transition('failed')` calls `process.exit(1)` directly.

**Problem**: Side effect in a state setter. Makes the state machine untestable and surprising. Unit tests that transition to `failed` kill the test runner.

**Fix**: The state machine fires events. The orchestrator subscribes and decides whether to exit.

```typescript
// AppLifecycleStateService — pure state, no side effects
transition(phase: NodePhase, metadata?: Partial<NodeState>): void {
  const from = this.state.phase
  this.state = { ...this.state, phase, ...metadata }
  this.logger.log(`🔄 State: ${from} → ${phase}`)
  this.eventBus.emit('lifecycle.transition', { from, to: phase, state: this.state })
  // ↑ Fire event, don't kill process
}

// OrchestratorService — decides what to DO with state changes
@OnEvent('lifecycle.transition')
handleTransition({ to }: LifecycleTransitionEvent): void {
  if (to === 'failed') {
    this.logger.error(this.state.getState().error)
    this.gracefulShutdown('FATAL').then(() => process.exit(1))
  }
}
```

### 🔴 Correction 2: Probe After Module Init, Not Inside `forRoot()`

**Original**: `GlobalDatabaseModule.forRoot()` is async and calls `probeDatabase()` before returning.

**Problem**: If probe fails inside `forRoot`, NestJS wraps it in a generic DI error. The structured diagnostic is lost. Also creates a wasteful temporary pool just for probing.

**Fix**: Create the pool synchronously (module init is simple), then probe inside the orchestrator _after_ module init using the real pool's first connection.

```typescript
// GlobalDatabaseModule — synchronous, no probe
static forRoot(nodeConfig: NodeConfigRepository): DynamicModule {
  const url = nodeConfig.find()?.databaseUrl?.trim()
  if (!url) throw new Error('No DB URL in node_config')
  
  const pool = new Pool({
    connectionString: url,
    max: 20, min: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  })
  
  return {
    module: GlobalDatabaseModule,
    providers: [
      { provide: GLOBAL_DATABASE_POOL, useValue: pool },
      { provide: GLOBAL_DATABASE_CONNECTION, useFactory: (p: Pool) => drizzle(p, { schema: globalSchema }), inject: [GLOBAL_DATABASE_POOL] },
      { provide: GlobalDatabaseService, useFactory: (p: Pool) => new GlobalDatabaseService(drizzle(p, { schema: globalSchema })), inject: [GLOBAL_DATABASE_POOL] },
    ],
    exports: [GlobalDatabaseService, GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL],
  }
}

// OrchestratorService — probe AFTER init using the real pool
async onApplicationBootstrap(): Promise<void> {
  await this.probeDatabase(this.pool)  // use the REAL pool's first connection
  this.lifecycle.transition('ready')
}

private async probeDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    this.lifecycle.transition('ready', { databaseReachable: true })
  } catch (err) {
    await pool.end()
    this.lifecycle.transition('failed', { error: categorize(err) })
  } finally {
    client.release()
  }
}
```

### 🔴 Correction 3: Circuit Breaker as Observer, Not Co-Owner

**Original**: `DatabaseCircuitBreaker` owns a parallel `state` field AND calls `lifecycle.transition()`.

**Problem**: Dual state that can diverge. Two sources of truth for DB health.

**Fix**: Strip to a `DatabaseFailureTracker` that only counts failures + schedules recovery. The lifecycle state machine is the sole source of truth.

```typescript
@Injectable()
export class DatabaseFailureTracker {
  private failureCount = 0
  private readonly threshold = 5
  private readonly resetTimeoutMs = 30_000
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly lifecycle: AppLifecycleStateService) {}

  // Called by pool error handler or query interceptor
  recordFailure(): void {
    this.failureCount++
    if (this.failureCount >= this.threshold) {
      this.lifecycle.transition('degraded', {
        error: `${this.failureCount} consecutive failures`,
      })
      this.scheduleRecovery()
    }
  }

  recordSuccess(): void {
    this.failureCount = 0
    if (this.lifecycle.getState().phase === 'degraded') {
      this.lifecycle.transition('healthy')
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
  }

  private scheduleRecovery(): void {
    const delay = Math.min(1_000 * 2 ** Math.min(this.failureCount - 5, 5), 30_000)
    this.recoveryTimer = setTimeout(async () => {
      const client = await this.pool.connect().catch(() => null)
      if (client) {
        client.release()
        this.recordSuccess()
      } else {
        this.scheduleRecovery()  // Exponential backoff
      }
    }, delay)
  }
}
```

### 🟠 Correction 4: Remove Module-Scoped Singleton

**Original**: `const SHARED_POOL: Pool | null = null` as module-level variable.

**Problem**: Breaks test isolation and HMR. The pool should be DI-managed.

**Fix**: The factory functions receive the pool via DI. The pool is created once as a provider value and injected everywhere.

### 🟠 Correction 5: Decouple Docker Recovery from Guard

**Original**: `DatabaseStartupGuard.tryDockerRecovery()` tries to restart a Docker container.

**Problem**: Concern mixing — the guard should answer "is DB reachable?", not manage containers.

**Fix**: The orchestrator coordinates:
```
orchestrator → guard.probe() → fails
             → postgresContainerService.ensureRunning() → restarts container
             → guard.probe() → succeeds → continue
             → guard.probe() → fails → lifecycle.transition('failed')
```

### 🟢 Gap 6: Add Startup Probe Retry

A single `SELECT 1` with 5s timeout can fail on transient Docker networking. Add 3 retries:
```
Attempt 1: 5s timeout → fail → wait 1s
Attempt 2: 5s timeout → fail → wait 2s
Attempt 3: 5s timeout → fail → STOP with diagnostic
```

### 🟢 Gap 7: Add `acquireTimeoutMillis`

Without it, pool acquisition queues indefinitely when all connections are busy. Add:
```typescript
new Pool({
  ...,
  acquireTimeoutMillis: 10_000,  // Fail if client can't be acquired in 10s
})
```

### 🟢 Gap 8: Add Test Strategy

| Component | How to Test |
|-----------|-------------|
| `AppLifecycleStateService` | Unit test: inject fake event bus, verify transitions fire events, NOT process.exit |
| `DatabaseFailureTracker` | Unit test: inject fake lifecycle, verify threshold → degraded transition |
| `DatabaseStartupGuard` | Integration test: with/without Docker, mock pool |
| Docker recovery | Integration test: start/stop/kill Postgres container, verify recovery |
| Pool consolidation | Unit test: verify single pool is shared across all 3 providers |

### 🟢 Gap 9: Add Metrics Exposure

Add to health endpoint:
```typescript
pool: {
  totalCount: pool.totalCount,
  idleCount: pool.idleCount,
  waitingCount: pool.waitingCount,
}
```

---

## Part 11: Revised Migration Path

Based on the advisor's review, here is the corrected implementation order:

### Phase 1 — State Machine (no side effects)
- Create `AppLifecycleStateService` with event-based transitions (NO `process.exit`)
- Wire into orchestrator + health endpoint
- **Test**: Unit test proves transitions fire events without killing process

### Phase 2 — Fail-Fast Startup Guard
- Add `DatabaseStartupGuard` as orchestrator step
- Probe uses **real pool** (created first, then probed)
- 3 retries with 1s/2s/4s backoff
- Diagnostic output on failure
- **Test**: Verify probe with known-bad URL exits gracefully with diagnostic

### Phase 3 — Single Shared Pool
- Consolidate 3 factory functions → 1 pool creation
- Add explicit pool config (max:20, min:2, connectionTimeoutMillis:5000, acquireTimeoutMillis:10000, idleTimeoutMillis:30000)
- Verify no dead code (GLOBAL_DATABASE_POOL consumption)
- **Test**: Verify pool.totalCount/idleCount match expectations

### Phase 4 — Container Management
- Fixed container name `deployer-postgres-dev`
- Named volume `deployer_postgres_data`
- `AutoRemove: false`
- Existing container detection on startup
- **Test**: Create container → stop → restart → verify same data

### Phase 5 — DatabaseFailureTracker
- Add as observer (no state co-ownership)
- Integrate with pool `error` event
- Recovery probes use `pool.connect()` (not new Pool)
- **Test**: Unit test with fake pool, verify backoff schedule

### Phase 6 — Cleanup
- Remove empty `catch {}` in `isHealthy()` → add proper logging
- Remove dead pool factory code
- Add metrics to health endpoint
- Add pool drain + SQLite close on shutdown
