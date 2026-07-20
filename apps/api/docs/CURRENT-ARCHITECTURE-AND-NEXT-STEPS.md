# Current Architecture & Next Steps for Sub-App Orchestration

> This document is a handoff prompt for an LLM to understand the current state and implement the next architecture iteration.

---

## 1. Project Overview

**Monorepo:** `/home/sebille/Bureau/projects/tests/deployer/v3/`
**App:** `apps/api/` — NestJS 11 API (Bun runtime)
**Entry point:** `apps/api/src/main.ts`

The API uses a **gateway + sub-apps architecture**:
- A gateway Express server listens on port 3005 (CORS, health check)
- A NestJS `RouterModule` is attached to the same server as the HTTP proxy
- Feature modules run as independent **sub-apps** on separate internal ports (3010+)
- The gateway proxies requests to the correct sub-app based on a route registry

---

## 2. Current State (What Exists)

### 2.1 `main.ts` (needs simplification)

Currently does too much:
- Phase 0: DB URL resolution (standalone NestJS context → SQLite node_config)
- Phase 1: Gateway Express server (CORS, health, listen)
- Phase 2: NestJS RouterModule init (creates NestJS app on the gateway)
- Phase 3: Manually creates sub-apps (setup-app → wait for DB → launch main-app)
- Phase 4: Signal handlers

**Goal:** `main.ts` should ONLY:
- Create the Express gateway (CORS, health, listen)
- Create the OrchestrationModule (which handles everything else)
- Register signal handlers

### 2.2 Files Already Built (to keep / adapt)

**`apps/api/src/core/modules/shared-context/`** — ALL NEW, built in this conversation:

| File | Purpose | Keep? |
|---|---|---|
| `shared-context-bridge.ts` | Static `Map<any, any>` registry of provider instances. Has `populateFrom(app)`, `toProviderArray()`, `register()`, `get()`. | ❌ Remove — orchestrator should be the bridge itself |
| `shared-context.module.ts` | `@Global()` dynamic module that wraps all bridge providers as `useFactory` for injection into any sub-app context. | ❌ Remove — no more forwarding of shared deps |
| `core-seed.module.ts` | Imports all `@Global()` infrastructure modules to resolve them once in a headless seed context. | ❌ Remove — no more seed context |
| `seed-orchestrator.ts` | Helper to bootstrap the seed context, populate bridge, and handle shutdown. | ❌ Remove — orchestrator replaces this |
| `index.ts` | Barrel exports | ❌ Remove |

**`apps/api/src/core/router/sub-app-cascade.service.ts`** — EXISTING, modified in this conversation:

- Added `useSharedContext?: boolean` to `SubAppDefinition`
- Added `resolveModule()` to auto-wrap with `SharedContextModule`
- Added auto `populateFrom()` after each sub-app starts
- `SubAppDefinition` already has `waitFor?: (cascade) => Promise<void>` for ordering

**`apps/api/src/core/sub-app/sub-app-runner.ts`** — EXISTING, NOT modified:

- `runSubApp(options, registry)` — creates a `NestFactory.create()` on a separate Express server with its own port
- Handles init, route extraction, registration with gateway
- Returns `{ app, registration }`

**`apps/api/src/core/modules/sub-app-runner/`** — EXISTING bridge-based sub-app runner:

- `SubAppRunner.forRoot()` — creates sub-app as a background NestJS context, uses bridge pattern for result passing
- `SubAppResultStore` — static registry for bridge results
- `SUB_APP_RESULT` — DI token generator for bridge results

**`apps/api/src/core/modules/triggers/base-bridge.service.ts`** — EXISTING:

- `BaseTriggerService` — event-based bridge with `waitFor()` / `emit()` / `complete()`
- Used by sub-apps to signal completion and pass results to waiting modules

### 2.3 Existing Sub-App Modules

**`apps/api/src/sub-apps/setup-sub-app.module.ts`** — runs two sub-apps via `SubAppRunner.forRoot()`:
1. `SetupWizardAppModule` — checks config, provides DB URL via `SetupWizardBridge`
2. `MeshInitializerAppModule` — receives wizard result, discovers DB URL from mesh, uses `MeshInitializerBridge`

