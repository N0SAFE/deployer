# Effect architecture audit — 2026-10-26

Scope: `samples/api-sample` (reference), `packages/nest/effect` (`@deployer/nest-effect`, the bridge), the two services already rewritten onto them (`svc-health`, `svc-identity`), and how all of it composes with the existing stack. Read-only audit: nothing was built, linted, tested or run. Statements about runtime behaviour are inferences from code unless marked "from log" (the `.turbo` logs of `packages/nest/effect`).

`svc-identity` is being edited while this audit runs: it was renamed mid-audit (`user.errors.ts` became `user.failures.ts`; `identity/src/e2e/module-workflows/module-happy-path-workflows.e2e-spec.ts:21` still imports the old name). Line numbers for identity files are a snapshot and will drift. Transient breakage is not counted as a finding.

Evidence convention: `path:line`. Paths are relative to `v3/` unless they start with `node_modules`.

---

## 1. Summary and verdict

**Verdict: a sound, pragmatic hybrid, not yet a template.** The operator's idea is right for this codebase: keep NestJS for construction, modules and lifecycle; use Effect only for handler logic, dependency resolution, typed errors and testability. The bridge is tiny (3 exports) and the health service shows it works end to end. But what exists today is a **proof of concept plus one finished service plus one half-finished one**. It is not yet a convention that the remaining services (fleet, project, runtime, BFF, mesh-agent) can be migrated onto uniformly, for six reasons:

