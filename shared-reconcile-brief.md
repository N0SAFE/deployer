# Reconcile brief: adapting the setup + bff branch to the migrated `apps/api/shared`

Scope: ONLY what `apps/setup` and `apps/api/bff` actually import. Derived from `shared-surface-changes.md` (per-commit detail) and a grep of
their imports (`@deployer/shared/...` and bff's `@/core|config/...` aliases, which resolve to shared). Everything below is already done in
THIS branch for bff (see the files named); apply the same on your branch.

General rule: a shared `X` that was a Nest class is now a `Context.Service` tag over `XShape`; methods return `Effect` with tagged failures
(`domainError`). Inject by tag, type with the shape, run Effects with `yield*` inside `.effect()` handlers (or `runPromiseUnwrapped` at a Promise edge).

## 0. `apps/setup`

`apps/setup` imports nothing from `@deployer/shared`: it owns its wizard, env, node-state and docker modules. What reaches it is the
**package** surface it already uses from `@deployer/nest-effect` (`createModuleContext`, `createGlobalModule`, `procedure`,
`assertRequirementsMet`). Two behavioural changes there:

1. **`procedure(...).effect()` now runs inside the request boundary** (new `packages/nest/effect/src/boundary.ts`): `CurrentActor`
   (anonymous when no session), `Correlation` and `HttpRequest` are provided per call, domain errors are mapped by kind, defects are hidden
   behind the correlation id. A handler must NOT wrap anything itself. `apps/setup/src/modules/wizard/wizard.controller.ts` needs no change
   unless it wraps effects in its own mapping, in which case delete that wrapper.
2. **The authz gate / boundary now apply down the whole `.use()` chain.** Before, only a direct `procedure(c).effect(...)` was gated;
   `.use(x).effect(...)` bypassed it. With authz off (the default) nothing changes; with `shadow`/`enforce`, handlers that were silently
   un-gated now are. Check any setup handler that relies on being un-gated.
3. `createOrpcModule` takes an optional `boundary: { service, passThroughFailures?, onDomainFailure? }`; setup has its own host, so only add it
   if it wants the `svc-…` defect prefix.

## 1. `apps/api/bff`: modules and wiring

| Was | Now | Where in this branch |
| --- | --- | --- |
| `AuthModule.forRootAsync({ imports:[EnvModule], useFactory: createBetterAuth, inject:[GLOBAL_DATABASE_CONNECTION, EnvService] })` | `AuthModule` (a `createGlobalModule` class, no options, no `forRoot`). Imports `EnvModule`; provides + exports `MODULE_OPTIONS_TOKEN`, `AuthCoreService`, `SessionResolver`. Drop the now-unused `createBetterAuth` / `EnvService` / `GLOBAL_DATABASE_CONNECTION` imports. | `bff.module.ts`, `cli/cli.module.ts` |
| CLI passed `disableBodyParser` / `disableTrustedOriginsCors` | dropped (they only affect the HTTP edge, which the CLI does not mount) | `cli/cli.module.ts` |
| `createOrpcModule()` | unchanged call; optionally `createOrpcModule({ boundary: { service: "bff" } })`. The host no longer injects `REQUEST` (request read from the `ExecutionContext`). | `bff.module.ts` |
| `AppLifecycleModule` | still `AppLifecycleModule.forRoot()` (declared via `declareModule`) | unchanged |
| `PreflightModule.forRoot`, `ServiceHealthModule` | unchanged API; `PreflightService` is now a tag shape `{ run, isReady, reportOrNull }` | unchanged |
| `RoleCatalogueModule` (`core/authz/role-catalogue.module`) | now a `createModuleContext` module over the `RoleCatalogueRefresher` tag (initial load at `onReady`, 30 s loop as `run`) | unchanged import |
| `DatabaseModule`, `LocalDatabaseModule`, `NodeStateModule`, `BootstrapModule` | same imports; internals are Effect services (`DatabasePort` tag provided + exported by `DatabaseModule`; bootstrap orchestrator is an `onReady` lifecycle) | unchanged imports |
| `SupervisorsModule` / `SupervisorsDatabaseModule` / `SupervisorsPlatformModule`, `SwarmModule`, `TraefikModule`, `CoreReachabilityModule`, `PlatformIngressModule`, `InitializationModule` | same imports; providers are factories/tags now (`SupervisorEventBus` is a tag over `SupervisorEventBusFacade`) | unchanged imports |

## 2. `apps/api/bff`: services and shapes it injects

| Import | Old usage | New usage |
| --- | --- | --- |
| `GlobalDatabaseService` (`core/modules/database/global/global-database.service`) | `@Inject(GlobalDatabaseService) private db: GlobalDatabaseService`; `.db` | `@Inject(GlobalDatabaseService) x: GlobalDatabaseServiceShape`; `.db` is still a **sync getter that throws `DatabaseNotInitialized`** before init; also `handle`, `init`, `isInitialized`, `probe()` (Effect). Files: `cli/services/cli-auth.service.ts`, `cli/commands/migrate.command.ts`. |
| `AuthCoreService` (`core/modules/auth/services/auth-core.service`) | `@Inject(AuthCoreService) x: AuthCoreService` (class, static helpers) | tag over `AuthCoreServiceShape` (`api`, `instance`, `createEmptyAuthUtils`, `requireAuth`, `generateAuthOpenAPISchema()` is an Effect failing `AuthOpenApiGeneratorMissing`). In `.effect()` handlers: `yield* AuthCoreService`. Files: `cli/services/cli-auth.service.ts`. |
| `InitializationService` (`core/modules/setup/services/initialization.service`) | `@Inject(InitializationService)`, Promise methods | tag over `InitializationServiceShape`: `getSetupState`, `getNodeStatus`, `assertSetupMutable`, `assertDatabaseProbeAllowed`, `triggerInitialize` are Effects (failures `SetupInitializationFailed`, `SetupAlreadyComplete` (conflict), `DatabaseProbeRefused`, `NodeConfigNotFound` from `setup/setup.errors`); `getInitializeStream()` stays an RxJS Observable. Do not inject it in the controller constructor: `yield* InitializationService` in the handler. File: `domains/setup/controllers/setup.controller.ts`. |
| `ReachabilityService`, `EgressService`, `PlatformConfigService`, `HostnameService`, `platform-names` | classes with Promise methods | `ReachabilityService` / `PlatformConfigService`: tags over factories, every method an Effect (`NodeNotConfigured`, `PublicUrlRequired`, ...). `EgressService`: `makeEgressService`, `external`/`operator`/`fixedExternal` are Effects failing `EgressRequestError { target, reason, failure }` (was `kind`). `HostnameService` stays an abstract class (pure string grammar). Files: `domains/setup/services/post-setup-*.service.ts` (they run the Effects with `Effect.runPromise`; bff depends on `effect`). |
| `MigrationJournalService` (`core/utils/migration-journal.service`) | class, `AppError` | `makeMigrationJournalService(path?)`, Effects failing `MigrationJournalUnavailable`; provided in `CliModule` by a factory. |
| `NodeConfigRepository` (`@deployer/node-state`) | Promise | Effects; `runPromiseUnwrapped(repo.find())` at a Promise edge (`cli/commands/setup-db.command.ts`, `node-startup-check.command.ts`). |
| `live-snapshot.utils` (`core/utils`) | unchanged | unchanged |
| `core/modules/auth/orpc/middlewares` (`publicAccess`, `requireAuth`, ...) | unchanged | unchanged. Controllers keep declaring auth as middleware; do not add checks in handlers. |
| `@deployer/shared/server` (`bootstrapApiServer`, `createOrpcModule`, `PreflightModule`, `ServiceHealthModule`) | | hosts no longer request-scoped; `DefaultInitialContext` carries the live request. |
| `config/env/env.module`, `config/drizzle/schema-codecs` | | unchanged. |
| `@deployer/shared/e2e-harness/shared-api-runtime`, `authenticated-session` | had a `REQUEST` override + `setSharedRuntimeAuthHeaders` / `setSharedRuntimeRequestOverride` | those helpers and `request-override.ts` are REMOVED; the context carries the live request, so a spec just sends headers. |

## 3. Controllers: `.effect()` and the request boundary

- `bff/src/domains/setup/controllers/setup.controller.ts` is the reference: `procedure(contract).use(publicAccess()).effect(function* ({ input }) { const initialization = yield* InitializationService; return yield* initialization.getSetupState(); })`.
  No `runPromiseUnwrapped` inside a handler, no controller wrapper (`serve`/`serveAnonymous`/`createServe` no longer exist anywhere).
- Anything that outlives the request (a `liveSnapshot` tick, a timer) must re-enter the boundary: `inBoundary(context, effect)` from `@deployer/nest-effect`.
- Error mapping is the boundary's job: fail with a `domainError`, never throw a Nest `HttpException` (the interceptors no longer translate it: `transformNestJSErrorToOrpc...` is now `transformDomainErrorToOrpcError`).
- Specs: a handler that `yield*`s a tag needs it in the spec context: `effectContext(Context.make(Tag, impl))` from `@deployer/nest-effect/testing`; see `setup.controller.spec.ts` (`registered` handlers + `lastHandler()`).

## 4. Checklist for the branch

1. Replace `AuthModule.forRootAsync(...)` with `AuthModule`; delete the unused imports.
2. Retype every injected shared service with its `...Shape`; replace `.method()` Promise calls with `yield*` (or `runPromiseUnwrapped` at a Promise edge).
3. Delete any `serve(...)` / `serveAnonymous(...)` wrapper; re-enter with `inBoundary` only for timer-driven work.
4. Remove `HttpException` throws in procedures; use a tagged domain error.
5. Drop the e2e `REQUEST` override helpers.
6. `bun x turbo run type-check --filter=@deployer/bff --filter=@deployer/setup --concurrency=1`, then the specs.