**`apps/api/src/app.module.ts`** — the "main app": imports ALL feature modules (docker, mesh, auth, deployment, etc.) with 225+ routes. Currently started manually in `doLaunchMainApp()`.

---

## 3. Key Non-Trivial Dependencies

These modules exist and have complex setup:

### 3.1 Database Setup Flow
```
env vars → SetupDevModule (Phase 0 in main.ts) → SQLite node_config → 
GLOBAL_DATABASE_CONNECTION (Postgres pool) → all feature modules
```

The database URL is resolved from env vars OR discovered from mesh peers, then persisted to SQLite `node_config` table. The `GlobalDatabaseModule` reads from SQLite, NOT from `process.env.DATABASE_URL`.

### 3.2 Core Bootstrap Flow
```
EnvModule → DatabaseModule → AuthModule → EventsModule → 
AppLifecycleModule → BootstrapModule → Feature modules
```

Many modules depend on `GLOBAL_DATABASE_CONNECTION` being available. The auth module (`BetterAuth`) requires the database pool to be resolved.

### 3.3 The "Setup" Problem
Currently the main app can't start until the database is configured (either URL provided or wizard completed). This is the core timing challenge:
- **Phase 0** (in main.ts): resolves DB URL via a lightweight NestJS context
- **Phase 2**: RouterModule starts (no DB needed yet — just the proxy)
- **Phase 3**: setup-app runs → waits for DB config → then main-app starts

---

## 4. The New Architecture Direction

### The Core Principle

> **The OrchestrationModule is the bridge.** It manages everything:
> - Decides WHEN to start each sub-app based on app state and setup state
> - Provides results/context needed for each sub-app from other sub-apps
> - Sub-apps use core modules directly (no forwarded shared deps)
> - At the end, the AppModule sub-app is running

### What "Orchestrator is the bridge" Means

Instead of a separate `SharedContextBridge` static registry and seed context, the orchestrator itself should:
1. Resolve core modules as needed (database, auth, etc.)
2. Start sub-apps based on state (setup wizard needed? → start setup-app first)
3. Transfer results between sub-apps directly (orchestrator holds the references)
4. Only start the main AppModule sub-app when all preconditions are met

### Key Simplifications

1. **No shared dependency forwarding** — sub-apps import core modules directly if they need them. No `SharedContextModule`, no `useFactory` forwarding.
2. **No seed context** — the orchestrator handles core module resolution itself, not a separate headless NestJS context.
3. **Orchestrator IS the bridge** — it stores sub-app results internally and passes them to the next sub-app.
4. **Sub-app ordering is state-driven** — `waitFor` conditions based on actual app state (DB configured? Mesh initialized?).

### How Sub-Apps Get What They Need

