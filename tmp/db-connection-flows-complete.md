# Database Connection Flows — Local, Remote, and Mesh-Managed

## Complete Reference

---

## Part 1: The Three Connection Modes at a Glance

The database connection is governed by the `strategy` field in the local SQLite `node_config` table. There are exactly **two strategies** (`"local"` and `"remote"`), and **one additional coordination layer** (mesh-managed) that applies on top of either strategy.

| Mode | What It Means | DB URL Source | Multi-Node? |
|------|--------------|---------------|-------------|
| **Locally Managed** | The node owns its database URL | Self-provisioned (Dockerode), or CLI `setup-db`, or `SETUP_DATABASE_URL` env | No — standalone |
| **Remotely Managed** | A mesh gives the node its database URL | Received from `consumeJoinGrant()` response | Yes — joins existing cluster |
| **Mesh-Managed** (add-on) | Cluster coordination via shared Postgres | Same as host strategy | Yes — distributed consensus |

---

## Part 2: The node_config Table — Key to Everything

**File**: `apps/api/src/config/drizzle/local/schema/node-config.ts`

This single-row SQLite table (`id = 1` always) is the **runtime source of truth** for the database connection. It stores everything the node needs to reconnect after a restart:

```
node_config (SQLite, single row)
├── id = 1                             (always)
├── node_id                            (UUID, node identity)
├── strategy: "local" | "remote"       (HOW the DB URL was obtained)
├── setupState:                        (lifecycle: not_started → setup_done → upgrade_*)
├── databaseUrl                        (THE Postgres connection string — null if not configured)
├── deployerVersion                    (from package.json, for version gating)
├── meshUrlsSnapshot[]                 (known peer URLs, for reconnection order)
├── peerServiceToken                   (long-lived token for mesh reconnection — remote only)
├── peerServiceTokenExpiresAt          (expiry for the above)
├── meshSharedSecret                   (shared HMAC key for requireInternalMesh())
├── meshSharedSecretUpdatedAt
├── configuredAt                       (ISO timestamp of first setup completion)
├── scanConfig                         (JSON: per-node scanner preferences)
└── postSetupFlags                     (JSON: feature flags after setup)
```

**Critical rule**: `DATABASE_URL` is **never** read from the environment at runtime. The `SETUP_DATABASE_URL` env var is read **once** by the Phase 0 `SetupDevService`, which persists it to `node_config.databaseUrl`. After that, every component reads from SQLite.

---

## Part 3: The 4-Phase Startup Pipeline

Every API instance goes through this exact boot sequence, orchestrated by `OrchestratorService`:

```mermaid
flowchart TB
    BOOT["main.ts bootstrap()"] --> GW["Phase 1: Gateway Express Server<br/>Port :3005<br/>CORS, RouteRegistry"]
    GW --> DB_RES["Phase 2: DB URL Resolution (headless)"]
    
    subgraph "Phase 2 — SetupDevService"
        DB_RES --> SC[NestFactory.createApplicationContext<br/>SetupDevModule]
        SC --> SVC[SetupDevService.onApplicationBootstrap]
        SVC --> READ{node_config has<br/>databaseUrl?}
        READ -->|Yes| DONE[✅ Already configured]
        READ -->|No| AUTO{SETUP_AUTO?}
        AUTO -->|"true + SETUP_DATABASE_URL"| PERSIST[Persist URL from env<br/>to node_config]
        AUTO -->|"true, no URL"| EMPTY[Persist with empty URL<br/>SQLite-only mode]
        AUTO -->|No| LOG[Log: needs setup wizard]
        DONE --> CLOSE[ctx.close() — destroy context]
        PERSIST --> CLOSE
        EMPTY --> CLOSE
        LOG --> CLOSE
    end
    
    CLOSE --> DECIDE{node_config has<br/>databaseUrl?}
    
    DECIDE -->|Yes| BRIDGE["emitSetupWizardBridge()<br/>→ fire bridge event"]
    BRIDGE --> MESH_INIT["Phase 3: mesh-initializer<br/>Sub-app :3011"]
    MESH_INIT --> MAIN["Phase 4: Main App :3012<br/>225+ routes"]
    
    DECIDE -->|No| WIZARD["Phase 3: setup-wizard Sub-app :3010"]
    WIZARD --> WAIT["await initService.waitForSetup()<br/>(blocks until wizard completes)"]
    WAIT --> BRIDGE
```

### Phase 2 Detail — SetupDevService

