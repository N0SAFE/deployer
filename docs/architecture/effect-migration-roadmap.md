# Effect migration roadmap

The target: every piece of platform logic is an Effect service in a framework-free package, and
NestJS only mounts those services (a module, a thin host class). No logic lives in a Nest class.

## End state: no `@Injectable`

Every service, repository, orchestrator and infra owner (`GlobalDatabaseService`, `EnvService`, the event
buses) ends up an Effect service; Nest keeps only modules, controllers and lifecycle hooks as the mounting
layer. A class left as `@Injectable` is migration work, not a design choice.

## Streaming stays RxJS

Logic and state are Effect; streaming and observability stay RxJS. A host exposes changes to Nest
callers as `Observable`s (SSE, subscriptions, `on(...)`), sourced from the Effect `Stream`/`PubSub`
inside the package. Do not rewrite an RxJS bus or SSE pipeline into Effect streams; the bus itself becomes an Effect service that
exposes the `Observable`.

## The pattern

1. **Package by feature**, not by framework: `packages/<feature>` exporting `Context.Service` tags,
   `make<Service>(deps)` factories, layers, typed `domainError`s and `Test`/fake layers. No Nest import.
2. **Typed failures**, never `throw`; Promise APIs enter through `fromAbortable` so interruption
   aborts the work.
3. **Nest provides the tag directly, in the module that owns it**, as `apps/api/services/health` does:
   `{ provide: Tag, useValue: Tag.live }`. The service is a constant whose collaborators are yielded when a
   method runs (`serviceOver`), so there is no root layer list, no exported `make<X>` and no `Live` layer
   for Nest. Real construction (a pool-bound handle, an event bus) is a `useFactory` provider; lifetime work
   (closing a handle, a timer, a fiber) lives in a small provider next to the tag. No `nest-effect/<feature>`
   host and no Promise face: those were a migration layer and are gone.
4. **Delete the old `nest-*` package** once its consumers are repointed; no compatibility shims.

## Endpoint requirements belong to the handler

A controller declares nothing: `procedure(contract).effect(body)` returns the `R` of everything the handler yields, and
`createModuleContext` reads it off the controller class. `[UnmetRequirementsOf]` is a union of `[controller, services]`
pairs, and `bootstrapApiServer` accepts only a root whose set is empty. Visibility is Nest's: own `providers` + the
**`exports`** of imports + global modules — a parent cannot resolve a child, and a sibling is invisible.

- `@deployer/nest-effect`: `procedure()`, `createGlobalModule()`, `declareModule()` (claims validated against Nest's
  metadata at import time), `assertRequirementsMet`, `RequirementsMet`.
- The request context is `EffectRuntime.contextFor(executionContext.getClass())`; `context()` stays for seeds, boot code
  and `runPromise`. `EFFECT_SCOPE_REPORT=1` lists, per controller, the services a module flip would take away.
- Legacy: `.use(Module[EffectContextOf])` still compiles and keeps the flat (pre-Nest-strict) view. It is deleted after
  the last service migrates; the strict audit is the only path then.
- Design, caveats and measurements: `docs/audit-2026-10-25/requirement-modules.md`.

## Done

