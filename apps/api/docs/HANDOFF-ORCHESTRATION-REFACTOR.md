# Handoff: Sub-App Orchestration Refactor

> **Purpose:** This document is a complete handoff for an LLM to understand the full architecture and implement the next iteration of the sub-app orchestration system.
>
> **Priority:** High — the current `main.ts` is overloaded and the shared-context approach was over-engineered.
>
> **Reading time for LLM:** ~10 minutes of analysis. Read ALL sections, including file contents.

---

## Table of Contents

1. [Project Context](#1-project-context)
2. [Tech Stack & Tooling](#2-tech-stack--tooling)
3. [Current Architecture](#3-current-architecture)
4. [What the App Does (Domain)](#4-what-the-app-does-domain)
5. [Key Files & Their Roles](#5-key-files--their-roles)
6. [The Problem](#6-the-problem)
7. [The New Architecture](#7-the-new-architecture)
8. [Detailed File Contents for Context](#8-detailed-file-contents-for-context)
9. [Sub-App Definitions (What to Register)](#9-sub-app-definitions-what-to-register)
10. [Implementation Plan](#10-implementation-plan)
11. [Files to Create, Modify, Delete](#11-files-to-create-modify-delete)
12. [Rules & Constraints](#12-rules--constraints)
13. [AppModule Dependencies (Critical)](#13-appmodule-dependencies-critical)
14. [Testing the Result](#14-testing-the-result)

---

## 1. Project Context

**Monorepo path:** `/home/sebille/Bureau/projects/tests/deployer/v3/`

This is a **deployer platform** — a SaaS-like application that manages Docker deployments, domains, fleet management, mesh networking, and user authentication. The API is a NestJS 11 application with:

- ~20+ feature modules (docker, mesh, deployment, auth, organizations, projects, etc.)
- 225+ API routes
- A **gateway + sub-app architecture** where feature modules run as isolated NestJS applications on separate HTTP ports, proxied through a central gateway

**The key architectural challenge:** The application has a complex initialization sequence:
1. Database URL must be resolved (from env vars, SQLite config, or mesh peer discovery)
2. Setup wizard may need to run (if database not configured)
3. Core infrastructure modules need to initialize (DB pool, auth, event bus)
4. Feature modules need core modules to be available
5. The full AppModule (225+ routes) only starts when everything is ready

Currently this is handled partly in `main.ts`, partly in `SetupSubAppModule`, partly in `SubAppRunner`, and partly in `SubAppCascadeService`. The goal is to **centralize all orchestration logic into a single OrchestrationModule** and make `main.ts` minimal.

---

## 2. Tech Stack & Tooling

### Core
- **Runtime:** Bun (always use `bun --bun run <script>`)
- **Framework:** NestJS 11.1.27
- **Language:** TypeScript (strict mode)
- **Package manager:** Bun (bun.lock)
- **Monorepo:** Turborepo (turbo.json)

### Important Library Versions
- `@nestjs/core`: 11.1.27 (located at `node_modules/.bun/@nestjs+core@11.1.27+.../node_modules/@nestjs/core/`)
- `@nestjs/common`: 11.x
- `@nestjs/platform-express`: 11.x
- `zod`: v4 (via `zod/v4` import)

### Key NestJS Internals (read before implementing)

The `NestFactory` class is the entry point. Each `NestFactory.create()` creates a **brand new `NestContainer`** — there is NO way to inject an existing container. The source is at:

```
node_modules/.bun/@nestjs+core@11.1.27+57003090bf9b7d54/node_modules/@nestjs/core/nest-factory.js
```

The key code is in the `create` method (line ~40):

```javascript
const container = new container_1.NestContainer(applicationConfig, appOptions);
// ...scans modules, creates instances...
const instance = new nest_application_1.NestApplication(container, ...);
```

This means **each sub-app has a fully isolated DI container**. There is no way to share a container between sub-apps at the NestJS framework level. All cross-context sharing must happen through static/procedural means.

### Available Type Declarations (read these)

```typescript
// NestContainer — internal, holds all modules/providers
// Located at: .../injector/container.d.ts
class NestContainer {
  getModules(): ModulesContainer  // Map<string, Module>
  isGlobalModule(metatype): boolean
  addGlobalModule(module: Module): void
  getModuleByKey(moduleKey: string): Module | undefined
}

// ModulesContainer — extends Map<string, Module>
// Located at: .../injector/modules-container.d.ts
class ModulesContainer extends Map<string, Module> {
  applicationId: string
}

// Module — represents a single module in the graph
// Located at: .../injector/module.d.ts
class Module {
  providers: Map<InjectionToken, InstanceWrapper<Injectable>>
  controllers: Map<InjectionToken, InstanceWrapper<Controller>>
  imports: Set<Module>
  exports: Set<InjectionToken>
  isGlobal: boolean
  name: string
  addProvider(provider: Provider): InjectionToken
}

// DiscoveryService — public API for inspecting DI
// Located at: .../discovery/discovery-service.d.ts
class DiscoveryService {
  constructor(modulesContainer: ModulesContainer)
  getProviders(options?): InstanceWrapper[]
  getControllers(options?): InstanceWrapper[]
}

// ModuleRef — abstract class for resolving providers
// Located at: .../injector/module-ref.d.ts
abstract class ModuleRef {
  constructor(container: NestContainer)
  abstract get<T>(typeOrToken): T
  abstract resolve<T>(typeOrToken): Promise<T>
}
```

### Key Findings for Implementation

1. **`(app as any).container`** gives access to the internal `NestContainer`. This is technically a private API but NestJS 11 still uses it. Fragile but functional.
2. **`app.get(DiscoveryService)`** is the public API for inspecting all providers in a running context.
3. **`app.get(ModulesContainer)`** is also injectable — returns the `Map<string, Module>`.
4. **Each context is fully isolated** — providers from context A cannot be injected in context B unless explicitly forwarded via `useValue` providers in the module definition.

---

## 3. Current Architecture

### 3.1 The Gateway

A single Express server on port 3005 handles:
- CORS middleware (all origins in dev, configured origins in prod)
- `/health` endpoint (immediate response for Docker probes)
- NestJS RouterModule as a catch-all proxy

```
Client → Express Gateway (port 3005)
           ├── CORS middleware
           ├── GET /health → immediate 200
           └── NestJS RouterModule
                └── RouterController (@All('*'))
                     └── matches route → proxies to sub-app port
```

### 3.2 Sub-Apps

Each sub-app is an independent NestJS HTTP server on its own loopback port (127.0.0.1:3010+):
- Has its own Express instance
- Has its own NestJS DI container
- Has its own lifecycle (onModuleInit, onApplicationBootstrap)
- Registers its Express routes with the `RouteRegistryService` after init

The gateway proxies to sub-apps based on **longest-prefix matching** on the request path.

### 3.3 Current Bootstrap Sequence (main.ts)

```
bootstrap()
  │
  ├─ Phase 0: Database URL Resolution
  │   └─ Standalone SetupDevModule → reads/writes SQLite node_config
  │
  ├─ Phase 1: Gateway Express Server
  │   ├─ CORS middleware
  │   ├─ /health endpoint
  │   └─ gateway.listen(GATEWAY_PORT)
  │
  ├─ Phase 2: NestJS RouterModule
  │   ├─ NestFactory.create(RouterModule)
  │   ├─ Resolves shared services (GLOBAL_DATABASE_CONNECTION, EnvService)
  │   ├─ Creates wrapped AppModule with shared providers
  │   ├─ Registers setup-app in cascade
  │   └─ app.init() → starts setup-app
  │
  ├─ Phase 3: Wait for DB → Launch Main App
  │   ├─ Gets InitializationService from setup-app
  │   ├─ initService.waitForSetup().then(() => doLaunchMainApp())
  │   └─ doLaunchMainApp():
  │        ├─ runSubApp(main-app, port 3011)
  │        ├─ Registers global filters
  │        ├─ Adds OpenAPI/Scalar endpoints
  │        └─ Sets fallback target to main-app
  │
  └─ Phase 4: Signal Handlers
```

### 3.4 Current Sub-App Lifecycle (SubAppCascadeService)

The cascade is triggered by `OnApplicationBootstrap`. It sequentially:
1. For each registered sub-app definition:
   a. Optionally awaits `waitFor` condition
   b. Calls `runSubApp()` → creates NestJS + Express on its own port
   c. Extracts Express routes → registers with gateway
2. Sets fallback target to the last started sub-app

### 3.5 Current Database Resolution (Phase 0)

This is the most complex initialization dependency:

1. A lightweight Standalone NestJS context (`SetupDevModule`) starts
2. It reads `node_config` from local SQLite
3. If a database URL exists → done
4. If `SETUP_AUTO=true` and `SETUP_DATABASE_URL` set → persists to SQLite
5. If `SETUP_AUTO=true` (no URL) → marks as "local-only" (no Postgres)
6. If none of the above → the app starts without Postgres (setup wizard mode)

**IMPORTANT:** `process.env.DATABASE_URL` is NEVER read or set at runtime. The database URL flows: env vars → SetupDevModule → SQLite `node_config` → DI container.

### 3.6 Current SubAppRunner.forRoot() Pattern

`apps/api/src/core/modules/sub-app-runner/sub-app-runner.module.ts` provides a static factory:

```typescript
SubAppRunner.forRoot(SubAppModule, {
  bridgeClass: SomeBridge,
  imports: [...extraModules],
  providers: [...extraProviders],
  forwardBridges: [OtherBridge],
  timeout: 30_000,
})
```

This:
1. Creates a `@Global()` `SubAppHostModule` wrapping `SubAppModule` + forwarded providers
2. Starts it as a headless `NestFactory.createApplicationContext()` in the background
3. Returns a deferred promise that resolves when the bridge's `waitFor()` fires
4. The bridge is shared via static state (same instance across contexts)

### 3.7 Current Bridge Pattern (BaseTriggerService)

`apps/api/src/core/modules/triggers/base-bridge.service.ts`:

```typescript
class BaseTriggerService<TSchema extends ZodType> extends BaseEventService<...> {
  // Static shared states keyed by bridge class name
  private static sharedStates = new Map<string, { value, resolve }>()
  
  emit(value)    // Fires the bridge with a value
  waitFor()      // Returns Promise that resolves on first emit
  complete()     // Marks as completed
  onValue(fn)    // Subscribe to emissions
}
```

This enables cross-context communication:
- Sub-app A creates `SetupWizardBridge` instance → emits `{ databaseUrl }`
- Main app's factory calls `setupWizardBridge.waitFor()` → gets the result
- Even though they're in different DI containers, the static `sharedStates` map connects them

---

## 4. What the App Does (Domain)

Understanding the domain is critical for ordering sub-apps correctly.

### Core Domains (in rough dependency order)

| Domain | Depends On | Provides |
|--------|-----------|----------|
| **Config/Env** | Nothing | EnvService, parsed env vars |
| **Database** | Config | GLOBAL_DATABASE_POOL (Postgres), GLOBAL_DATABASE_CONNECTION (Drizzle) |
| **Auth** | Database | BetterAuth instance, session handling, permissions |
| **Events** | Nothing | EventBus, BaseEventService |
| **Docker** | Config | DockerService (connects to Docker socket) |
| **Domain** | Database | Domain verification, DNS management |
| **Lifecycle** | Events | App lifecycle management |
| **Bootstrap** | Everything | Bootstrap orchestration |

### Feature Modules (imported by AppModule)

All of these depend on Database + Auth + Docker:

- **AnalyticsModule** — usage analytics
- **DeploymentModule** — deployment management
- **DockerModule** (feature) — Docker container/app management
- **DomainModule** (feature) — domain registration
- **FleetModule** — fleet/agent management
- **GithubModule** — GitHub integration
- **HealthModule** — health checks
- **OrganizationModule** — organization management
- **PermissionModule** — RBAC permissions
- **ProjectModule** — project management
- **ProviderSchemaModule** — provider schema
- **PushModule** — push notifications
- **ServiceModule** — service management
- **SetupModule** — setup wizard
- **TestModule** — testing utilities
- **UserModule** — user management

### The Critical Dependency Chain

```
EnvModule → DatabaseModule → AuthModule → Feature Modules
                                         ↓
                                   225+ HTTP routes
```

**This chain must be fully resolved before main-app can start.**

---

## 5. Key Files & Their Roles

### 5.1 Entry Point & Orchestration

| File Path | Role | Lines |
|-----------|------|-------|
| `apps/api/src/main.ts` | Bootstrap entry — currently handles everything | ~320 lines |
| `apps/api/src/app.module.ts` | Root module — imports ALL feature modules | ~100 lines |

### 5.2 Gateway & Routing

| File Path | Role |
|-----------|------|
| `apps/api/src/core/router/router.module.ts` | NestJS module with RouterController (@All proxy) |
| `apps/api/src/core/router/router.controller.ts` | Catches all requests, proxies to sub-apps |
| `apps/api/src/core/router/sub-app-cascade.service.ts` | Sequential sub-app lifecycle manager |
| `apps/api/src/core/gateway/route-registry.service.ts` | Route graph (longest-prefix match) |

### 5.3 Sub-App Runner

| File Path | Role |
|-----------|------|
| `apps/api/src/core/sub-app/sub-app-runner.ts` | Creates a NestJS app on a port, extracts routes |
| `apps/api/src/core/sub-app/express-route-extractor.ts` | Reads Express router stack for routes |
| `apps/api/src/core/modules/sub-app-runner/sub-app-runner.module.ts` | SubAppRunner.forRoot() factory |
| `apps/api/src/core/modules/sub-app-runner/sub-app.constants.ts` | SUB_APP_RESULT token generator |
| `apps/api/src/core/modules/sub-app-runner/sub-app-result.store.ts` | Static result store |

### 5.4 Core Infrastructure Modules

| File Path | Role |
|-----------|------|
| `apps/api/src/config/env/env.module.ts` | Config/Env — @Global |
| `apps/api/src/core/modules/database/database.module.ts` | Database — @Global |
| `apps/api/src/core/modules/database/global/global-database.module.ts` | Postgres pool + Drizzle |
| `apps/api/src/core/modules/database/local/local-database.module.ts` | SQLite (node_config) |
| `apps/api/src/core/modules/auth/auth.module.ts` | BetterAuth integration |
| `apps/api/src/core/modules/auth/filters/` | Auth filters |
| `apps/api/src/core/modules/events/events.module.ts` | EventBus — @Global |
| `apps/api/src/core/modules/docker/docker.module.ts` | DockerService — @Global |
| `apps/api/src/core/modules/lifecycle/app-lifecycle.module.ts` | Lifecycle — @Global |
| `apps/api/src/core/modules/bootstrap/bootstrap.module.ts` | Bootstrap — @Global |
| `apps/api/src/core/modules/domain/domain.module.ts` | Domain services — @Global |
| `apps/api/src/core/modules/triggers/base-bridge.service.ts` | Bridge base class |

### 5.5 Existing Sub-App Modules

| File Path | Role |
|-----------|------|
| `apps/api/src/sub-apps/setup-sub-app.module.ts` | Orchestrates SetupWizard + MeshInitializer sub-apps |
| `apps/api/src/sub-apps/setup-wizard/setup-wizard.app.module.ts` | Setup wizard sub-app |
| `apps/api/src/sub-apps/setup-wizard/setup-wizard.bridge.ts` | Setup wizard bridge |
| `apps/api/src/sub-apps/setup-wizard/setup-wizard.service.ts` | Setup wizard logic |
| `apps/api/src/sub-apps/setup-wizard/setup-wizard-init.module.ts` | Init helpers — @Global |
| `apps/api/src/sub-apps/mesh-initializer/mesh-initializer.app.module.ts` | Mesh init sub-app |
| `apps/api/src/sub-apps/mesh-initializer/mesh-initializer.bridge.ts` | Mesh init bridge |
| `apps/api/src/sub-apps/mesh-initializer/mesh-initializer.service.ts` | Mesh init logic |
| `apps/api/src/core/modules/mesh/initialization/mesh-initialization.module.ts` | Shared mesh init module |

### 5.6 New Files Created (to be removed/replaced)

| File Path | Why Created | Fate |
|-----------|-------------|------|
| `apps/api/src/core/modules/shared-context/shared-context-bridge.ts` | Shared provider registry | ❌ Remove |
| `apps/api/src/core/modules/shared-context/shared-context.module.ts` | @Global forwarding module | ❌ Remove |
| `apps/api/src/core/modules/shared-context/core-seed.module.ts` | Seed module aggregator | ❌ Remove |
| `apps/api/src/core/modules/shared-context/seed-orchestrator.ts` | Seed bootstrapper | ❌ Remove |
| `apps/api/src/core/modules/shared-context/index.ts` | Barrel exports | ❌ Remove |

### 5.7 Files Modified (to roll back)

| File Path | Change Made | Fate |
|-----------|-------------|------|
| `apps/api/src/core/router/sub-app-cascade.service.ts` | Added `useSharedContext`, `resolveModule()`, auto-populate | ❌ Roll back changes — keep original interface |

---

## 6. The Problem

### 6.1 What's Wrong

1. **`main.ts` is doing too much.** It handles DB resolution, gateway creation, NestJS init, sub-app lifecycle, and signal handlers. This should be delegated.

2. **The `SharedContextBridge` approach was over-engineered.** Creating a seed context to extract ALL providers and forward them to sub-apps via `useFactory` adds complexity without clear benefit. Sub-apps should import core modules directly.

3. **Two parallel sub-app systems exist.** `SubAppRunner.forRoot()` (bridge-based) and `SubAppCascadeService` (sequential HTTP sub-apps) do similar things differently.

4. **The cascade currently has special `useSharedContext` logic** that wraps modules with `SharedContextModule.forRoot()`. This should be removed because sub-apps should import their deps directly.

5. **Bootstrap logic is scattered.** Partially in `main.ts`, partially in `SetupSubAppModule`, partially in `SubAppRunner`, partially in `SubAppCascadeService`.

### 6.2 The Root Cause

The architecture evolved organically:
1. First there was just `AppModule` (everything in one NestJS context)
2. Then came sub-apps (isolated contexts for modularity)
3. Then came bridges (for cross-context communication)
4. Then came SharedContextBridge (for sharing providers)

Each step added a new layer. The result is a system where:
- Cross-context communication has 3 mechanisms (bridges, result store, shared context)
- Module resolution has 2 paths (direct import vs forwarded provider)
- Bootstrap logic is in 4+ locations

### 6.3 What "Over-Engineered" Means Specifically

The `SharedContextBridge` + `CoreSeedModule` approach tried to:
1. Resolve ALL infrastructure modules in a seed context
2. Extract ALL providers into a static Map
3. Forward ALL providers to every sub-app via `useFactory`

This is wrong because:
- Sub-apps that don't need `DockerService` still get it in their DI (even if lazy, it's noise)
- The seed context duplicates what the gateway already does
- `CoreSeedModule` has to list modules that `AppModule` already imports — duplication
- The `@Global()` decorator already makes providers available to importing modules — the forwarding is redundant

---

## 7. The New Architecture

### 7.1 Core Principle

> **The OrchestrationModule is the bridge.** It manages everything:
> - Decides WHEN to start each sub-app based on app state and setup state
> - Provides results/context needed for each sub-app FROM other sub-apps
> - Sub-apps import core modules directly (no forwarded shared deps)
> - The AppModule sub-app is ALWAYS the last to start

### 7.2 What "Orchestrator IS the Bridge" Means

Instead of a `SharedContextBridge` static registry (which tried to share DI providers), the orchestrator only shares **sub-app results** — the typed outputs that sub-apps produce.

```
OrchestratorService
  │
  ├── Sub-app result store (Map<subAppId, any>)
  │   └── "setup-app" → { databaseUrl, isConfigured }
  │   └── "mesh-init" → { nodeId, meshPeers }
  │   └── "main-app"  → { routes: 225 }
  │
  ├── waitForResult(subAppId) → Promise
  │   └── setup-app calls waitForResult('db-resolver')
  │   └── main-app calls waitForResult('setup-app')
  │
  └── start pipeline (OnApplicationBootstrap)
      └── For each sub-app definition:
           ├── await subApp.waitFor(orchestrator)  // if waitFor exists
           ├── await runSubApp(subApp.module, port)
           └── orchestrator.storeResult(subApp.id, result)
```

### 7.3 Sub-App Communication

Sub-apps do NOT:
- Share DI providers
- Import each other's modules
- Receive forwarded bridges from the orchestrator

Sub-apps DO:
- Import the core modules they need directly (e.g., `LocalDatabaseModule`, `EnvModule`)
- Use the orchestrator's result store to get data from prior sub-apps
- Communicate through typed results stored by subAppId

### 7.4 The Orchestrator Pipeline

```
OrchestratorService.run()
  │
  ├── Step 1: Start "db-resolver" sub-app (port 3010)
  │   ├── waitFor: always (no prerequisites)
  │   ├── module: SetupDevModule (standalone, no HTTP needed)
  │   ├── result: { databaseUrl, strategy: "env" | "auto" | "none" }
  │   └── After: orchestrator.storeResult('db-resolver', result)
  │
  ├── Step 2: Start "setup-wizard" sub-app (port 3011)
  │   ├── waitFor: db-resolver.result.strategy === 'none'
  │   │   → only if DB not configured, start the wizard
  │   ├── module: SetupWizardAppModule
  │   ├── result: { databaseUrl, isConfigured }
  │   └── After: orchestrator.storeResult('setup-wizard', result)
  │
  ├── Step 3: Start "mesh-initializer" sub-app (port 3012)
  │   ├── waitFor: db-resolver completed (or setup-wizard completed)
  │   ├── module: MeshInitializerAppModule
  │   ├── reads: orchestrator.getResult('db-resolver') or getResult('setup-wizard')
  │   ├── result: { nodeId, meshPeers, databaseUrl }
  │   └── After: orchestrator.storeResult('mesh-init', result)
  │
  └── Step 4: Start "main-app" (port 3013)
      ├── waitFor: mesh-initializer completed (DB ready)
      ├── module: AppModule (ALL feature modules)
      ├── reads: orchestrator.getResult('mesh-init') for databaseUrl
      └── No result needed — this is the final state
```

### 7.5 Key Simplifications

| Before | After |
|--------|-------|
| `SharedContextBridge` static Map | `OrchestratorService` internal result store |
| Seed context resolves all providers | No seed context — each sub-app imports what it needs |
| `useSharedContext` flag wraps modules | Removed — sub-apps import their own deps |
| `forwardBridges` in `SubAppRunner.forRoot()` | Removed — orchestrator stores results, sub-apps read them |
| `CoreSeedModule` duplicates `AppModule` imports | `AppModule` is the single source of truth for what it needs |
| `DiscoveryService.populateFrom()` spreads providers | Not needed — sub-apps declare their own providers |

---

## 8. Detailed File Contents for Context

### 8.1 main.ts (CURRENT — to be simplified)

The current `main.ts` is at `apps/api/src/main.ts`. It has ~320 lines with 4 phases. The new version should be ~50 lines:

```typescript
// GOAL for main.ts — minimal, clean
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import express from 'express'
import { OrchestrationModule } from './core/orchestrator/orchestrator.module'
import { buildAllowedOrigins, normalizeUrl, isLocalhostOrigin } from './core/utils/cors.utils'
import { logger } from '@repo/logger'

const GATEWAY_PORT = Number(process.env.API_PORT ?? 3005)
const log = logger.scope('GatewayOrchestrator')

function createCorsMiddleware(): express.RequestHandler {
  // ... same as current — CORS handling
}

async function bootstrap() {
  const gateway = express()
  gateway.use(createCorsMiddleware())
  gateway.get('/health', (_req, res) => { res.json({ status: 'ok' }) })
  gateway.listen(GATEWAY_PORT, '0.0.0.0')
  log.info(`Gateway listening on port ${GATEWAY_PORT}`)

  // OrchestrationModule handles EVERYTHING else:
  //   - DB URL resolution
  //   - Sub-app lifecycle (setup → mesh → main-app)
  //   - Route registration
  //   - Signal handlers
  const app = await NestFactory.create(
    OrchestrationModule,
    new ExpressAdapter(gateway),
    { bodyParser: false },
  )
  app.enableShutdownHooks()
  await app.init()

  log.info('Orchestration initialized — sub-app pipeline running')
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err)
  process.exit(1)
})
```

### 8.2 sub-app-runner.ts (EXISTING — keep as-is)

Full path: `apps/api/src/core/sub-app/sub-app-runner.ts`

This is the low-level utility for spawning a sub-app. It should remain unchanged.

```typescript
export interface SubAppOptions {
  id: string
  module: Type<any> | DynamicModule | ForwardReference
  port: number
  initBeforeExtract?: boolean
  afterInit?: (app: INestApplication, server: express.Express) => void | Promise<void>
}

export interface SubAppResult {
  app: INestApplication
  registration: SubAppRegistration
}

export async function runSubApp(
  options: SubAppOptions,
  registry: RouteRegistryService,
): Promise<SubAppResult>
```

What it does:
1. Creates a fresh Express instance for the sub-app
2. Calls `NestFactory.create(options.module, new ExpressAdapter(server))`
3. Calls `app.init()` → runs lifecycle hooks
4. Calls `options.afterInit(app, server)` if provided
5. `extractRoutesFromExpress(app, options.id)` → gets all Express routes
6. Calls `app.listen(options.port, '127.0.0.1')`
7. `registry.register(registration)` → adds routes to the gateway
8. Returns `{ app, registration }`

**Keep this exactly as-is.** It's the building block the orchestrator will use.

### 8.3 sub-app-cascade.service.ts (EXISTING — roll back changes)

Full path: `apps/api/src/core/router/sub-app-cascade.service.ts`

Current state: ~215 lines, modified with `useSharedContext`, `resolveModule()`, and auto-populate logic.

**THE GOAL:** Roll back to the original interface (before shared-context modifications) OR replace entirely with the new `OrchestratorService`. The cascade can be kept as a simple sequential runner if useful, or replaced.

Original (pre-modification) `SubAppDefinition`:

```typescript
export interface SubAppDefinition {
  id: string
  module: SubAppOptions['module']
  portOverride?: number
  options?: Partial<Omit<SubAppOptions, 'id' | 'module' | 'port'>>
  waitFor?: (cascade: SubAppCascadeService) => Promise<void>
}
```

Remove these additions:
- `useSharedContext?: boolean`
- `resolveModule()` method
- `SharedContextBridge.populateFrom()` in `startOne()`
- `SharedContextModule` import

### 8.4 sub-app-runner.module.ts (EXISTING — SubAppRunner.forRoot)

Full path: `apps/api/src/core/modules/sub-app-runner/sub-app-runner.module.ts`

The `SubAppRunner.forRoot()` pattern creates a headless NestJS context (no HTTP server) for running background sub-apps. This is used by `SetupSubAppModule` to run `SetupWizardAppModule` and `MeshInitializerAppModule`.

Key behavior:
1. Injects a bridge class (e.g., `SetupWizardBridge`) from the parent DI
2. Forwards it to the sub-app context via `useValue`
3. Creates a `@Global()` `SubAppHostModule`
4. Starts the sub-app as a background `NestFactory.createApplicationContext()`
5. Returns a deferred promise that resolves when `bridge.waitFor()` fires
6. After resolution, closes the sub-app context

**DECISION POINT:** This pattern can either:
- (A) Be kept for the initial DB resolution/setup-wizard sub-apps (they don't need HTTP)
- (B) Be replaced by having all sub-apps run as HTTP sub-apps via `runSubApp()`

Option (B) is cleaner — all sub-apps follow the same pattern.

### 8.5 BaseTriggerService (EXISTING — bridge pattern)

Full path: `apps/api/src/core/modules/triggers/base-bridge.service.ts`

```typescript
class BaseTriggerService<TSchema extends ZodType> extends BaseEventService<...> {
  private static sharedStates = new Map<string, { value, resolve }>()
  
  emit(value: z.output<TSchema>): void
  complete(): void
  waitFor(): Promise<z.output<TSchema>>
  onValue(fn: (value: z.output<TSchema>) => void): Subscription
  asObservable(): Observable<z.output<TSchema>>
}
```

The `waitFor()` method is key — it returns a Promise that resolves when the bridge's `emit()` is called. The static `sharedStates` ensures that even if the bridge instance is in a different DI container, reading `waitFor()` returns the same promise.

**This is still useful** for sub-apps that need to signal completion to the orchestrator. A sub-app can inject a bridge, call `emit(result)` when done, and the orchestrator can `await bridge.waitFor()`.

### 8.6 SubAppResultStore (EXISTING — static result store)

Full path: `apps/api/src/core/modules/sub-app-runner/sub-app-result.store.ts`

```typescript
const store = new Map<string, unknown>()

export const SubAppResultStore = {
  set(bridgeClass, result): void { store.set(bridgeClass.name, result) },
  get<T>(bridgeClass): T | null { return store.get(bridgeClass.name) as T },
  has(bridgeClass): boolean { return store.has(bridgeClass.name) },
}
```

**DECISION POINT:** This can either be kept (for compatibility with existing bridge code) or replaced by the orchestrator's internal result store.

### 8.7 SetupSubAppModule (EXISTING — orchestrates setup sub-apps)

Full path: `apps/api/src/sub-apps/setup-sub-app.module.ts`

```typescript
@Global()
@Module({
  imports: [
    SubAppRunner.forRoot(SetupWizardAppModule, {
      bridgeClass: SetupWizardBridge,
    }),
    SubAppRunner.forRoot(MeshInitializerAppModule, {
      bridgeClass: MeshInitializerBridge,
      timeout: 30_000,
      imports: [MeshInitializationModule],
      providers: [SetupWizardBridge],
      forwardBridges: [SetupWizardBridge],
    }),
  ],
  providers: [SetupWizardBridge, MeshInitializerBridge],
  exports: [SetupWizardBridge, MeshInitializerBridge],
})
export class SetupSubAppModule {}
```

This module is imported by `AppModule` and runs two sub-apps during NestJS initialization. The `SubAppRunner.forRoot()` creates them as background headless contexts.

**DECISION POINT:** When the new orchestrator takes over, this module's logic moves into the orchestrator's sub-app definitions.

### 8.8 RouterModule (EXISTING — gateway NestJS module)

Full path: `apps/api/src/core/router/router.module.ts`

```typescript
@Module({
  imports: [GlobalDatabaseModule, EnvModule],
  controllers: [RouterController],
  providers: [RouteRegistryService, SubAppCascadeService],
  exports: [RouteRegistryService, SubAppCascadeService],
})
export class RouterModule {}
```

This creates the NestJS proxy layer. The `RouterController` catches all requests and proxies them to sub-apps. The `RouteRegistryService` stores the route graph.

**Crucially:** The `RouterModule` itself resolves `GlobalDatabaseModule` and `EnvModule`. This means the Postgres pool and config are available in the gateway's DI context.

The `OrchestrationModule` will import `RouterModule` and add orchestrator services and sub-app registrations.

### 8.9 AppModule (EXISTING — the "main app")

Full path: `apps/api/src/app.module.ts`

```typescript
@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    AppLifecycleModule,
    BootstrapModule,
    EventsModule,
    ConfigurationCoreModule,
    ProjectCoreModule,
    DeploymentCoreModule,
    AuthModule.forRootAsync({ ... }),
    // 16 feature modules:
    AnalyticsModule, DeploymentModule, DockerModule,
    DomainModule, FleetModule, GithubModule,
    HealthModule, OrganizationModule, PermissionModule,
    ProjectModule, ProviderSchemaModule, PushModule,
    ServiceModule, SetupModule, TestModule, UserModule,
  ],
  providers: [
    InternalErrorInsightService, InternalErrorExceptionFilter, APIErrorExceptionFilter,
    // ...
  ],
})
export class AppModule {}
```

This module is the "main app" — it imports EVERYTHING. Currently it's started as a sub-app in `doLaunchMainApp()` after DB setup completes. It has 225+ routes.

**The `AppModule` sub-app must be the LAST one started**, after all setup/mesh initialization completes.

---

## 9. Sub-App Definitions (What to Register)

### 9.1 db-resolver (Phase 0 replacement)

| Property | Value |
|----------|-------|
| **id** | `"db-resolver"` |
| **module** | `SetupDevModule` (from current Phase 0) |
| **port** | 3010 |
| **waitFor** | None (no prerequisites) |
| **result type** | `{ databaseUrl: string \| null, strategy: "env" \| "auto_local" \| "auto_url" \| "none" }` |
| **purpose** | Resolve the database URL from env/SQLite, persist to node_config |

**Implementation notes:**
- This is currently a standalone `NestFactory.createApplicationContext(SetupDevModule)` in `resolveDatabaseUrl()` in main.ts
- It can either remain as a headless context (no HTTP) or become a full HTTP sub-app
- If headless, the orchestrator calls `await NestFactory.createApplicationContext()` directly
- After it completes, the orchestrator stores the result

### 9.2 setup-wizard (if DB not configured)

| Property | Value |
|----------|-------|
| **id** | `"setup-wizard"` |
| **module** | `SetupWizardAppModule` |
| **port** | 3011 |
| **waitFor** | `db-resolver.result.strategy === 'none'` (only if no DB configured) |
| **result type** | `{ databaseUrl: string }` or skipped entirely |
| **purpose** | Run web-based setup wizard to configure database |

**Implementation notes:**
- This sub-app is CONDITIONAL — only starts if the database isn't configured
- The waitFor condition checks: did db-resolver find a URL? If yes, skip setup-wizard
- If the wizard completes, it emits the database URL via its bridge
- When the orchestrator gets the result, it persists the URL and proceeds

### 9.3 mesh-initializer

| Property | Value |
|----------|-------|
| **id** | `"mesh-initializer"` |
| **module** | `MeshInitializerAppModule` |
| **port** | 3012 |
| **waitFor** | Database URL available (from either db-resolver or setup-wizard) |
| **result type** | `{ nodeId: string, meshPeers: string[], databaseUrl: string }` |
| **purpose** | Discover database URL from mesh peers if not already configured |

**Implementation notes:**
- Reads the database URL from the orchestrator (which got it from db-resolver or setup-wizard)
- If URL is already known, this sub-app just validates it and discovers mesh peers
- If URL is not known, this sub-app attempts peer discovery
- After completion, the orchestrator has the final verified database URL

### 9.4 main-app (AppModule — last)

| Property | Value |
|----------|-------|
| **id** | `"main-app"` |
| **module** | `AppModule` |
| **port** | 3013 |
| **waitFor** | mesh-initializer completed (database is ready) |
| **result type** | None (this is the terminal state) |
| **purpose** | Start ALL feature modules with 225+ routes |

**Implementation notes:**
- This imports `AppModule` directly — NO forwarded providers, NO shared context
- The database pool is already created and available via `GlobalDatabaseModule`
- Auth is already initialized via `AuthModule.forRootAsync()`
- All feature modules start with fully resolved dependencies
- After this sub-app starts, the gateway proxies all requests to it

---

## 10. Implementation Plan

### Step 1: Create OrchestratorService

Create `apps/api/src/core/orchestrator/orchestrator.service.ts`:

```typescript
@Injectable()
export class OrchestratorService implements OnApplicationBootstrap {
  private subAppResults = new Map<string, unknown>()
  private resultResolvers = new Map<string, (value: unknown) => void>()
  private readonly logger = new Logger(OrchestratorService.name)
  
  constructor(
    private readonly registry: RouteRegistryService,
    private readonly seedBootstrapper?: SeedBootstrapperService,
  ) {}
  
  // Store a sub-app result
  setResult(subAppId: string, result: unknown): void {
    this.subAppResults.set(subAppId, result)
    const resolver = this.resultResolvers.get(subAppId)
    if (resolver) {
      resolver(result)
      this.resultResolvers.delete(subAppId)
    }
  }
  
  // Get a sub-app result (synchronous, may be null)
  getResult<T>(subAppId: string): T | null {
    return (this.subAppResults.get(subAppId) as T) ?? null
  }
  
  // Wait for a sub-app result (async, resolves when available)
  async waitForResult<T>(subAppId: string): Promise<T> {
    const existing = this.subAppResults.get(subAppId)
    if (existing !== undefined) return existing as T
    
    return new Promise<T>((resolve) => {
      this.resultResolvers.set(subAppId, resolve as (v: unknown) => void)
    })
  }
  
  // Has a sub-app completed?
  hasResult(subAppId: string): boolean {
    return this.subAppResults.has(subAppId)
  }
  
  // The main pipeline — called automatically via OnApplicationBootstrap
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('🚀 Orchestrator starting sub-app pipeline...')
    
    // Define sub-apps in order
    const pipeline = [
      { id: 'db-resolver', module: SetupDevModule, port: 3010 },
      { id: 'setup-wizard', module: SetupWizardAppModule, port: 3011,
        waitFor: () => this.getResult('db-resolver')?.strategy === 'none' },
      { id: 'mesh-init', module: MeshInitializerAppModule, port: 3012,
        waitFor: () => this.waitForResult('db-resolver') },
      { id: 'main-app', module: AppModule, port: 3013,
        waitFor: () => this.waitForResult('mesh-init') },
    ]
    
    for (const def of pipeline) {
      // Skip if waitFor condition is not met
      if (def.waitFor) {
        const shouldStart = await def.waitFor()
        if (!shouldStart) {
          this.logger.log(`⏭️ Skipping "${def.id}" — condition not met`)
          continue
        }
      }
      
      // Start the sub-app
      this.logger.log(`▶️ Starting "${def.id}" on port ${def.port}...`)
      const { app, registration } = await runSubApp(
        { id: def.id, module: def.module, port: def.port },
        this.registry,
      )
      
      // Store any result the sub-app produced
      // (Sub-apps use their own bridges to emit results)
      this.setResult(def.id, { ... })
    }
  }
}
```

### Step 2: Create OrchestrationModule

Create `apps/api/src/core/orchestrator/orchestrator.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { RouterModule } from '../router/router.module'
import { OrchestratorService } from './orchestrator.service'

@Module({
  imports: [RouterModule],  // RouterModule provides RouteRegistryService
  providers: [OrchestratorService],
})
export class OrchestrationModule {}
```

### Step 3: Simplify main.ts

Remove from `main.ts`:
- Phase 0 (DB URL resolution) — orchestrator handles this as a sub-app
- Phase 2 (RouterModule creation with manual cascade registration) — OrchestrationModule does this
- Phase 3 (waitForSetup → doLaunchMainApp) — orchestrator handles as the last pipeline step
- Phase 4 signal handlers — orchestrator can handle OR stay in main.ts for simplicity

Keep in `main.ts`:
- Gateway Express server creation
- CORS middleware
- Health endpoint
- `gateway.listen()`
- `NestFactory.create(OrchestrationModule, ...)`
- `app.init()`
- Signal handlers (SIGINT/SIGTERM)

### Step 4: Remove shared-context files

Delete these files:
```
apps/api/src/core/modules/shared-context/shared-context-bridge.ts
apps/api/src/core/modules/shared-context/shared-context.module.ts
apps/api/src/core/modules/shared-context/core-seed.module.ts
apps/api/src/core/modules/shared-context/seed-orchestrator.ts
apps/api/src/core/modules/shared-context/index.ts
```

Delete the directory:
```
apps/api/src/core/modules/shared-context/      (entire folder)
```

### Step 5: Roll back sub-app-cascade.service.ts

Remove from `sub-app-cascade.service.ts`:
- `useSharedContext?: boolean` from `SubAppDefinition`
- `resolveModule()` method
- `SharedContextBridge.populateFrom()` call in `startOne()`
- `SharedContextModule` and `SharedContextBridge` imports

Keep the original `SubAppDefinition` interface and `startOne()` logic.

### Step 6: Wire the result flow

The key question is: **how does a sub-app communicate its result to the orchestrator?**

Two options:

**Option A: Inject the `OrchestratorService` into sub-apps**
- The orchestrator registers itself as a global provider (or the sub-app imports it)
- Sub-apps do: `orchestrator.setResult('my-id', myResult)` when ready

**Option B: Use the existing bridge pattern**
- Each sub-app has a bridge class (e.g., `DbResolverBridge`)
- The orchestrator creates the bridge, passes it to the sub-app
- The orchestrator awaits `bridge.waitFor()` after starting the sub-app

**Option A is simpler** if sub-apps can inject the orchestrator. But since each sub-app is in a different DI container, the orchestrator would need to be forwarded as a `useValue` provider — which is exactly what we said we'd avoid.

**Option B is more compatible** with the existing architecture but adds bridge classes for each sub-app.

**Option C: The orchestrator knows when a sub-app is "done"**
- For `SetupDevModule`: it's a headless context that completes synchronously — the orchestrator awaits `NestFactory.createApplicationContext()` which resolves when `onModuleInit` completes.
- For `SetupWizardAppModule`: it uses `SetupWizardBridge` — the orchestrator creates the bridge, forwards it, and awaits `bridge.waitFor()`.
- For `MeshInitializerAppModule`: same pattern — `MeshInitializerBridge`.
- For `AppModule`: it's done when `app.init()` completes — the orchestrator doesn't need to wait for anything.

---

## 11. Files to Create, Modify, Delete

### 11.1 Create

| File | Purpose |
|------|---------|
| `apps/api/src/core/orchestrator/orchestrator.module.ts` | Root orchestration module — imports RouterModule + sub-app logic |
| `apps/api/src/core/orchestrator/orchestrator.service.ts` | The orchestrator/bridge — manages sub-app pipeline, stores results |
| `apps/api/src/core/orchestrator/index.ts` | Barrel exports |

### 11.2 Modify

| File | Change |
|------|--------|
| `apps/api/src/main.ts` | Remove phases 0, 2, 3 — only create gateway + OrchestrationModule |
| `apps/api/src/core/router/sub-app-cascade.service.ts` | Roll back `useSharedContext` additions (keep original interface) |

### 11.3 Delete

| File | Reason |
|------|--------|
| `apps/api/src/core/modules/shared-context/shared-context-bridge.ts` | Replaced by orchestrator's internal result store |
| `apps/api/src/core/modules/shared-context/shared-context.module.ts` | No shared dep forwarding |
| `apps/api/src/core/modules/shared-context/core-seed.module.ts` | Orchestrator handles sub-app ordering directly |
| `apps/api/src/core/modules/shared-context/seed-orchestrator.ts` | Replaced by OrchestratorService |
| `apps/api/src/core/modules/shared-context/index.ts` | Replaced |
| `apps/api/src/core/modules/shared-context/` (entire dir) | Removed |

### 11.4 Keep (no changes)

| File | Reason |
|------|--------|
| `apps/api/src/core/sub-app/sub-app-runner.ts` | Low-level utility — perfect as-is |
| `apps/api/src/core/sub-app/express-route-extractor.ts` | Used by runSubApp |
| `apps/api/src/core/gateway/route-registry.service.ts` | Used by runSubApp for registration |
| `apps/api/src/core/modules/sub-app-runner/sub-app-runner.module.ts` | May still be used by existing setup sub-apps during transition |
| `apps/api/src/core/modules/sub-app-runner/sub-app.constants.ts` | Token generator |
| `apps/api/src/core/modules/sub-app-runner/sub-app-result.store.ts` | May still be used |
| `apps/api/src/core/modules/triggers/base-bridge.service.ts` | Still useful for sub-app-to-orchestrator signaling |
| All existing sub-app modules | They import core modules directly |

---

## 12. Rules & Constraints

### 12.1 Architecture Rules

1. **Sub-apps import core modules directly.** No forwarded providers, no `useValue` of another context's instances. If a sub-app needs `EnvModule`, it imports `EnvModule`.

2. **No `useSharedContext`.** The flag in `SubAppDefinition` must be removed. No module wrapping with shared context.

3. **No seed context.** No `CoreSeedModule`, no `NestFactory.createApplicationContext()` for the sole purpose of extracting providers.

4. **No `SharedContextBridge`.** The static registry pattern is replaced by the orchestrator's internal result store.

5. **The orchestrator is the ONLY source of cross-sub-app communication.** Sub-apps do not talk to each other directly. They talk to the orchestrator via results.

6. **The orchestrator does NOT resolve DI providers.** It only manages ordering and stores typed results.

### 12.2 Coding Rules (from AGENTS.md)

7. **No type assertions.** No `as unknown as X`, no `as any`, no `@ts-ignore`. If types don't match, fix the types.

8. **Zod schemas for all external data.** Any sub-app result shape must have a Zod schema.

9. **No temporary code.** No `// TODO: fix later`. No `@deprecated` without deletion. No bridge layers between old and new.

10. **Atomic changes.** When deleting `shared-context/`, update ALL imports in the same commit. No "we'll fix imports later."

11. **Type-check before commit.** `bun --bun run api -- type-check` must pass. Pre-existing errors in `packages/utils/auth/` and `packages/contracts/api/` are known and can be ignored.

### 12.3 NestJS Rules

12. **`NestFactory.create()` creates a new container.** Each sub-app gets its own. No sharing.

13. **`(app as any).container` is private API.** Avoid unless absolutely necessary. Accept that it's fragile.

14. **`app.get()` resolves from the same context.** Works within a single sub-app. Does NOT work across sub-apps.

15. **`app.get(DiscoveryService)` is public API.** Use it for introspection of a single context.

### 12.4 Implementation Rules

16. **The `runSubApp()` function is the building block.** Don't replace it. It handles the NestJS creation, route extraction, and gateway registration correctly.

17. **The `OrchestrationModule` imports `RouterModule`.** This ensures the gateway proxy is available before any sub-app starts.

18. **The main-app sub-app is ALWAYS last.** No exceptions. It imports `AppModule` and has all 225+ routes.

19. **Conditional sub-apps.** If a sub-app's `waitFor` returns false, it's skipped. The orchestrator moves to the next sub-app.

---

## 13. AppModule Dependencies (Critical)

This is the list of ALL modules that `AppModule` currently imports. If a sub-app other than main-app needs specific modules, it must import them independently.

### Foundation Modules
```typescript
EnvModule              // Config — ALWAYS needed
DatabaseModule         // DB connection — ALWAYS needed for anything DB-related
AppLifecycleModule     // ALWAYS needed (@Global)
BootstrapModule        // ALWAYS needed (@Global)
EventsModule           // ALWAYS needed (@Global)
```

### Core Modules
```typescript
ConfigurationCoreModule  // Config management
ProjectCoreModule        // Project management
DeploymentCoreModule     // Deployment management
AuthModule.forRootAsync  // Authentication (needs DatabaseModule)
```

### Feature Modules (all need Database + Auth)
```typescript
AnalyticsModule
DeploymentModule
DockerModule
DomainModule
FleetModule
GithubModule
HealthModule
OrganizationModule
PermissionModule
ProjectModule
ProviderSchemaModule
PushModule
ServiceModule
SetupModule
TestModule
UserModule
```

### Key Insight for the Orchestrator

Most of these modules depend on `GLOBAL_DATABASE_CONNECTION` being available. The `DatabaseModule` is `@Global()` and creates the Postgres pool via `GlobalDatabaseModule`. Its factories read from SQLite `node_config` (which was populated by `SetupDevModule` in Phase 0 / db-resolver).

**This means:** The database pool creation happens during `NestFactory.create()` of any module that imports `DatabaseModule`. If the orchestrator's context imports `DatabaseModule`, the pool is created in the gateway/orchestrator context. The main-app sub-app then also imports `DatabaseModule`, which creates ANOTHER pool in its own context.

**Is this OK?** Currently the code handles this via `GLOBAL_DATABASE_CONNECTION` being forwarded as `useValue` from the gateway context to the main-app context. With the new architecture, each sub-app would create its own pool if it imports `DatabaseModule`.

**Solution:** The orchestrator can either:
1. Resolve the pool in the gateway context and forward it (one-time cost)
2. Accept that each sub-app creates its own pool (multiple connections)

Option 1 is pragmatic. The key insight is: **it's OK to forward ONE critical provider (the DB pool) while not forwarding everything.** The orchestration module can export the resolved DB pool as a provider for sub-apps to consume.

But the user said "no shared dependencies." So option 2 (each sub-app creates its own pool) is architecturally cleaner, but means multiple Postgres connections. This is a design trade-off the orchestrator needs to handle.

---

## 14. Testing the Result

After implementation, verify:

1. **`main.ts` is minimal** — no Phase 0/2/3 logic, just gateway + OrchestrationModule
2. **`shared-context/` directory is deleted** — no trace of it remains
3. **`sub-app-cascade.service.ts` has no `useSharedContext`** — clean original interface
4. **`bun --bun run api -- type-check` passes**
5. **The application starts** — gateway on port 3005, health endpoint responds
6. **Sub-apps start in order** — db-resolver → (maybe setup-wizard) → mesh-init → main-app
7. **All 225+ routes are registered** — gateway proxies to main-app
8. **Signal handlers work** — Ctrl+C gracefully shuts down sub-apps and gateway

---

## Appendix A: How NestFactory.create() Works

```javascript
// Simplified from the actual source
async create(moduleCls, serverOrOptions, options) {
  // 1. Create a brand new container
  const container = new NestContainer(applicationConfig, appOptions);
  
  // 2. Scan the module graph and resolve dependencies
  const dependenciesScanner = new DependenciesScanner(container, ...);
  await dependenciesScanner.scan(moduleCls);
  
  // 3. Create instances of all dependencies
  const instanceLoader = new InstanceLoader(container, injector, ...);
  await instanceLoader.createInstancesOfDependencies();
  
  // 4. Create the NestApplication wrapper
  const instance = new NestApplication(container, httpServer, ...);
  
  return instance;
}
```

Each call to `NestFactory.create()` is fully isolated. The only way to share state between them is through static variables, files, or external services (Redis, Postgres, etc.).

## Appendix B: Diagram of New Architecture

```
main.ts (minimal)
  │
  ├── Express Gateway (port 3005)
  │     ├── CORS middleware
  │     ├── GET /health
  │     └── proxies to sub-apps
  │
  └── NestFactory.create(OrchestrationModule)
        ├── Imports: RouterModule
        ├── Provides: OrchestratorService
        │
        └── OrchestratorService.onApplicationBootstrap()
              │
              ├── db-resolver (port 3010)
              │   ├── Module: SetupDevModule
              │   ├── Reads: SQLite node_config
              │   └── Result: { databaseUrl, strategy }
              │
              ├── [setup-wizard] (port 3011) ← conditional
              │   ├── Module: SetupWizardAppModule
              │   ├── Condition: db-resolver got no URL
              │   └── Result: { databaseUrl }
              │
              ├── mesh-initializer (port 3012)
              │   ├── Module: MeshInitializerAppModule
              │   ├── Reads: orchestrator.getResult('db-resolver')
              │   └── Result: { nodeId, meshPeers, databaseUrl }
              │
              └── main-app (port 3013)
                  ├── Module: AppModule (225+ routes)
                  └── All feature modules start here
```

---

*End of handoff document. Read all sections before implementing.*