Each sub-app module imports ONLY the core modules it truly needs. The orchestrator ensures those core modules are available (resolved in the orchestrator's own DI context or in a prior sub-app).

```typescript
// Example: setup-app only needs database-related core modules
@Module({
  imports: [LocalDatabaseModule, EnvModule],  // NOT all of AppModule
})
class SetupSubAppModule {}

// Example: main-app needs everything
@Module({
  imports: [AppModule],  // ALL feature modules
})
class MainSubAppModule {}
```

### The Orchestrator's Responsibility

```typescript
@Injectable()
class OrchestratorService {
  private results = new Map<string, any>()  // sub-app id → result
  
  // Returns the result of a completed sub-app (or throws if not started)
  getResult<T>(subAppId: string): T | null
  
  // Whether a sub-app has completed
  hasCompleted(subAppId: string): boolean
  
  // Start the orchestration — called once
  async run(): Promise<void>
}
```

---

## 5. What the New `main.ts` Should Look Like

```typescript
// main.ts — MINIMAL
async function bootstrap() {
  // Gateway server (CORS, health, listen)
  const gateway = express()
  gateway.use(createCorsMiddleware())
  gateway.get('/health', (_req, res) => res.json({ status: 'ok' }))
  gateway.listen(GATEWAY_PORT, '0.0.0.0')
  
  // OrchestrationModule handles EVERYTHING else
  const app = await NestFactory.create(OrchestrationModule, new ExpressAdapter(gateway))
  await app.init()
  
  // Signal handlers
  registerShutdownHooks(app)
}
```

---

## 6. Sub-App Definitions (What the Orchestrator Registers)

Each sub-app has:
- **id**: unique identifier
- **module**: the NestJS module to bootstrap (imports what it needs, no shared forwarding)
- **port**: internal HTTP port
- **waitFor**: async condition that resolves when ready to start
- **afterInit**: callback to register filters, middleware

```typescript
interface SubAppRegistration {
  id: string
  module: Type | DynamicModule
  port: number
  waitFor?: (orchestrator: OrchestratorService) => Promise<void>
  afterInit?: (app: INestApplication) => Promise<void>
}
```

### Example Sub-App Pipeline

```
1. setup-app (port 3011)
   waitFor: DB URL available (env or wizard completed)
   provides: databaseUrl, isConfigured
   
2. mesh-initializer (port 3012)  
   waitFor: setup-app completed → reads databaseUrl
   provides: nodeId, meshPeers
   
3. main-app / AppModule (port 3013)
   waitFor: mesh-initializer completed → everything ready
   provides: ALL API routes (225+)
```

---

## 7. Files to Create

### New Files

| File | Purpose |
|---|---|
| `src/core/orchestrator/orchestrator.module.ts` | Root module — imports RouterModule + sub-app modules |
| `src/core/orchestrator/orchestrator.service.ts` | The orchestrator/bridge itself — manages sub-app lifecycle |
| `src/core/orchestrator/sub-app-registry.ts` | Typed registry for sub-app definitions and their results |
| `src/core/orchestrator/index.ts` | Barrel exports |

### Files to Remove

| File | Reason |
|---|---|
| `src/core/modules/shared-context/shared-context-bridge.ts` | Orchestrator IS the bridge |
| `src/core/modules/shared-context/shared-context.module.ts` | No shared dep forwarding |
| `src/core/modules/shared-context/core-seed.module.ts` | No seed context |
| `src/core/modules/shared-context/seed-orchestrator.ts` | Replaced by orchestrator |
| `src/core/modules/shared-context/index.ts` | Replaced |

### Files to Modify

| File | Change |
|---|---|
| `main.ts` | Remove all cascade/sub-app logic — just create OrchestrationModule |
| `sub-app-cascade.service.ts` | Potentially keep as low-level runner, or merge into orchestrator |
| `sub-app-runner.ts` | Keep — it's the low-level "create NestJS on a port" utility |
| `sub-app.constants.ts` | Keep if bridge pattern still used within sub-apps |
| `sub-app-result.store.ts` | Can be replaced by orchestrator's internal state |

---

## 8. Constraints & Rules

1. **Sub-apps import core modules directly** — they do NOT receive forwarded providers. If setup-app needs `LocalDatabaseModule`, it imports it. If main-app needs `DockerModule`, it imports it.
2. **The orchestrator does NOT resolve providers for sub-apps** — it only ensures ordering and passes sub-app results (not DI providers).
3. **Sub-app results are typed** — each sub-app defines what it produces, the orchestrator stores it by `subAppId`.
4. **`waitFor` reads from the orchestrator's result store** — a sub-app waits for another's result: `async (orch) => { await orch.waitForResult('setup-app'); }`.
5. **No bridge forwarding** — the `SubAppRunner.forRoot()` `forwardBridges` pattern can be removed. Sub-apps communicate through the orchestrator.
6. **The cascade is sequential** — each sub-app starts after the previous one's `waitFor` resolves. They share nothing except the orchestrator's result store.
7. **Keep the existing `runSubApp()` utility** — it's clean, low-level, and handles route extraction + gateway registration correctly.

---

## 9. Implementation Order

1. Create `OrchestratorService` with internal result store + `waitForResult()`
2. Create `OrchestratorModule` that imports `RouterModule` + provides `OrchestratorService`
3. Create sub-app definitions as services/constants in the orchestrator module
4. Wire `OnApplicationBootstrap` to start the sub-app pipeline
5. Simplify `main.ts` — remove all cascade/sub-app logic
6. Remove `shared-context/` folder
7. Clean up `sub-app-cascade.service.ts` (remove `useSharedContext` additions)