```typescript
// apps/api/src/core/setup-dev/setup-dev.service.ts
// Runs INSIDE a lightweight NestJS ApplicationContext (NO HTTP)
// Only depends on LocalDatabaseModule (SQLite), never on GlobalDatabaseModule
class SetupDevService implements OnApplicationBootstrap {
    async onApplicationBootstrap() {
        // CASE 1: Already have databaseUrl → nothing to do
        const config = this.nodeConfigRepository.find();
        if (config?.databaseUrl?.trim()) return;

        // CASE 2: SETUP_AUTO=true + SETUP_DATABASE_URL set → persist
        if (process.env.SETUP_AUTO === "true" && process.env.SETUP_DATABASE_URL) {
            this.nodeConfigRepository.upsert({
                nodeId: randomUUID(),
                strategy: "local",
                setupState: "setup_done",
                databaseUrl: process.env.SETUP_DATABASE_URL,
                configuredAt: new Date().toISOString(),
                // ...
            });
            return;
        }

        // CASE 3: SETUP_AUTO=true, no URL → SQLite-only mode
        // CASE 4: No SETUP_AUTO → log info, wizard needed
    }
}
```

After Phase 2 completes, the NestJS context is destroyed and the gateway starts fresh. The `node_config` table now has the URL (or doesn't), and Phase 3/4 will read it.

---

## Part 4: Locally Managed Flow — Complete Lifecycle

### How It Gets the Database URL

There are **4 paths** to getting a `databaseUrl` in local mode:

| Path | Trigger | Code Path |
|------|---------|-----------|
| **Auto-provision via Docker** | Setup wizard UI, `strategy:'local'`, no `existingDatabaseUrl` | `LocalInitializationService` → `PostgresContainerService.startPostgresContainer()` |
| **Existing URL (manual)** | Setup wizard UI, `existingDatabaseUrl` provided | `LocalInitializationService.probeExistingDatabase()` — runs `SELECT 1` with 5s timeout |
| **Env var (dev)** | `SETUP_AUTO=true` + `SETUP_DATABASE_URL` env | `SetupDevService` writes to `node_config` on Phase 2 |
| **CLI command** | `bun src/cli.ts setup-db --url="postgres://..."` | `SetupDbCommand` → `NodeConfigRepository.upsert()` |

### The Full Local Auto-Provision Flow

```mermaid
sequenceDiagram
    participant User as Admin (Browser)
    participant Wiz as Setup Wizard (:3010)
    participant Init as InitializationService
    participant Local as LocalInitializationService
    participant PGC as PostgresContainerService
    participant Docker as Docker Daemon
    participant PG as PostgreSQL
    participant SQLite as node_config
    participant Main as Main App (:3012)

    User->>Wiz: POST /api/setup/initialize { strategy: "local", name, email, ... }
    Wiz->>Init: triggerInitialize(input)
    Init->>Init: runInitialize → runLocalFlow
    
    Note over Init,Local: STEP: provision_database
    
    Init->>Local: initialize(input, tracker, emit)
    Local->>Local: No existingDatabaseUrl → provisionDockerDatabase()
    Local->>PGC: startPostgresContainer()
    PGC->>Docker: docker.createContainer(postgres:16-alpine)
    Note over PGC: Env: POSTGRES_DB=deployer, POSTGRES_USER=deployer, POSTGRES_PASSWORD=deployer
    PGC->>Docker: Expose 5432, autoRemove, healthCheck: pg_isready
    Docker-->>PGC: container object with connection URL
    PGC->>Docker: Attach live log stream
    Docker-->>Local: Database URL: postgres://deployer:deployer@host:port/deployer
    
    Note over Init,Local: STEP: ensure_empty
    
    Local->>PG: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    PG-->>Local: 0 rows (empty database)
    
    Note over Init,Local: STEP: run_migrations
    
    Local->>PG: migratePg(drizzle, { migrationsFolder })
    Note over PG: Reads __drizzle_migrations journal<br/>Applies 13 migration files (0000-0012)<br/>Creates all 61 tables
    PG-->>Local: ✅ 13 migrations applied
    
    Note over Init,Local: STEP: seed_initial_data
    
    Local->>Local: hashPassword(password, cost=12)
    Local->>PG: INSERT INTO "user" (id, name, email, role, ...)
    Local->>PG: INSERT INTO "account" (userId, providerId, password, ...)
    Local->>PG: INSERT INTO "organization" (id, name, slug, ...)
    Local->>PG: INSERT INTO "member" (orgId, userId, role: "owner", ...)
    PG-->>Local: ✅ User + org created
    
    Note over Init,Local: STEP: register_node
    
    Local->>Local: generateMeshSharedSecret()
    Local->>SQLite: NodeConfigRepository.upsert({ nodeId, strategy:"local", setupState:"setup_done", databaseUrl, meshSharedSecret, configuredAt, ... })
    
    Note over Init,Local: STEP: finalize
    
    SQLite-->>Local: ✅ Config persisted
    Local-->>Init: { nodeId, databaseUrl }
    Init-->>Wiz: Emit terminal 'completed' event
    
    Note over Wiz: waitForSetup() resolves
    
    Wiz->>Main: Emit via SetupWizardBridge { databaseUrl, strategy: "local" }
    
    Note over Main: GlobalDatabaseModule factories activate
    
    Main->>SQLite: NodeConfigRepository.find()
    SQLite-->>Main: databaseUrl = postgres://...
    Main->>Main: 3× new Pool({ connectionString: databaseUrl })
    Main->>Main: 3× drizzle(pool, { schema: globalSchema })
    Note over Main: Postgres connection active
    
    User->>Main: GET /api/health
    Main-->>User: 200 OK
```

### Runtime Behavior After Restart (Local)

When a locally-managed node restarts, it takes a much simpler path:

```mermaid
flowchart TB
    RESTART[Container restart] --> MAIN[main.ts bootstrap]
    MAIN --> GW[Gateway :3005 starts]
    GW --> P2[Phase 2: SetupDevService]
    
    P2 --> READ_SQL{node_config<br/>has databaseUrl?}
    READ_SQL -->|Yes, from previous setup| RETURN[✅ Already configured<br/>→ return immediately]
    
    RETURN --> P3[Phase 3: emit to bridge → mesh-init → main-app]
    P3 --> MAIN_APP[Phase 4: Main App :3012]
    
    MAIN_APP --> GDM[GlobalDatabaseModule factories]
    GDM --> NCR[NodeConfigRepository.find()]
    NCR -->|read| SQLITE[(SQLite: databaseUrl)]
    GDM --> POOL[Create pg.Pool × 3]
    
    POOL --> READY[✅ Database connected]
    
    MAIN_APP --> INIT[InitializationService.onModuleInit]
    INIT --> CHECK{strategy = remote?}
    CHECK -->|"local"| SKIP[⏭ Skip mesh reconnection]
    CHECK -->|"remote"| RECONNECT[Reconnect to mesh peers]
    
    READY --> SERVE[Serving requests on :3005]
```

The key point: **a local-mode restart does not re-provision the database**. It reads the persisted URL and creates pools directly. The auto-provision Docker container from the initial setup persists independently (it has `autoRemove: true`, so it lives as long as it runs).

---

## Part 5: Remotely Managed Flow — Complete Lifecycle

### How It Gets the Database URL

Remote mode has exactly **one path**: the two-step mesh bootstrap protocol.

### The Two-Step Bootstrap Protocol

```mermaid
sequenceDiagram
    participant User as Admin
    participant Wiz as Setup Wizard (:3010)
    participant Init as InitializationService
    participant Remote as RemoteInitializationService
    participant Mesh as MeshInitializationService
    participant RemoteApi as Remote Mesh Node
    participant SQLite as SQLite node_config
    participant Main as Main App (:3012)

    User->>Wiz: POST /api/setup/initialize { strategy: "remote", meshUrl, authToken }
    
    Note over Wiz,Remote: STEP 1: reachability_check
    Remote->>RemoteApi: GET /api/mesh/ping
    RemoteApi-->>Remote: pong
    
    Note over Wiz,Remote: STEP 2: mesh_handshake — Phase A: Issue Grant
    
    Remote->>Mesh: issueRemoteJoinGrant(meshUrl, authToken)
    Note over Mesh: Normalize authToken into "better-auth.session_token=..." cookie
    Mesh->>RemoteApi: POST /api/mesh/issue-join-grant (with Cookie header)
    Note over RemoteApi: Remote requiresAuth() middleware<br/>Validates Better Auth session cookie
    RemoteApi-->>Mesh: { grantToken: "abc123..." }
    Note over RemoteApi: Grant stored as hash, 900s TTL
    
    Note over Wiz,Remote: STEP 2: mesh_handshake — Phase B: Consume Grant
    
    Remote->>Mesh: bootstrap(meshUrl, grantToken, serverUrl)
    Mesh->>Mesh: resolveSharedSecret() → get meshSharedSecret from NodeConfigRepository or env
    Mesh->>Mesh: signMeshToken(sharedSecret) → HMAC-signed pre-enrollment header
    Mesh->>RemoteApi: POST /api/mesh/consume-join-grant (with X-Mesh-Internal-Key header)
    Note over RemoteApi: Verifies HMAC via requireInternalMesh()<br/>Validates grantToken hash<br/>Creates node registration
    RemoteApi-->>Mesh: { nodeId, databaseUrl, peerServiceToken, peerServiceTokenExpiresAt, meshSharedSecret, enrolledAt }
    
    Note over Wiz,Remote: STEP 3: version_check
    
    Remote->>RemoteApi: GET remote mesh version
    RemoteApi-->>Remote: "2.1.0"
    Remote->>Remote: semverCompare("2.1.0", "2.1.0") = 0
    Note over Remote: ✅ Version match
    
    Note over Wiz,Remote: STEP 4: register_node
    
    Mesh->>RemoteApi: getMeshNodeUrls() (with peerServiceToken in X-Mesh-Internal-Key)
    RemoteApi-->>Mesh: ["http://peer1:3005", "http://peer2:3005"]
    Remote->>SQLite: NodeConfigRepository.upsert({ strategy:"remote", databaseUrl, peerServiceToken, meshSharedSecret, meshUrlsSnapshot, ... })
    
    Note over Wiz,Remote: STEP 5: finalize
    
    SQLite-->>Remote: ✅ Persisted
    Remote-->>Init: { nodeId, databaseUrl }
    Init-->>Wiz: Emit 'completed'
    Wiz->>Main: Emit via SetupWizardBridge
    
    Note over Main: GlobalDatabaseModule reads URL<br/>Same pattern as local: 3 pools
    Main->>Main: new Pool × 3 → drizzle × 2 → GlobalDatabaseService
```

### The Version Gate Detail

```mermaid
flowchart LR
    V1[Local version: 1.5.0] --> COMPARE[semverCompare]
    V2[Remote version: 2.0.0] --> COMPARE
    COMPARE -->|Local < Remote| BLOCK["⛔ BLOCK: 'A node cannot join a mesh<br/>running a higher version.<br/>Please upgrade this node to 2.0.0'"]
    COMPARE -->|Local = Remote| PASS["✅ Allow join"]
    COMPARE -->|Local > Remote| WARN["⚠️ Allow + WARN: 'This node is ahead.<br/>The mesh should be upgraded.<br/>Upgrade trigger available to super admin'"]
```

### Runtime After Restart (Remote)

The remote restart is different from local because it must **re-establish mesh connectivity**:

```typescript
// InitializationService.onModuleInit() — runs after GlobalDatabaseModule creates pools
async onModuleInit() {
    this.checkConfigAndEmit()  // emits completion so pools unblock
    
    const config = this.nodeConfigRepository.find()
    if (config?.configuredAt && config.strategy === 'remote' && config.meshUrlsSnapshot?.length) {
        const persistedToken = config.peerServiceToken?.trim() ?? ""
        for (const url of config.meshUrlsSnapshot) {
            try {
                // Try each known mesh URL until one accepts the token
                await this.meshInitializationService.connectToMesh(url, {
                    peerServiceToken: persistedToken.length > 0 ? persistedToken : undefined,
                })
                this.logger.log(`✅ Reconnected to mesh at ${url}`)
                break  // First success = done
            } catch (err) {
                this.logger.warn(`Failed to connect to mesh URL ${url}: ${err.message}`)
            }
        }
    }
}
```

```mermaid
flowchart TB
    RESTART[Container restart] --> PHASE2[Phase 2: SetupDevService<br/>reads node_config]
    PHASE2 -->|databaseUrl found| PROCEED[✅ Proceed to Phase 3/4]
    
    PROCEED --> MAIN[Phase 4: Main App]
    MAIN --> READY[GlobalDatabaseModule creates pools<br/>Postgres connected]
    READY --> ON_INIT[InitializationService.onModuleInit]
    
    ON_INIT --> FIND{strategy = remote?}
    FIND -->|No, local| STOP[⏹ No mesh action]
    FIND -->|Yes| ITERATE[Iterate meshUrlsSnapshot]
    
    ITERATE --> TRY[Try mesh URL #1]
    TRY --> SUCCESS{Accepted?}
    SUCCESS -->|Yes| CONNECTED["✅ connectedToMesh(peerServiceToken)<br/>→ create ORPC client session"]
    SUCCESS -->|No| NEXT[Try mesh URL #2...]
    
    CONNECTED --> DONE[✅ Mesh reconnected<br/>Peer calls now work]
```

### Why peerServiceToken Matters

Without the `peerServiceToken` (which is persisted in SQLite), the node would need to go through the entire two-step bootstrap again on every restart. With it, the node can directly reconnect using `connectToMesh()`, which sends the token as `X-Mesh-Internal-Key`:

```
connectToMesh() creates an oRPC client that:
1. Sends X-Mesh-Internal-Key: <peerServiceToken>
2. Calls GET /api/mesh/get-local-node on the remote mesh
3. Remote mesh's requireMeshPeer() middleware validates the HMAC token
4. If valid → returns { nodeId, status, ... }
5. If invalid → 401 → try next mesh URL
```

---

## Part 6: Mesh-Managed — The Coordination Layer

Mesh management is **not a separate strategy** — it's a runtime coordination layer that becomes active whenever a node has a Postgres connection AND is connected to mesh peers. The Postgres database itself becomes the coordination backbone.

### Schema Version Tracking

Every time the main app starts, it writes to two tables:

```mermaid
flowchart TB
    subgraph "On Every Startup"
        START[Main App starts] --> WRITE_SV[UPSERT schema_version]
        WRITE_SV --> SV_DETAIL["nodeId: current node UUID<br/>schemaVersion: '0012'<br/>(from latest __drizzle_migrations entry)<br/>appliedMigrations: ['0000', ..., '0012']<br/>appVersion: '2.1.0'<br/>lastVerification: now()"]
    end
    
    subgraph "Cluster Consensus Table"
        CMS[(cluster_migration_state<br/>singleton, id=1)]
        CMS_VALS["clusterSchemaVersion: '0012'<br/>requiredAppVersion: '>=2.0.0'<br/>consensusNodeIds: ['A','B','C']<br/>recordVersion: 7"]
    end
    
    WRITE_SV --> CMS
    
    subgraph "On Peer API Calls"
        INCOMING[Incoming mesh request] --> GUARD[requireInternalMesh middleware]
        GUARD --> EXTRACT[Extract X-Mesh-Internal-Key]
        EXTRACT --> VERIFY[Verify HMAC signature against meshSharedSecret]
        VERIFY -->|Valid| CHECK_SV[Read caller's identity<br/>from signed token]
        CHECK_SV -->|"Caller's schemaVersion < clusterSchemaVersion"| FLAG[Flag upgrade_pending<br/>but ALLOW call]
        CHECK_SV -->|"Caller's schemaVersion >= clusterSchemaVersion"| ALLOW[✅ Allow call]
    end
```

### Cluster Migration Consensus

```mermaid
sequenceDiagram
    participant NodeA as Node A (v2.1.0)
    participant PG as Shared PostgreSQL
    participant NodeB as Node B (v2.1.0)
    
    Note over NodeA,NodeB: Both nodes are running version 2.1.0
    
    NodeA->>PG: upsert schema_version { nodeId: A, schemaVersion: "0012" }
    NodeB->>PG: upsert schema_version { nodeId: B, schemaVersion: "0012" }
    
    NodeA->>PG: SELECT * FROM cluster_migration_state
    PG-->>NodeA: { clusterSchemaVersion: "0012", consensusNodeIds: ["A","B"], recordVersion: 7 }
    
    NodeA->>PG: UPDATE cluster_migration_state SET recordVersion=8 WHERE recordVersion=7
    PG-->>NodeA: 1 row affected (optimistic lock acquired)
    
    Note over NodeA,PG: Both nodes agree on schema version
    
    NodeA->>NodeB: GET /api/mesh/get-local-node (X-Mesh-Internal-Key)
    NodeB->>NodeB: requireInternalMesh() → verify HMAC
    NodeB->>NodeB: Check schema_version of caller vs cluster_migration_state
    NodeB-->>NodeA: { nodeId: B, schemaVersion: "0012", status: "healthy" }
```

### What Happens on Version Drift

```mermaid
flowchart TB
    DRIFT[Version drift detected] --> BEHIND{Node is behind?}
    
    BEHIND -->|Yes, node lags cluster| FLAG_UPGRADE[Flag: upgrade_pending]
    FLAG_UPGRADE --> BLOCKING{Is this a blocking call?}
    BLOCKING -->|"requireMesh() (user-facing)"| WARN[Allow but warn user<br/>in response headers]
    BLOCKING -->|"requireInternalMesh() (peer)"| ALLOW_PEER[Allow the call<br/>but record mismatch]
    
    BEHIND -->|No, node ahead?| SHOULD_NOT[🔴 Should never happen<br/>Version gate at bootstrap blocks this]
    
    subgraph "Upgrade Resolution"
        UPGRADE[Node upgrades package.json] --> RESTART[Restart container]
        RESTART --> NEW_VER[onModuleInit: upsert schema_version with new version]
        NEW_VER --> CONSENSUS{All nodes at<br/>same version?}
        CONSENSUS -->|Yes, consensus reached| SETTLE[Update cluster_migration_state<br/>Advance clusterSchemaVersion]
        CONSENSUS -->|No, other node still behind| WAIT[Wait for other node<br/>to upgrade and restart]
    end
```

---

## Part 7: The GlobalDatabaseModule — Runtime Connection Mechanics

This is the module that **creates the actual Postgres connections**. Understanding it is key to understanding all three modes.

### What Happens at Module Init

```mermaid
flowchart TB
    MODULE[GlobalDatabaseModule<br/>@Global()] --> NESTJS[NestJS creates module]
    NESTJS --> PROVIDERS[NestJS evaluates providers]
    
    PROVIDERS --> F1[useFactoryPool<br/>GLOBAL_DATABASE_POOL]
    PROVIDERS --> F2[useFactoryDrizzle<br/>GLOBAL_DATABASE_CONNECTION]
    PROVIDERS --> F3[useFactoryService<br/>GlobalDatabaseService]
    
    F1 -->|1st call| NCR1[NodeConfigRepository.find()]
    F2 -->|2nd call| NCR2[NodeConfigRepository.find()]
    F3 -->|3rd call| NCR3[NodeConfigRepository.find()]
    
    NCR1 -->|all read| SQLITE[(node_config<br/>databaseUrl)]
    NCR2 --> SQLITE
    NCR3 --> SQLITE
    
    F1 --> POOL1[new Pool({connectionString})]
    F2 --> POOL2[new Pool({connectionString})]
    F3 --> POOL3[new Pool({connectionString})]
    
    POOL1 -->|GLOBAL_DATABASE_POOL| UNUSED["❌ Is this actually consumed?<br/>Check needed"]
    POOL2 --> DRIZZLE2[drizzle(pool, schema)]
    POOL3 --> DRIZZLE3[drizzle(pool, schema)]
    DRIZZLE3 --> SERVICE[GlobalDatabaseService<br/>passed to all repositories]
    
    DRIZZLE2 -->|GLOBAL_DATABASE_CONNECTION| CONSUMED["✅ Consumed by repositories<br/>that inject the Drizzle handle"]
```

### The requireDatabaseUrl Gate

```typescript
function requireDatabaseUrl(nodeConfig: NodeConfigRepository): string {
    const config = nodeConfig.find()
    const url = config?.databaseUrl?.trim()
    if (!url) {
        // THROWS — module init fails, app won't start
        throw new Error('No database URL in node_config — cannot start.')
    }
    return url
}
```

This is called **3 times** during module initialization (once per factory). If the URL is missing:
- In Phase 4 (main app): the module fails to initialize, the app crashes
- In the setup wizard (Phase 3): the wizard runs its own DI without GlobalDatabaseModule, so it never hits this gate
- In the CLI: the CLI module has its own `resolveCliDatabaseUrl()` with different fallback behavior (falls back to empty string with warning rather than throwing)

### The SQLite Connection (Always Available)

While the Postgres connection depends on `node_config.databaseUrl`, the **SQLite connection is always available**:

```typescript
// LocalDatabaseModule — runs on EVERY startup, no gate
@Global()
@Module({
    providers: [
        {
            provide: LOCAL_DATABASE_CONNECTION,
            useFactory: () => {
                const dbPath = process.env.NODE_LOCAL_DB_PATH ?? "/app/data/local.db";
                // Create directory if missing
                const sqlite = new BunSqliteDatabase(dbPath);
                sqlite.run("PRAGMA journal_mode = WAL;");
                sqlite.run("PRAGMA busy_timeout = 5000;");
                // Auto-run SQLite migrations
                runSqliteMigrations(sqlite);
                return drizzleSqlite(sqlite, { schema: localSchema });
            },
        },
    ],
})
```

This is why the Phase 0 `SetupDevService` can work without Postgres — it only needs the LocalDatabaseModule, which has zero external dependencies.

---

## Part 8: How the Three Modes Affect the Running App

```mermaid
flowchart LR
    subgraph "At Runtime (all modes)"
        SVC1[Service A] -->|injects| GDS[GlobalDatabaseService]
        SVC2[Service B] -->|injects| GDS
        SVC3[Service C] -->|injects| LDS[LocalDatabaseService]
        
        GDS --> PG[(PostgreSQL<br/>61 tables)]
        LDS --> SQL[(SQLite<br/>2 tables)]
    end
    
    subgraph "Difference by Mode"
        direction TB
        L[LOCAL] --> L1["✅ Postgres connected<br/>❌ No mesh peers<br/>❌ No cluster coordination"]
        R[REMOTE] --> R1["✅ Postgres connected<br/>✅ Mesh peers available<br/>✅ Cluster coordination from start"]
    end
    
    PG --> L
    PG --> R
```

| Capability | Local Mode | Remote Mode |
|------------|-----------|-------------|
| Postgres reads/writes | ✅ Full access | ✅ Full access |
| SQLite reads/writes | ✅ Full access | ✅ Full access |
| Mesh peer API calls | ❌ No peers to call | ✅ Can call other nodes |
| Peer receives calls | ⚠️ Only if other nodes know its URL | ✅ Via mesh registration |
| Schema version tracking | ✅ (writes to `schema_version` on startup) | ✅ Same |
| Cluster migration consensus | ❌ No peers to form consensus | ✅ Participates |
| Resource ownership | ✅ Standalone (owns everything locally) | ✅ Distributed (via `resource_ownership_index`) |
| Auto-reconnect on restart | ✅ Reads URL from SQLite directly | ✅ Reads URL + reconnects to mesh peers |
| Survives without mesh | ✅ Fully operational standalone | ⚠️ Can't restart if all mesh peers down (no URL) |

---

## Part 9: The Complete Data Flow Diagram

```mermaid
flowchart TB
    subgraph "Environment / External"
        ENV[SETUP_DATABASE_URL env]
        AUTO[SETUP_AUTO env]
        DOCKER[Docker Daemon Socket<br/>/var/run/docker.sock]
        REMOTE_MESH[Remote Mesh Node<br/>HTTP / oRPC]
    end

    subgraph "Phase 0: SetupDevService (headless)"
        SDS[SetupDevService.onApplicationBootstrap]
        SDS_NCR[NodeConfigRepository]
        SDS -->|reads| SDS_NCR
        SDS_NCR -->|writes| NC[(node_config SQLite)]
        ENV -.->|SETUP_AUTO=true| SDS
    end

    subgraph "Phase 3: Setup Wizard"
        WIZ[Setup Wizard Sub-App :3010]
        IS[InitializationService]
        LIS[LocalInitializationService]
        RIS[RemoteInitializationService]
        MIS[MeshInitializationService]
        
        WIZ --> IS
        IS --> LIS
        IS --> RIS
        RIS --> MIS
        LIS --> PGC[PostgresContainerService]
        PGC -->|dockerode| DOCKER
        MIS -->|oRPC calls| REMOTE_MESH
        LIS -->|writes URL| NC
        RIS -->|writes URL + tokens| NC
    end

    subgraph "Phase 4: Main App"
        GDM[GlobalDatabaseModule]
        GDM_NCR[NodeConfigRepository]
        GDM -->|reads| GDM_NCR
        GDM_NCR -->|reads| NC
        
        GDM --> P1[Pool #1<br/>GLOBAL_DATABASE_POOL]
        GDM --> P2[Pool #2 → drizzle #1<br/>GLOBAL_DATABASE_CONNECTION]
        GDM --> P3[Pool #3 → drizzle #2<br/>GlobalDatabaseService]
        
        P1 --> PG[(PostgreSQL)]
        P2 --> PG
        P3 --> PG
        
        LDM[LocalDatabaseModule]
        LDM --> SQLITE[new BunSqliteDatabase<br/>drizzle #3]
        SQLITE --> NC
        
        INIT[InitializationService.onModuleInit]
        INIT -->|reads| NC
        INIT -->|"strategy=remote →"| MIS2[MeshInitializationService]
        MIS2 -->|reconnect| REMOTE_MESH
        
        SV[schema_version UPSERT]
        PG -->|on startup| SV
    end

    subgraph "Mesh Coordination"
        CMS[(cluster_migration_state)]
        SV --> CMS
        REMOTE_MESH -.->|updates| CMS
    end
```

---

## Part 10: Key Architectural Principles

### Principle 1: SQLite as Bootstrap Key

The local SQLite database is the **only system component that is always available** — it's created fresh on every startup if it doesn't exist. Everything else (Postgres, mesh connections) is derived from what's stored in it. This creates a clean bootstrap hierarchy:

```
SQLite (always available) → reads node_config → gets databaseUrl
                                             → gets peerServiceToken
                                             → gets meshSharedSecret
                                             → proceeds with Postgres/mesh
```

### Principle 2: DATABASE_URL Is Never Read at Runtime

The env var `DATABASE_URL` doesn't exist. There's only `SETUP_DATABASE_URL`, which is read **once** by `SetupDevService` and immediately persisted. After that, all components read from SQLite. This means:

- The app does not need env vars to be set at runtime (except for SQLite path)
- The database URL survives container restarts (it's in the SQLite volume)
- You can change the database by running `setup-db` again to update the persisted URL

### Principle 3: Circular Dependency Break

The setup wizard cannot import `GlobalDatabaseModule` (because that would require Postgres, which doesn't exist yet). The break pattern is:

```
Setup Sub-App → LocalDatabaseModule only (SQLite) → writes databaseUrl
Main App → LocalDatabaseModule + GlobalDatabaseModule → reads databaseUrl from SQLite
```

The bridge between them is static: `SetupWizardBridge` with a `sharedStates` Map keyed by bridge class name.

### Principle 4: Mode is Immutable After Setup

Once a node has `strategy:'local'` or `strategy:'remote'` in `node_config`, that strategy is **permanent for that node**. There is no code path that transitions from `local` → `remote` or vice versa without manual SQLite editing. To change strategy, you'd need to:

1. Stop the app
2. Delete or reset the SQLite `node_config` table
3. Re-run the setup wizard with the new strategy

---

## Part 11: Trust Model — Secrets in SQLite

The local SQLite database stores secrets that are critical to both modes:

| Secret | Used For | Present in Local? | Present in Remote? |
|--------|----------|------------------|-------------------|
| `databaseUrl` | Postgres connection | ✅ Yes | ✅ Yes |
| `meshSharedSecret` | HMAC signing of `X-Mesh-Internal-Key` | ✅ Yes (generated locally) | ✅ Yes (received from mesh) |
| `peerServiceToken` | Mesh reconnection without re-enrollment | ❌ No (no peers) | ✅ Yes (returned from `consumeJoinGrant`) |

```mermaid
flowchart LR
    subgraph "Local Mode Trust"
        L_NC[(SQLite)] -->|meshSharedSecret| L_MID[requireInternalMesh<br/>middleware]
        L_MID -->|HMAC verify| L_INCOMING[Incoming peer calls]
        L_INCOMING -.->|No peers connected| L_EMPTY[⚠️ Never used<br/>in pure local mode]
    end
    
    subgraph "Remote Mode Trust"
        R_NC[(SQLite)] -->|meshSharedSecret| R_MID[requireInternalMesh<br/>middleware]
        R_NC -->|peerServiceToken| R_CONNECT[connectToMesh<br/>→ X-Mesh-Internal-Key]
        R_NC -->|databaseUrl| R_POOL[pg.Pool → Postgres]
        
        R_MID -->|HMAC verify| R_INCOMING[Verify incoming<br/>peer calls]
        R_CONNECT -->|outgoing auth| R_OUTGOING[Authenticate outgoing<br/>peer calls]
        
        R_POOL -->|read/write| PG[(Shared PostgreSQL)]
        PG -->|schema_version| SYNC[Cluster sync]
        PG -->|cluster_migration_state| CONSENSUS[Cluster consensus]
    end
    
    subgraph "Security Boundary"
        SQLITE_FS[SQLite file on disk<br/>Inside container / app/data/]
    end
```

In local mode, the `meshSharedSecret` is generated but effectively unused (no peers call it). In remote mode, it becomes the trust anchor for all peer-to-peer communication — both incoming (`requireInternalMesh()` middleware) and outgoing (`X-Mesh-Internal-Key` header).

---

## Part 12: Failure Modes by Strategy

| Failure Scenario | Local Mode | Remote Mode |
|-----------------|-----------|-------------|
| **Postgres goes down** | `isHealthy()` returns false, queries throw, app enters degraded state | Same — but mesh peers may notice via `cluster_nodes` health checks |
| **SQLite file deleted** | On next restart: fresh SQLite with `not_started` state → setup wizard required | Same — all secrets lost, full re-enrollment needed |
| **Mesh peer unreachable** | N/A (no peers) | On restart: `onModuleInit()` logs warning for each failed URL, but Postgres still works (URL is cached in SQLite). Mesh features unavailable. |
| **peerServiceToken expires** | N/A (no token) | On restart: reconnection to mesh fails. Postgres still works. Admin must re-run bootstrap to get new token. |
| **meshSharedSecret rotated** | Local: regenerated on next setup. No impact on running app (no peers). | Remote: all peer-to-peer calls fail with 401 until node re-bootstraps to get new secret. |
| **Docker daemon down on startup** | Only affects auto-provisioning (first setup). After URL is persisted, Docker is not needed. | N/A (no auto-provisioning in remote mode) |
| **Container IP changes** | Local: no impact (Postgres URL doesn't change after persistence) | Remote: if mesh peer URLs are IP-based, reconnection fails. DNS-based URLs are fine. |
