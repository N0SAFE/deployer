# Sub-App Architecture

## Overview

Sub-apps are temporary, independent NestJS applications that run during startup.
They handle setup-phase concerns (setup wizard, mesh discovery).
Core modules depend on sub-app results via **bridges** (typed triggers using `BaseTriggerService`).

```
┌──────────────────────────────────────────────────────────────────┐
│                        Main App (NestJS)                         │
│                                                                  │
│  AppModule (@Module)                                             │
│  ├── SetupSubAppModule (@Global)                                 │
│  │   ├── SubAppRunner.forRoot(SetupWizardAppModule, ...)         │
│  │   └── SubAppRunner.forRoot(MeshInitializerAppModule, ...)     │
│  ├── DatabaseModule → GlobalDatabaseModule                       │
│  │   └── awaits meshInitializerBridge.waitFor() directly          │
│  ├── AuthModule.forRootAsync(...)                                │
│  └── FeatureModules (health, user, docker, mesh, etc.)           │
└──────────────────────────────────────────────────────────────────┘
```

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Sub-apps are independent NestJS contexts | Isolated DI prevents cross-contamination, enables clean lifecycle |
| Bridges are module-level singletons (not DI-managed) | Allows sharing across main app and sub-app contexts without NestJS module hierarchy |
| `SetupSubAppModule` is `@Global()` | Makes bridge tokens available app-wide without explicit imports everywhere |
| Sub-app runners use `useFactory` (not `OnModuleInit`) | Sub-apps run during provider resolution, before the app starts accepting requests |
| Health endpoint on raw Express before NestFactory | Ensures `/health` responds even while sub-apps are still initializing |

## Sub-app flow

```
                    Bridge (singleton)         Bridge (singleton)
SetupWizardSubApp ───────────────────▶ MeshInitializerSubApp ───────────────────▶ GlobalDatabaseModule
       │                                       │                                       │
       │  fires setupWizardBridge              │  fires meshInitializerBridge            │  awaits meshInit
       │  { databaseUrl, strategy, nodeId }     │  { databaseUrl, strategy,              │  result to create
       │                                       │    nodeId, meshConnected }              │  Postgres pool
       ▼                                       ▼                                       ▼
  Checks config:                        Awaits wizard result:                   Creates Pool + Drizzle
  - Already configured? → emit           - Try mesh peers for URL               Exports via @Global()
  - DATABASE_URL set? → emit             - Fall back to wizard URL
  - DEV_AUTO_SETUP=true → auto-          - Emit final result
    provision DB, await completion,
    emit bridge
  - Neither? → wait for wizard
```

## `SubAppRunner.forRoot()`

`SubAppRunner.forRoot()` is a `DynamicModule` factory. It:

1. Takes the sub-app's root module and a `bridge` (singleton trigger)
2. Creates an anonymous `SubAppHostModule` that combines the sub-app module with any additional imports
3. In a `useFactory`, it calls `NestFactory.createApplicationContext(SubAppHostModule)`
4. The sub-app's services initialize and fire the bridge when done
5. `useFactory` awaits `bridge.waitFor()`, gets the payload
6. Destroys the sub-app context
7. Returns the payload — which becomes the provider value

```typescript
static forRoot<T extends BaseTriggerService<any>>(
    subAppModule: Type<any>,
    config: { bridge: T; imports?: Type<any>[]; timeout?: number },
): DynamicModule {
    const resultToken = SUB_APP_RESULT(config.bridge);

    @Module({ imports: [...(config.imports ?? []), subAppModule] })
    class SubAppHostModule {}

    return {
        module: SubAppRunner,
        providers: [{
            provide: resultToken,
            useFactory: async () => {
                const ctx = await NestFactory.createApplicationContext(SubAppHostModule);
                try {
                    return await Promise.race([
                        config.bridge.waitFor(),
                        timeout(..., `Sub-app timed out`),
                    ]);
                } finally { await ctx.close(); }
            },
        }],
        exports: [resultToken],
    };
}
```

## Sub-App File Structure

```
src/sub-apps/setup-wizard/
  setup-wizard.app.module.ts    — Root module (like AppModule)
  setup-wizard.bridge.ts        — Bridge trigger (extends BaseTriggerService)
  setup-wizard.service.ts       — Service (implements OnModuleInit, fires bridge)
  setup-wizard.controller.ts    — HTTP surface (served on main Express via SetupWizardApiModule)
  setup-wizard-init.module.ts   — Provides InitializationService dependencies
  setup-wizard.api.module.ts    — Mounts controller on main Express (imported by AppModule)

src/sub-apps/mesh-initializer/
  mesh-initializer.app.module.ts  — Root module
  mesh-initializer.bridge.ts      — Bridge trigger
  mesh-initializer.service.ts     — Service (awaits wizard, discovers DB URL)
```