| Package | Replaces |
|---|---|
| `@deployer/docker` (host, engine, provisioning, scanner pool) | `nest-docker` and the `DockerService` host. Each app's docker module provides `DockerHost`, `DockerEngine`, `ScannerPool`, `PostgresProvisioner`; callers inject the engine |
| `@deployer/supervision` | `nest-supervisor-core` |
| `@deployer/node-state` (repositories and `LocalDatabase` provided under their tags) | `nest-database-local`, `nest-nodes` |
| `@deployer/lifecycle` (`AppLifecycleModule.forRoot()` provides `AppLifecycle`) | `nest-lifecycle` |
| `@deployer/environment` (each app's `EnvModule` provides its `EnvService` token) | `nest-env` |
| `@deployer/database` | `nest-database-core` |
| `@deployer/platform-supervisors` (each supervisor is a `make…Registration` in `apps/api/shared/.../supervisors`; `SupervisorsModule` provides the `SupervisorOrchestrator` tag, the RxJS `SupervisorEventBus` stays the observability surface) | every `apps/api/shared` supervisor (app-wiring, redis, managed-web, global-db, database-service, edge-connector, local-db, traefik); the Promise `BaseSupervisorService`, `BaseDockerSupervisorService` and `BaseMultiSupervisorService` are deleted |
| `@deployer/system-metrics` (provided as the `SystemMetrics` tag) | `apps/api/shared` system-metrics module |
| `@deployer/rate-limit` | the duplicated `rate-limit` middleware (shared, unused) and fleet's copy |
| `@deployer/service-client` | `nest-service-client` (no Nest host: only the bff uses it, through its own module) |
| `@deployer/events` | `nest-events` (journal in Effect; streaming stays RxJS) |
| `@deployer/swarm` (`makeSwarmServices` builds every service; each tag is provided) | `nest-swarm` |
| `@deployer/effect-{core,infra,orpc,platform,reachability}` | the shared Effect layers |
| identity, project, fleet, runtime services | Effect layers behind `serve` |
| identity analytics | Effect layer (service, repository, `.effect()` handlers); every identity domain is now on the template |
| `SessionResolver` | session lookup is an Effect service; Better Auth still does the check inside the oRPC auth plugin |
| every API service wired by module (`useValue: X.live`) | `EffectRuntimeModule.forRoot({ layers })` and the `*.layers.ts` / `app.layers.ts` assemblies in health, identity, project, fleet and runtime; `layerOfClass` |
| runtime deployment queue (EFF-202) | durable `deployment_queue_jobs` + `DeploymentQueueRepository` (SKIP LOCKED, guarded leases); `makeJobRunner` runs one fiber per job with heartbeat, cancel-as-interrupt and a single terminal write; the build abort signal reaches the docker build |
| `@deployer/nest-effect` requirement layer (`procedure`, module facts, `createGlobalModule`, `declareModule`, `contextFor`, `scopeReport`) | the per-endpoint `.use(Module[EffectContextOf])` declaration and the app-wide request context |
| `svc-health` endpoint requirements | the last controller wiring line; health is the reference migration (`procedure()`, `exports`, `contextFor`, `assertRequirementsMet`) |
| `svc-node-agent` endpoint requirements | same wiring, 4 controllers, no database: `contextFor` proven on a second service |
| 23 `@Global()` modules | decorator-only globals, now annotated (`declareModule(..., { global: true })`), with `check:global-modules` in CI |
| `svc-identity`, `svc-project`, `svc-fleet`, `svc-runtime` endpoint requirements | `procedure()`, `contextFor`, `assertRequirementsMet`; each app's root-provided DB port moved into a global port module (root providers are invisible to child modules) |
| every `serviceOver` shape | declares its real `R` (collaborator + ports), so the audit walks repository → port → adapter → store instead of trusting `R = never` |

## Remaining, in dependency order

| Order | Package | Size | Consumers | Notes |
|---|---|---|---|---|
| 0 | RxJS event services in `apps/api/shared` (`core/modules/events/base`) | medium | events | stay RxJS by design (streaming/observability); fleet/runtime still `runPromiseUnwrapped` swarm and docker Effects at their edges |
| 1 | `apps/api/shared` modules | large | everything | traefik, mesh, platform-ingress, setup, supervisors' bodies (Promise inside the Effect framework today), global database |
| 2 | `apps/setup`, `apps/api/bff` wiring | | | after the shared modules |
| n/a | `nest-schema` | 5.9k | all | Drizzle table definitions and migrations are data, not Nest logic; it only needs renaming |

### Requirement-module rollout (endpoint requirements)

| Order | Target | Work | Notes |
|---|---|---|---|
| 1 | `node-agent` | **DONE** — 4 controllers, `contextFor`, explicit assert | 119 files type-clean, 143 tests |
| 2 | `identity` | **DONE** — 41 sites, global `DatabasePortModule` | 206 tests |
| 3 | `project` | **DONE** — 69 sites, `ProjectDomainModule` exports | 181 tests, 7.28M instantiations |
| 4 | `runtime`, `fleet` | **DONE** — 6 and 89 sites, roots converted, port modules | 527/530 and 287 tests |
| 5 | `bff` | **DONE (no-op)** — 0 `.effect()` controllers | 132 `.handler()` endpoints were never in scope |
| 6 | `@deployer/nest-effect` | **DONE** — legacy union deleted, `procedure()` is the only path | package 10/10 tests |

Check a package's dependents (`package.json` grep plus imports) before migrating it: absorb it only
when every consumer can move in the same change, otherwise keep a Promise face in the host.