1. **The sample and the package have already diverged** (§3.6). The sample does not use `@deployer/nest-effect`, is outside the workspace, and runs different dependency majors (Nest 12.2 and TypeScript 5.9 versus the repo's Nest 11.1 and TypeScript 7.0).
2. **Domain errors are not mapped centrally.** `@orpc/effect` offers an `effect/wrap` hook that nothing uses, so every controller hand-writes `catchTag` mappings. Identity already collapsed typed errors into one opaque `UserServiceFailure({cause: unknown})` and dispatches on `instanceof` at the boundary, which discards the main benefit of Effect error channels.
3. **There is no request-scoped context story.** The actor is an oRPC context field passed by hand as a parameter (`actorOf(context)`), not an Effect service. There is no correlation id, no per-request logger, no tracing integration.
4. **Service interfaces leak their dependencies.** Every method signature carries `R = Repository | DatabasePort`.
5. **There is no answer yet for transactions, cancellation of DB calls, streaming (Effect `Stream` versus RxJS), or logging/metrics.** The repo has at least 7 non-spec Drizzle `transaction()` sites in the `project` and `runtime` services (`apps/api-services/services/project/src/modules/service/repositories/service.repository.ts:183,502,623,659`; `.../project/repositories/project.repository.ts:241,297,335`; `.../runtime/src/modules/deployment/repositories/deployment.repository.ts:399,456,588,738`). These are the hardest repositories to migrate.
6. **It contradicts written conventions and is itself undocumented.** `apps/api-services/AGENTS.md` and `ARCHITECTURE.md` say one class per file, domain errors extend `AppError`, bundling breaks Nest DI, and controllers mock `implement`. No doc under `docs/`, no `AGENTS.md` and no package README mentions Effect (searched `docs`, `apps`, `packages`, `AGENTS.md`: only code and `package.json` hits).

**Recommendation:** continue, but treat the next increment as "Template v1": reconcile sample and package, add centralised error mapping and an Effect-native `CurrentActor`/request-context service, decide transactions and cancellation, write the conventions doc (§7), and only then migrate `project` (the first service that forces transactions). Do not start `runtime` or `fleet` before that.

---

## 2. What exists (inventory and status)

Status legend: REAL = implemented and covered by something that exercises it; PARTIAL = works but incomplete or unverified; STUB = placeholder; MISSING = needed, absent.

| Item | Status | Evidence / note |
|---|---|---|
| `samples/api-sample` app (Nest 12 + oRPC 2 beta + Effect 4 + Better Auth, 2315 lines) | REAL as a demo | `samples/api-sample/package.json:338-374`; `README.md:3-9`. Untracked, outside workspaces (§3.6), memory-only persistence (`README.md:321-322`) |
| Sample: Effect services + repositories via `Context.Service` tokens | REAL | `src/modules/planet/services/planet.service.ts:46-48`, `repositories/planet.repository.ts:22-24` |
| Sample: contract-first typed errors, compile-time alignment tests | REAL | `test/contract-errors.test.ts:13-48` |
| Sample: Better Auth (session middleware + `requireSession`) | REAL, authentication only | `src/auth/session.middleware.ts:20-28`; `src/orpc/require-session.ts:16-29`. No roles, no ownership checks |
| Sample: SSE via RxJS bridge (plugin, client wrapper, `observable()` schema) | REAL, custom, ~340 lines | `src/orpc/*.ts`, `src/contracts/observable.ts:28-64`. Overlaps `packages/transport/orpc/src/observable/*` (§4.4) |
| Sample: OpenTelemetry | PARTIAL | `src/telemetry.ts:14-22` only `ORPCInstrumentation` + `ConsoleSpanExporter`; no Effect tracer, no metrics |
| Sample: logging | STUB | `console.error` only (`src/app.module.ts:63`) |
| Sample: config | STUB | raw `process.env` (`src/main.ts:6`, `src/auth/auth.ts:17-19`, hard-coded default secret at `auth.ts:19`) |
| Sample: database | MISSING | in-memory `Map` repository (`planet.repository.ts:28-45`); no Drizzle, no transactions |
| Sample: authorization (roles, ownership) | MISSING | only `isLoggedIn` (`require-session.ts:19`) |
| Sample: lifecycle | PARTIAL | `onApplicationShutdown` disposes runtime (`src/effect/runtime.ts:46-48`); SIGINT/SIGTERM handled in `main.ts:14-18`; no `enableShutdownHooks`, no drain semantics |
| Sample: tests (5 files: service, controller, MSW, stream, type-level) | REAL | `test/*.ts`. No Nest integration test, no auth-flow test (the `demo.ts` script is the only e2e) |
| Sample: lint/format | PARTIAL | `eslint.config.mjs:1-23` recommended presets only; no type-aware rules, no Effect lint rules, no formatter |
| `@deployer/nest-effect` package | PARTIAL, small | 6 source files, 3 root exports (`src/index.ts:1-3`) plus `./testing` and `./orpc-context` subpaths (`package.json:18-27`) |
| Package: `EffectRuntime` (ManagedRuntime holder, `context()`, `runPromise()`, shutdown dispose) | REAL | `src/effect-runtime.ts:24-52` |
| Package: `collectEffectLayer` (discover Nest providers whose token is a `Context.Service` key) | REAL | `src/collect-effect-layer.ts:14-28` |
| Package: `EffectRuntimeModule` (global) | REAL | `src/effect-runtime.module.ts:11-17` |
| Package: `effectContext()` test helper | REAL, minimal | `src/testing.ts:13-15` |
| Package: `EffectServices` global interface augmentation | REAL, fragile | `src/orpc-context.ts:19-28` |
| Package: tests | PARTIAL | 2 tests, both happy path (`src/effect-runtime.spec.ts:12-42`); from log: 2/2 pass, type-check and lint clean (`packages/nest/effect/.turbo/*.log`). Not covered: duplicate tokens, request-scoped providers (skipped), shutdown, `orpc-context` typing |
| Package: README / docs | MISSING | no README in `packages/nest/effect/`; no mention in `docs/` |
| Package: central error mapping (`effect/wrap`) | MISSING | `@orpc/effect` exposes the hook (`node_modules/.bun/@orpc+effect@2.0.0-beta.46.../dist/shared/effect.C3k3V95E.mjs:21-24`); zero usages repo-wide |
| Package: request context (actor, correlation id, logger, tracer) | MISSING | see §5.3 |
| Package: transaction helper | MISSING | see §5.5 |
| `svc-health` rewrite | REAL | `apps/api-services/services/health/src/modules/health/*`; 3 spec files incl. a type-level error test (`controllers/health.contract.spec.ts:15-26`) |
| `svc-health` detail | one STUB | `supervisors: []` hard-coded (`controllers/health.controller.ts:77`); service name hard-coded `"svc-health"` (`:51,70`) |
| `svc-identity` `user` module | PARTIAL, mid-edit | controller 205 lines, service 227 lines, repository 189 lines; no `user` service/controller/repository specs on disk |
| `svc-identity` `permission`, `push`, `analytics` | classic Nest DI, not migrated | `modules/permission/services/permission.service.ts:20-37` (constructor injection) |
| Docs for the convention | MISSING | `docs/**` has no mention |

---

## 3. Architecture walkthrough

### 3.1 The one-sentence design

Nest builds objects; a tiny bridge copies every Nest provider whose **token is an Effect `Context.Service` class** into one Effect `Context`; oRPC's `.effect(function*(){...})` extension runs each handler as an Effect against that context.

### 3.2 Services and layers

- A "port" is a shape type plus a `Context.Service` class used as both the Effect key and the Nest token (`planet.service.ts:38-48`, `health.service.ts:16-29`). The implementation is an ordinary `@Injectable()` class registered as `{ provide: Key, useClass: Impl }` (`planet.module.ts:11-17`, `health/health.module.ts:23-30`).
- **There are no Effect `Layer`s authored by the app.** `collectEffectLayer` builds one `Layer.succeed(token, instance)` per discovered provider and merges them (`collect-effect-layer.ts:18-27`). Consequences: no `Layer.effect`/`Layer.scoped`, no acquire/release, no layer-level dependency graph. Dependencies are expressed in the **method's `R` parameter**, not at construction (`planet.service.ts:52` returns `Effect<…, PlanetRepository>`).
- `ManagedRuntime` is used only as a context holder. `@orpc/effect` runs every handler as its own root fiber via `Effect.runPromiseExitWith(context)` (`effect.C3k3V95E.mjs:5`), so handler fibers are **not children of the runtime** and `dispose()` neither interrupts nor awaits them (the runtime has no scope to close except `Layer.succeed`s, which have no finalizers). The "runtime" could be a plain `Context` built once; `runPromise()` (`effect-runtime.ts:39-41`) is the only thing that needs a runtime.
- Sample builds the runtime eagerly in `onApplicationBootstrap` (`src/effect/runtime.ts:28-30`); the package builds it **lazily on first `context()`** (`effect-runtime.ts:43-46`). Same name, different timing.

### 3.3 Errors

- Domain errors are `Data.TaggedError` (`planet-name-conflict.ts:4-6`, `health.errors.ts:4-7`). In the sample they stay in the Effect error channel and are mapped at the controller with `Effect.catchTag(...)` to `errors.CONFLICT(...)`, the constructors the contract declares (`planet.controller.ts:45-50`). Because `.effect()` types the failure channel against the contract, anything undeclared is a compile error (README `:286-292`, proven by `contract-errors.test.ts:15-26`).
- Anything that is not an `ORPCError` and escapes is rethrown raw: `Cause.squash(exit.cause)` (`effect.C3k3V95E.mjs:15`). In the sample `RethrowHandlerPlugin` is configured to rethrow non-`ORPCError` (`app.module.ts:56`), so unexpected failures surface as 500 plus a console line (`:61-65`). Interruption-only exits become the abort reason or an `AbortError` (`effect.C3k3V95E.mjs:9-14`).
- Health maps to a shared helper instead of contract constructors: `Effect.fail(standardErrorActions.FAILED_DEPENDENCY(error.message))` (`health.controller.ts:22-24`). Identity returns `ORPCError<string, unknown>` from `mapUserFailure` (`user.controller.ts:23-37`). Both are weaker than the sample's `errors.X` (the code type is widened, so the compile-time contract alignment is lost; to be confirmed by a type-level spec like `health.contract.spec.ts`, which only checks the client side).

### 3.4 Exposure (HTTP, oRPC, schemas)

- Only oRPC over the OpenAPI protocol via `@orpc/nest` `@Implement` (`planet.controller.ts:16-22`). `@Implement` requires `openapi.path`; the client is `OpenAPILink`, not `RPCLink` (README `:309-311`, repo does the same: `apps/api-services/shared/src/server/service-client.ts:12-24`). No raw Effect `HttpApi`/RPC is used.
- Schemas are **zod 4** everywhere (`planet.contract.ts:6-11`). `@orpc/effect` ships an `EffectSchemaToJsonSchemaConverter` (`index.mjs:70-106`) but nothing uses `effect/Schema`. Domain types are plain TypeScript.
- Composition of the Effect context type into oRPC: sample uses a typed union `AppServices` edited by hand (`runtime.ts:13`, `orpc/context.ts:19-34`); package uses a global `EffectServices` interface that each app augments (`orpc-context.ts:19-28`; health: `health/src/orpc/effect-context.ts:12-17`).

### 3.5 Auth, context, observability, lifecycle

- **Auth:** Better Auth mounted as Nest middleware; `SessionMiddleware` resolves the session once per request (`session.middleware.ts:20-28`); oRPC context maps it to a discriminated `AuthContext` (`auth-context.ts:19-25`); enforcement is an oRPC middleware, deliberately not an `APP_GUARD` (README `:201-205`). In the real services the same job is done by `AuthPlugin` + `requireAuth()` from shared (`apps/api-services/shared/src/server/orpc-host.ts:137`, `identity/.../user.controller.ts:15,61`).
- **Context:** the sample builds the oRPC context from `ExecutionContext` (`app.module.ts:41-50`). The shared host instead injects `REQUEST` into the ORPC config factory (`orpc-host.ts:69-72,144`). See §5.4.
- **Observability:** `ORPCInstrumentation` creates spans for procedures and middleware (`telemetry.ts:10-21`); the demo code uses `trace.getActiveSpan()` inside Effect code (`log-stream.service.ts:70`, `require-session.ts:24`). Nothing in the **repo** uses OpenTelemetry (no `opentelemetry` hit in `apps/` or `packages/` source or manifests), so there is no production precedent to align with.
- **Lifecycle:** Nest owns it. `EffectRuntime.onApplicationShutdown` disposes (`effect-runtime.ts:48-51`). Resources (DB pool, Docker client, mesh sockets) stay Nest providers; Effect cannot manage them (no scoped layers).

### 3.6 Packaging, toolchain, divergence

| Aspect | Sample | Repo (catalog / package) |
|---|---|---|
| Workspace membership | none; own `bun.lock`, own `node_modules` (`samples/api-sample/bun.lock`); root workspaces globs are `apps/**`, `packages/**`, `tooling/**`, `infra/**` (`package.json:4-12`) | n/a |
| Nest | `^12.2.0` (`package.json:339-341`) | `^11.1.27` (`package.json:182-184`); `nest-effect` resolves 11.2.7 |
| TypeScript | `^5.9.3` (`:371`) | `^7.0.2` (`package.json:16`) |
| Better Auth | `^1.7.13` (`:357`) | `1.7.7` pinned (`package.json:56`) |
| Effect / oRPC | `^4.0.6` / `2.0.0-beta.46` | same (`package.json:162,164-176`) |
| Lint | `eslint` recommended presets, no formatter | `bun lint` / `bun fmt`, shared config |
| Tests | vitest node env, no SWC (`vitest.config.ts:3-8`) | `createServiceTestConfig` with `unplugin-swc` (`tooling/vitest/src/service.ts:8,130`) |
| Reuses `@deployer/nest-effect` | no: re-implements runtime and layer collector in `src/effect/` | n/a |

The sample is therefore not CI-gated (`bun run check` is `turbo ... compile lint:check test type-check`, `package.json:124`, which only sees workspaces), and its type-level proofs were established on Nest 12 / TS 5.9, not on the repo's versions.

---

## 4. Fit with the existing stack

### 4.1 oRPC contracts (`packages/contracts/*`) and transport (`packages/transport/orpc`)
Fits cleanly: contracts are untouched; only the implementing controller changes (`implement(contract).use(requireAuth()).effect(...)`). The new path keeps `@Implement` and the shared host (`createOrpcModule`), adding `extraContext` to inject `effect/context` (`health/src/app.module.ts:79-86`). Open points: health's contract is built via `@deployer/health-contracts` (not read here for `standard.zod` compliance); the root `AGENTS.md` mandates `standard.zod`, unaffected by Effect.

### 4.2 Service client and BFF delegation
- `ServiceClient`/`ServiceClientRegistry` return Promise clients (`shared/src/server/service-client.ts:46-65`, `packages/nest/service-client/src/base-client.ts`). `createEffectClient` from `@orpc/effect` wraps any oRPC client into Effect-returning calls and ties abort signals (`index.mjs:38-68`), demonstrated in `samples/api-sample/src/modules/demo/demo.controller.ts:28-45`. Adopting it in services that call peers is straightforward, with one gap: that demo hand-forwards the cookie (`demo.controller.ts:34`), while the BFF uses **AsyncLocalStorage** to carry credentials to fan-out legs (`apps/api-services/bff/src/clients/service-auth-context.ts:38-60`). ALS across Effect fibers is probably fine in Bun/Node (promise-based), but is unverified; an Effect-native `CurrentActor`/`ForwardedCredentials` service would be safer.
- BFF delegation controllers are **generated** one-line passthroughs (`bff/src/modules/delegation/generated/user.delegation.ts:~50-57`, `gen-bff-delegation.py`), so Effect adds nothing there. The BFF benefits only in orchestrators/screens (`Effect.all` with concurrency, timeouts, partial failures).
- `apps/api-services/ARCHITECTURE.md` says the BFF "forwards an explicit actor claim", while the code forwards cookie/authorization (`service-auth-context.ts:29-36`). Not an Effect issue, but the Effect `CurrentActor` design must pick one.

### 4.3 Better Auth
Same plugin everywhere (`orpc-host.ts:137`). Services need `AuthModule.forRootAsync` just to satisfy the shared host (`health/src/app.module.ts:55-70`). The sample's request-middleware pattern and the real `AuthPlugin` differ; either way the actor lives in oRPC context, not Effect.

### 4.4 Drizzle/Postgres, events, supervisors, lifecycle
- Database: Effect repositories wrap the existing Nest database service as a port: `{ provide: DatabasePort, useExisting: GlobalDatabaseService }` (`identity/.../user.module.ts`) and `const { db } = yield* DatabasePort` per call, which preserves the re-initialisable `db` getter (`packages/nest/database-core/src/base-database.service.ts:41-47`). Queries are wrapped by `Effect.tryPromise` (`user.repository.ts:184-189`) **without using the provided `AbortSignal`**, so fiber interruption does not cancel the query.
- Streaming: services use RxJS everywhere (`fleet/.../cluster-swarm-events.service.ts`, `runtime/.../deployment-stream-bridge.service.ts`, `packages/nest/events`), and `packages/transport/orpc/src/observable/*` already provides an Observable-over-SSE transport (`contract.ts:1-50`, `event-iterator.ts`). The sample's `RxJSHandlerPlugin` + client wrapper (`src/orpc/*`) are a second, parallel implementation. They must be reconciled, not copied.
- `supervisor-core`, `lifecycle`, `events`, `docker`, `swarm`: all Nest class-based with constructor DI. They are not Effect-aware and need not be: they enter Effect as ports (`useExisting`). `AppLifecycleService` is a state observer driven by Rx (`packages/nest/lifecycle/src/app-lifecycle.service.ts:1-60`). Nothing maps its phases into Effect.
- The static DI-graph gate (`scripts/check-di-graph.ts`) analyses `@Module` imports only; Effect dependencies expressed through `yield*` are invisible to it, so Effect-level cycles or missing providers are not statically checked anywhere (§5.1).

### 4.5 Mesh agent
`apps/mesh-agent` is plain Bun, no Nest (`package.json:6-24`; 1501 lines in 12 files; timers and signal handlers in `main.ts:101-106`, `endpoint-discovery.ts:62`). `@deployer/nest-effect` is irrelevant there. It needs an **Effect-native** template (real `Layer`s, `Scope`, `Schedule`), which does not exist yet. It compiles to a single binary (`bun build --compile`), so Effect's footprint matters more there.

### 4.6 Workspace, turbo, knip
`@deployer/nest-effect` is picked up by `packages/**` workspaces and by knip's `packages/**` entry (`knip.config.ts`), built by `pkg-build` (`pkg-build.config.ts:4`), `type-check` is the repo's `bun check --no-script` (log: "No type errors in 6 files"). `effect` is a **dependency** of the package rather than a peer (`package.json:43-48`), so a version skew between the package's `effect` and an app's `effect` would produce two `Context.Service` identities and silent "service not found" failures. `@nestjs/core` is both dependency and peer (`:44` and `:50-51`). New health/identity build scripts use `bun build ... --packages=external` (`health/package.json:18`), contradicting `apps/api-services/ARCHITECTURE.md` ("Bundling breaks Nest DI... Never `bun build` an app").

### 4.7 Convention conflicts (AGENTS.md / ARCHITECTURE.md)

| Existing rule | Source | New code |
|---|---|---|
| One class per file; no multiple exported classes in one file | `apps/api-services/AGENTS.md` ("One class per file") | Key and impl in one file: `health.service.ts:11,27,36` (3 classes); `user.repository.ts:22,44,50`; sample README `:72-76` makes it the convention |
| Domain errors extend `AppError` | `apps/api-services/AGENTS.md` per-domain tree; `ARCHITECTURE.md` | `Data.TaggedError`, plus `@deployer/errors` classes still used as `cause` (`user.rules.ts`, `user.errors.ts`/`domain/user.errors.ts`) |
| Service never touches Drizzle; repositories no business rules | `ARCHITECTURE.md` | respected (`user.repository.ts`), but the service yields `DatabasePort` in its `R` signature (`user.service.ts:218-230`) |
| Controller specs mock `implement`/`Implement` from `@orpc/nest` | root `AGENTS.md` §7 | health spec instantiates the controller and calls `callProcedure` (`health.controller.spec.ts:21-42`) |
| Service specs: mock repository with `vi.fn()` literals | root `AGENTS.md` §7 | `Effect.provideService(...)` with fakes (`health.service.spec.ts:20-26`); arguably better but a different pattern |
| Constructor injection in services/controllers | repo-wide, `AGENTS.md` | controllers have no constructor; services have none (`planet.controller.ts:14-15`) |
| `standard.zod` builder for contracts | root `AGENTS.md` §1 | independent of Effect |
| Bundling breaks Nest DI | `ARCHITECTURE.md` | effect-style classes need no `design:paramtypes`, but shared infra classes still do; unverified under `bun build` |
| Service-adapter-repository | root `AGENTS.md` §2 | kept (port = repository, impl = adapter); `adapters/` folder dropped by the sample (`README.md:78-80`) |

---

## 5. Risks and gaps

### 5.1 Silent wiring failures
`collectEffectLayer` skips providers with `instance === undefined` (request-scoped, transient, or not yet resolved) and silently ignores duplicate tokens (`collect-effect-layer.ts:19-22`); first one wins, in module discovery order. The returned layer is typed `Layer<unknown>` (`:14`) and `context()` `Context<unknown>` (`effect-runtime.ts:31`); the app re-asserts the type with a cast (`samples/.../effect-layer.ts:30-32`) or via a global interface (`orpc-context.ts:19-28`). A forgotten `{ provide: Key, useClass: Impl }` therefore compiles and fails at request time as a defect. The sample's "one line in `AppServices`" step and the package's global augmentation are both unchecked against the real providers. A boot-time verification (compare declared `EffectServices` keys against discovered tokens, fail fast) is missing.

### 5.2 Dependency leakage and weak Effect style
Service interfaces mention their implementation's dependencies: `UserServiceShape.list` returns `Effect<UserPage, UserServiceFailure, UserRepository | DatabasePort>` (`user.service.ts:217-230`); `PlanetServiceShape` the same (`planet.service.ts:38-44`). Idiomatic Effect resolves dependencies when the layer is built so methods have `R = never`. Here every consumer and test must also provide the transitive requirements, and swapping an implementation changes the public type. The root cause is the design choice that services are zero-arg Nest classes instead of `Layer.effect`s. Also: `Effect.gen` used per method for tiny logic, `mapErrors`/`rule` shims (`user.service.ts:413-429`), and `try/catch`-style rule functions that throw (`userRules.assert*`) lifted by `Effect.try`, which turns every business error into an untyped `cause`.

### 5.3 Error model is not uniform and not centralised
- Identity: single opaque failure + `instanceof` ladder (`user.controller.ts:22-37`, `user.service.ts:218-226`, `user.failures.ts`). A new error type compiles and falls into `INTERNAL_SERVER_ERROR` (`user.controller.ts:33-36`).
- Health: one tagged error mapped via a helper (`health.controller.ts:22-24`).
- Sample: per-error `catchTag` (`planet.controller.ts:47-49`).
Three different styles in three places. No shared mapper `TaggedError -> ORPCError` (e.g. a `toOrpcError` table keyed by `_tag`, applied once through `effect/wrap`), and no HTTP/oRPC code policy for defects (500 + correlation id). `standardErrorActions` exists in `packages/transport/orpc/src/standard-errors.ts` and would be the natural target.

### 5.4 Request-scoped context (actor, correlation id, tenant)
- The actor is derived from oRPC context in every handler: `actorOf(context)` (`user.controller.ts:44-47`) and threaded as the first argument of each service method. This works but is repetitive, easy to forget, and not enforced by types (a service that omits `actor` still compiles).
- No correlation id exists on either path. `@deployer/logger` / Nest `Logger` are used in shared code (`orpc-host.ts:90`); Effect's logger is unused. `Effect.annotateLogs`/`FiberRef`-style per-request data have no home. `effect/wrap` (`effect.C3k3V95E.mjs:21-24`) is the right hook and is unused.
- **Probable request-scope bubbling:** the shared host injects `REQUEST` into the ORPC config factory (`orpc-host.ts:69-72,144`). In Nest, a provider depending on `REQUEST` is request-scoped and scope propagates to dependents; `ImplementInterceptor` injects that config (`@orpc/nest` `index.mjs:258-260`). If this makes controllers request-scoped, then every request constructs controller instances and re-runs the factory (including `new InternalErrorInsightService()` at `orpc-host.ts:75`). This predates Effect, but it undermines "built once, cached context" claims in the sample README (`:135-139`). The sample avoids it by passing a context function (`app.module.ts:41`). Inference, needs a boot-time check (`Test.createTestingModule` plus scope inspection).

### 5.5 Transactions
No design. Existing repositories use callback `db.transaction(async (tx) => ...)` (sites listed in §1, item 5). Options: an Effect `Transaction` service that scopes `tx` into the fiber context (then repositories use `yield* Db` which resolves to `tx` inside `withTransaction`); or keep transactions inside repositories (a repository method equals one unit of work). Cross-repository transactions need the former. Identity's `update` does `findById -> emailExists -> update` as separate unprotected calls (`user.service.ts:331-363`), so a race on uniqueness is possible regardless of Effect, but the template should make the right thing easy. Also, `BaseDatabaseService.db` throws `AppError` synchronously when uninitialised (`base-database.service.ts:41-47`); inside `Effect.gen` that becomes a defect, not a typed failure.

### 5.6 Cancellation and interruption
Good on the oRPC edge: the handler receives `opts.signal` and interrupts fibers on abort (`effect.C3k3V95E.mjs:25`; client side `anyAbortSignal` at `index.mjs:41-45`). Bad at the leaves: `Effect.tryPromise({ try: operation })` ignores the `signal` argument (`user.repository.ts:184-189`; `health.service.ts:41-49`), so cancellation does not reach Drizzle, `registry.runOnce()`, or Docker/Swarm calls; the fiber is interrupted but the work continues. Long runtime/fleet operations (deployments, Docker streams) will need explicit cancellation semantics and `Effect.acquireRelease` for child processes and streams, which the layer-less design cannot express at the service level.

### 5.7 Streaming and SSE
Contracts use RxJS `Observable`; the sample proves a bridge (plugin + client wrapper + `observable()` schema, `src/orpc/*.ts`, `contracts/observable.ts`), but it duplicates `packages/transport/orpc/src/observable/*` and keeps streaming outside Effect (`log-stream.service.ts:63-80` wraps `interval(...)` in `Effect.sync`). The Effect `Stream` type is not used; interruption of an SSE consumer reaches RxJS (`iterator.return()`), not fibers. Decide: RxJS stays the streaming lingua franca (consistent with `packages/nest/events`) and Effect only wraps construction, or `Stream` is adopted. Do not do both silently.

### 5.8 zod and Schema duality
Practical outcome today: zod everywhere at the boundary, Effect only for control flow, so duality is currently invisible. Risks: someone introduces `Schema.TaggedError` or `Schema.Class` in a domain and a second validator appears; `@orpc/effect` supports converting Effect Schemas (`index.mjs:70-106`), which makes the drift easy. Ruling needed (§8).

### 5.9 Logging, tracing, metrics
No Effect `Logger`/`Tracer` layers, no `Effect.fn`/`withSpan` convention, no `@effect/opentelemetry`, no metrics, no sampling; sample logs with `console`. `trace.getActiveSpan()` inside fibers works only while OTel's async context survives the fiber scheduler (likely for synchronous bits; uncertain across `Effect.sleep`/forks). A service-wide trace id would also tie into mesh/BFF fan-out (`service-auth-context.ts`).

### 5.10 Beta and version risk
oRPC is pinned to **2.0.0-beta.46** across 12 packages (`package.json:164-176`); `@orpc/effect` is part of that beta, and `Context.Service`/`Context.isKey` are Effect 4 APIs. Any oRPC beta bump can break `.effect()` typing. The sample's Nest 12/TS 5.9 lock is not the repo's. Effect 4 usage is novel enough that most examples online target Effect 3 (`Context.Tag`, `Effect.Service`); the team's learning curve is real.

### 5.11 Bun, boot time and bundle
Both services run under Bun (`health/package.json:14-15`); Effect has no Node-only requirement, but nothing here was executed in this audit, so "works on Bun" is a claim from the sample README (`demo`, `README.md:11-12`) until verified. Effect adds a sizeable dependency and a `ManagedRuntime` build at first request (lazy in the package). For the mesh-agent's compiled binary and for cold-start of ~7 service processes it should be measured, not assumed.

### 5.12 Testing
Strengths: services testable without Nest via `Effect.provideService`/`Layer.succeed` (`planet.service.test.ts:19-30`, `health.service.spec.ts:20-26`); type-level error tests; MSW over the real handler (`msw.test.ts`). Gaps: (a) `callProcedure` (`packages/transport/orpc/src/testing/index.ts:29-35`) calls `~orpc.handler` directly and **skips validation and middleware**, so `requireAuth()` is never exercised by health's controller spec; the sample's `call()` from `@orpc/server` does run middleware (`planet.controller.test.ts:43-54`); (b) no `@effect/vitest` (`it.effect`, `TestClock`, `TestContext`), so time-based behaviour (retries, timeouts) is untestable deterministically; (c) fakes are ad-hoc object literals per test; no shared `TestLayer` per port; (d) no Nest integration test that proves discovery wiring (the package's two tests do, but only for a toy service); (e) identity's `user` module has no unit specs yet on disk.

### 5.13 Operational/organisational
Mixed styles inside one service (identity: `user` Effect-based, `permission/push/analytics` classic) force two testing approaches and two mental models in one app. `UserDomainModule` exports `UserService` (`user.module.ts`), but consumers outside Effect that `@Inject(UserService)` get the impl typed as an Effect tag class, which is confusing; the template must say how non-Effect Nest code consumes Effect services (expose a plain facade, or `runtime.runPromise`).

---

## 6. Strengths

1. **Small blast radius.** Contracts, modules, shared host, BFF, DB packages unchanged; the bridge is ~100 lines (`src/*.ts`).
2. **Compile-time contract alignment** (sample): handler failures must be declared contract errors (`contract-errors.test.ts:15-26`); undeclared codes are TS errors.
3. **Controllers have no constructor and no `@Inject`**; one resolution mechanism for handlers (`planet.controller.ts:14-15`).
4. **Testability without Nest or a DB** for services, and without Nest for controllers via `call()` (`planet.controller.test.ts:29-54`).
5. **Convention-over-configuration wiring**: `{ provide: Key, useClass: Impl }` is the whole registration; `Context.isKey` is a precise discriminator (`collect-effect-layer.ts:20`).
6. **Abort propagation from the HTTP edge into fibers** is handled by `@orpc/effect` (`effect.C3k3V95E.mjs:25`).
7. **Good documentation inside the sample**: README explains who owns what, trade-offs (app-wide context, `README.md:141-144`) and the escape hatch (`:182-183`).
8. **Health is a real vertical slice** (domain error, service, controller, fixtures, three specs), a usable seed for the template.
9. **Pure-rule extraction** (`selectPlanets`, `containsName`, `userRules`) keeps logic testable outside Effect (`planet.service.ts:18-29`, `identity/.../domain/user.rules.ts`).
10. **Effect client for service-to-service calls** removes try/catch around typed oRPC errors (`demo.controller.ts:39-45`).

### Anti-patterns observed (for the checklist)
- Service interfaces that name implementation dependencies in `R` (§5.2).
- Collapsing all domain errors into one `cause: unknown` wrapper (§5.3).
- `Effect.tryPromise` that ignores `AbortSignal` (§5.6).
- Throwing rule helpers lifted with `Effect.try` instead of typed failures.
- Hand-maintained `AppServices`/`EffectServices` unions with no boot-time check (§5.1).
- Hard-coded values inside controllers (`"svc-health"`, `supervisors: []`, `health.controller.ts:51,70,77`).
- Reimplementing the runtime in the sample instead of consuming the package (§3.6).

---

## 7. Recommended conventions and template checklist

### 7.1 Conventions doc outline (`docs/architecture/13-effect-services.md`, plus a pointer from `apps/api-services/AGENTS.md`)

1. Purpose and non-goals (Effect for logic, Nest for construction/lifecycle; no `Layer`/`HttpApi`/`Schema` unless decided).
2. Versions and pinning policy (Effect 4.x, oRPC 2.0.0-beta.N exact; Nest/TS aligned with the catalog; sample must use the catalog).
3. Anatomy of a domain: files, naming, one-class-per-file rule update (exception: key class and implementation may live together only if the rule in `AGENTS.md` is amended; otherwise `*.tag.ts` plus `*.impl.ts`).
4. Ports and keys: shape type, `Context.Service` id string format (`<service>/<Name>`), registration `{ provide: Key, useClass|useExisting }`, boot-time discovery verification, `EffectServices` registration per app.
5. Requirements policy: `R = never` on public service methods; dependencies resolved at construction through the layer (decide: constructor-injected Effect services or `Layer.effect`) (§8 D1).
6. Errors: tagged error catalogue per domain, `cause` rules, one shared `toOrpcError` mapping table, defects policy, `effect/wrap` installation, logging of defects with correlation id.
7. Request context: `CurrentActor`, `CorrelationId`, `Logger` as Effect services, populated in `effect/wrap` from oRPC `context.auth`; ban passing raw `context` into services.
8. Authorization: where checks live (service, via `CurrentActor`), policy functions, how ownership is enforced, what a controller may/may not do.
9. Persistence: `Db` port (including `tx` handling), repository method granularity, `withTransaction`, mapping driver errors to typed repository errors, using the `signal` for cancellation.
10. Streaming: RxJS vs `Stream` ruling; one SSE bridge (reconcile with `packages/transport/orpc/src/observable`).
11. Cross-service calls: `createEffectClient` over `ServiceClientRegistry`, credential/actor forwarding (replace ALS).
12. Config: `EnvService` zod values exposed as an Effect service; no raw `process.env`.
13. Observability: logger, tracer, metrics, span naming (`Effect.fn`), correlation id format.
14. Lifecycle and shutdown: who disposes what, drain semantics, readiness gating (`PreflightModule`).
15. Testing: pyramid, `@effect/vitest`, shared `TestLayer` per port, `call()` (middleware-inclusive) versus `callProcedure`, type-level contract specs, e2e harness binding, Nest wiring spec.
16. Tooling: lint rules for Effect (floating Effects, forbid `Effect.runPromise` outside boundaries), bundling policy, knip entries.
17. Mixed-mode rules: how non-Effect Nest code calls Effect services (facade) and vice versa (ports).
18. Migration playbook and checklist (below), with a worked example (health) and anti-patterns.

### 7.2 "Effect service template" checklist (what each migrated service must contain)

**Package/bridge (do once, in `@deployer/nest-effect`)**
- [ ] README with the contract of the bridge; `EffectRuntime` timing unified (eager at `onApplicationBootstrap`, as in the sample) and covered by tests for duplicates, skipped scoped providers and shutdown.
- [ ] Boot-time check: every key declared in `EffectServices` has a provider; every Effect key provider is reachable; fail fast with the missing key id.
- [ ] `effect/wrap` installer: correlation id, `CurrentActor` from `context.auth`, error mapping `_tag -> ORPCError`, defect logging.
- [ ] `Db`/`Transaction` primitive and a `fromAbortableSignal` helper for `tryPromise`.
- [ ] `effect` as a peer dependency (single copy), `@orpc/effect` pinned exactly.
- [ ] Testing kit: `effectContext`, `TestLayer` builders, `callWithMiddleware`.
- [ ] Sample either consumes the package or is deleted after being folded into docs. Align versions with the catalog.

**Per service**
- [ ] `main.ts`: imports `@orpc/effect/extensions/effect`, context augmentation, `bootstrapApiServer` (as `health/src/main.ts:1-52`).
- [ ] `app.module.ts`: imports-only root with `EffectRuntimeModule` and `createOrpcModule({ extraContext })` (or the new context-function form that avoids `REQUEST` scope).
- [ ] `src/orpc/effect-context.ts` registering the app's keys.
- [ ] Per domain: contract (existing), `errors` (tagged), port(s), implementation(s), controller, module, fixtures, specs.
- [ ] Each handler: `requireAuth()` (or documented public), actor from `CurrentActor` not from raw context.
- [ ] No `any`, no `as` casts on the Effect boundary; type-level spec that handler failures equal contract errors (generalise `health.contract.spec.ts`).
- [ ] Specs: service (Effect providers), controller (`call()` with middleware), repository (against test DB or the e2e harness), wiring (Nest testing module resolves all keys).
- [ ] e2e binding via `src/e2e/runtime.ts` unchanged.
- [ ] `bun lint`, `bun check --no-script` clean; docs updated in the same change.
- [ ] Delete old files in the same change (no shims), per `v3/AGENTS.md` safety rule.

---

## 8. Migration cost per remaining service

Sizes from non-spec source lines/files in `src/` (counted for this audit): identity 27 files / 4.3k; project 30 / 6.8k; fleet 65 / 9.6k; runtime 117 / 28.6k; BFF 77 / 7.6k; mesh-agent 12 / 1.5k; shared 367 / 62.6k (not migrated, consumed as ports).

| Service | Size | Reasoning | Prerequisites |
|---|---|---|---|
| **health** | done | Finish stubs (`supervisors: []`, hard-coded name), add `requireAuth`-aware spec if endpoints become non-public | none |
| **identity** | **M** | `user` done structurally but needs specs and its error model reworked; `permission`, `push` (web-push), `analytics` (systeminformation) remain classic Nest. Repo + service per module are mechanical; permission engine is pure TS wrapped as port | error mapping + `CurrentActor` |
| **project** | **L** | 4 modules (project, service, domain, network); 7 transaction sites in repositories (`service.repository.ts`, `project.repository.ts`); cascade/dependency logic; cross-service calls to fleet via client | transaction primitive, cancellation helper, ruling on service-to-service client |
| **fleet** | **L/XL** | 65 files/9.6k; Docker/Swarm adapters, reachability, Rx event services (`cluster-swarm-events.service.ts`), streaming `reachability.controller.ts`; many external resources needing `acquireRelease` semantics | streaming ruling, resource policy (Nest provider vs scoped layer), cancellation |
| **runtime** | **XL** | 117 files/28.6k; deployment queue (`deployment-queue-lifecycle.service.ts`), 4 tx sites in `deployment.repository.ts`, Docker/mesh stream bridges, 32 specs to rewrite; heaviest concurrency/cancellation needs (builds, long streams) | all of the above; consider migrating only controllers/services and leaving queue/Docker engines as ports first |
| **BFF** | **S** (delegation) + **M** (orchestrators) | generated delegation controllers (18 files) are passthrough, leave Promise-based; only screens/orchestrators benefit from `Effect.all`/timeouts; must preserve credential forwarding | credential/actor forwarding design (replace ALS) |
| **mesh-agent** | **M** | 1.5k lines, no Nest; natural fit for real `Layer`/`Scope`/`Schedule` (agent loop, gossip, door converger), but needs a different, Effect-native template and a binary-size check (`bun build --compile`) | Effect-native template (not `nest-effect`) |

Rough order: finish identity -> template v1 (package work + docs) -> project -> BFF orchestrators -> fleet -> runtime; mesh-agent in parallel if capacity allows, since it does not depend on the Nest bridge.

---

## 9. Open decisions

- **D1 Services as Layers or as Nest instances?** Today: Nest-built classes, requirements in method `R`. Alternative: keep Nest construction but inject dependencies by constructor and expose methods with `R = never`; or move to `Layer.effect` owned by Effect (cleaner types, scoped resources, but loses Nest DI/module override testing).
- **D2 Centralised error mapping.** Adopt `effect/wrap` plus a `_tag -> ORPCError` table? What is the defect policy (500 body, logging, correlation id)?
- **D3 Actor/request context.** `CurrentActor` Effect service populated by `effect/wrap`, replacing `actorOf(context)` parameter passing? Does the BFF forward cookies (today) or an explicit actor claim (what `ARCHITECTURE.md` says)? Remove ALS?
- **D4 Transactions and cancellation.** Fiber-scoped `tx` service versus per-repository units of work; mandatory use of `AbortSignal` in `tryPromise`?
- **D5 Streaming.** RxJS stays (reconcile sample plugin with `packages/transport/orpc/src/observable`) or move to Effect `Stream`?
- **D6 zod versus Effect Schema.** Recommend: zod only at contracts and config; no Effect Schema in domains; confirm and lint it.
- **D7 Versions.** Sample on Nest 12/TS 5.9 versus repo on Nest 11/TS 7: which is the target, and when does the catalog move? Pin `@orpc/*` beta exactly, and who owns bumps?
- **D8 One class per file.** Amend `apps/api-services/AGENTS.md` to allow key+impl in one file (sample/health do), or split into `*.tag.ts`/`*.impl.ts`?
- **D9 Bundling.** Is `bun build --packages=external` (now in health/identity) accepted, superseding the "never `bun build` an app" rule? Verify Nest metadata under that build.
- **D10 Sample's fate.** Keep as non-CI showcase, fold into `docs/` and delete, or promote into the workspace and CI?
- **D11 Mixed-mode services.** Are partially migrated services (identity) acceptable on `main`, and what is the facade for non-Effect consumers of Effect services?
- **D12 Observability.** Adopt OTel (none in the repo today) with an Effect tracer, or defer and standardise on correlation-id logging first?
- **D13 mesh-agent.** Own Effect-native template, or leave non-Effect?