## Bridge Pattern

Bridges use `BaseTriggerService` from `core/modules/triggers/`. They are module-level singletons:

```typescript
// mesh-initializer.bridge.ts
export const meshInitializerBridge = new MeshInitializerBridge();

// Setup-wizard service: fires bridge when done
setupWizardBridge.emit({ databaseUrl, strategy, nodeId });
setupWizardBridge.complete();

// Mesh-initializer service: awaits wizard bridge, then fires its own
const wizardResult = await setupWizardBridge.waitFor();
meshInitializerBridge.emit({ databaseUrl: finalUrl, strategy, nodeId, meshConnected });
meshInitializerBridge.complete();

// GlobalDatabaseModule: awaits mesh init result
const meshResult = await meshInitializerBridge.waitFor();
pool = new Pool({ connectionString: meshResult.databaseUrl });
```

## `SetupSubAppModule` — Central Sub-App Runner

```typescript
@Global()
@Module({
  imports: [
    SubAppRunner.forRoot(SetupWizardAppModule, { bridge: setupWizardBridge, timeout: 300_000 }),
    SubAppRunner.forRoot(MeshInitializerAppModule, { bridge: meshInitializerBridge, timeout: 30_000 }),
  ],
})
export class SetupSubAppModule {}
```

Imported by `AppModule` (foundation layer, before core modules).

## `GlobalDatabaseModule` — Pool Creation

```typescript
@Global()
@Module({
    imports: [SetupSubAppModule],
    providers: [{
        provide: GLOBAL_DATABASE_POOL,
        useFactory: async () => {
            const meshResult = await meshInitializerBridge.waitFor();
            return new Pool({ connectionString: meshResult.databaseUrl });
        },
    }, ...],
})
export class GlobalDatabaseModule {}
```

## Lifecycle Sequence

```
1. main.ts: server.listen(port) → Express starts, /health responds immediately
2. NestFactory.create(AppModule):
   a. AppModule imports SetupSubAppModule (@Global)
   b. SubAppRunner.forRoot(SetupWizardAppModule, ...) starts:
      - NestFactory.createApplicationContext(SetupWizardAppModule)
      - SetupWizardService.onModuleInit() fires
      - Checks config → emits setupWizardBridge
      - Sub-app context destroyed
   c. SubAppRunner.forRoot(MeshInitializerAppModule, ...) starts:
      - NestFactory.createApplicationContext(MeshInitializerAppModule)
      - MeshInitializerService.onModuleInit() fires
      - Awaits setupWizardBridge.waitFor()
      - Tries mesh peers, falls back to local URL
      - Emits meshInitializerBridge
      - Sub-app context destroyed
   d. GlobalDatabaseModule awaits meshInitializerBridge.waitFor()
   e. Creates Postgres pool
   f. Creates Drizzle instance
3. app.init() completes
4. App is ready to serve requests
```

## Startup Order in AppModule

```
AppModule.imports
├── Foundation (EnvModule, AppLifecycleModule)
│   └── SetupSubAppModule (@Global)  ← sub-apps run here
├── Core (DatabaseModule → GlobalDatabaseModule, AuthModule)
└── Features (health, user, docker, mesh, ...)
```

## Sub-app Dependency Graph

```
AppModule
  └── SetupSubAppModule
        ├── SubAppRunner.forRoot(SetupWizardAppModule)
        │     └── SetupWizardService.onModuleInit()
        │           ├── isConfigured? → read persisted URL, emit bridge immediately
        │           ├── DATABASE_URL set? → emit bridge immediately (transient)
        │           ├── DEV_AUTO_SETUP? → trigger local init, await completion, emit bridge
        │           └── else → wait for user via /setup/* endpoints
        │
        └── SubAppRunner.forRoot(MeshInitializerAppModule)
              └── MeshInitializerService.onModuleInit()
                    ├── await setupWizardBridge.waitFor()
                    ├── try mesh peers → discover DB URL
                    ├── fall back to wizard URL
                    └── emit meshInitializerBridge

GlobalDatabaseModule
  └── await meshInitializerBridge.waitFor()
        └── new Pool({ connectionString: result.databaseUrl })
              └── drizzle(pool) → Drizzle ORM instance
```

## Key Principles

1. **Sub-apps are temporary** — created via `createApplicationContext`, destroyed after bridge fires
2. **Bridges are singletons** — module-level JS objects, not DI-managed, enabling cross-context sharing
3. **SetupSubAppModule is @Global()** — runs all sub-apps, their results available app-wide
4. **Core modules bridge directly** — `GlobalDatabaseModule` awaits `meshInitializerBridge.waitFor()`
5. **Health endpoint independent** — on raw Express before NestFactory, always responds
6. **Controllers on main Express** — setup wizard routes served via `SetupWizardApiModule` imported by AppModule
