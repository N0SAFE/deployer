# Effect target architecture for the service tier (full-Effect, Layer-native)

Status: proposal, 2026-10-26. Author: architecture pass, read-only (nothing built, linted, tested or run). Supersedes the "hybrid, `R = never` classes built by Nest" option (D1 option a) in `effect-architecture.md` section 9 and the hybrid recommendation of `DEC-EFF-17`. Everything else accepted by the operator in `roadmap/effect-migration.md` "Decisions needed" is taken as given and listed in section 12.

Evidence convention: `path:line` is the current state as read in this pass; "(per audit)" marks a line number taken from `effect-architecture.md` / `effect-health-identity.md` / `effect-ecosystem-research.md` and not re-read. Paths are relative to `v3/`.

**Verification limits, read first.** API names below follow `effect@4.0.6` as documented in `effect-ecosystem-research.md` (`Context.Service`, `Layer`, `Effect.fn`, `ManagedRuntime`, `Schedule`, `Config`, `Redacted`, `Scope`). Effect 4 renamed several v3 APIs (`Layer.scoped` folded into `Layer.effect`, `Context.Tag` to `Context.Service`); every code sketch here is a design sketch, and the first task of Template v1 is to compile each against `node_modules/effect/ai-docs`. Where a claim needs a spike I say so and give the exit criterion (section 11, spikes S1-S6). Nothing below has been run.

---

## 0. The decision in one page

1. **Services are Effect Layers. Effect owns the process.** A service's `main.ts` builds one `Layer` graph and launches it; the HTTP edge, the DB pool, workers, probes and consumers are all layers in that graph, started in dependency order and closed in reverse by the `Scope`. `R` is resolved by composition; a missing dependency is a compile error in `main.ts`, not a request-time defect.
2. **NestJS is a legacy island that shrinks to zero, not the host.** Phase 1 (migration, runs through the monolith cutover): a thin Nest shell hosts HTTP and lifecycle while the runtime is built from an explicit `AppLive` layer (not discovered from Nest providers). Phase 2 (per service, as soon as its Nest island is empty): the shell is replaced by an `HttpEdge` layer (an oRPC `OpenAPIHandler` on `Bun.serve`). Nest classes that cannot be rewritten soon (docker, swarm, mesh, supervisors; 143 `@Injectable` in `apps/api-services/shared/src`, 83 in runtime, 36 in fleet) are bridged **into** Effect through a `NestIsland` layer (Effect hosts Nest, not the reverse). Firm recommendation: option (b) as the end state, option (a) as the transition, never `effect/http` (section 3).
3. **oRPC stays the contract and transport.** Contracts stay `standard.zod`; handlers are `.effect()`; a single `api()` wrapper per service provides request context (`CurrentActor`, `Correlation`), maps tagged domain errors to the six standard oRPC codes by a table keyed on error **kind**, turns defects into `500 + correlationId`, and turns client abort into fiber interruption.
4. **Authority comes from a signed actor claim**, issued by the BFF after it resolves the Better Auth session once, verified by every service with a `KeyRing` (key ids). Services stop mounting `AuthModule`. This kills the AsyncLocalStorage credential relay (`apps/api-services/bff/src/clients/service-auth-context.ts:38-60`).
5. **Data access is a `Db<Owner>` layer** over Drizzle 0.45 with a dedicated-connection fiber-scoped transaction, mandatory abort (server-side `pg_cancel_backend`), typed `DbError`, and per-owner schema barrels.
6. **Testing is layer substitution**: `@effect/vitest` + `TestClock`, one `*Test` layer per port, a `ContractHarness` that runs the real middleware chain, and a Testcontainers-backed e2e harness whose per-test isolation is a rolled-back transaction.
7. **Packaging**: `@deployer/nest-effect` is split into `@deployer/effect-core`, `effect-orpc`, `effect-infra`, `effect-testing`, plus a temporary `effect-nest` bridge that is deleted when the last Nest island closes.
8. **Order**: Template v1 on health, then identity (and BFF claim issue), project, the runtime job worker as the first greenfield Effect module inside runtime (SUB-B), fleet, rest of runtime, BFF edge, mesh-agent in parallel on `effect-core` only. About 30 engineer-weeks total; the first usable template is week 4.

### Non-goals

- No `effect/http-api`, `effect/rpc`, or `effect/http` server. They are `@stability unstable` (`effect-ecosystem-research.md` 2.2) and would discard the contract/OpenAPI/TanStack hooks stack (`packages/transport/orpc/src/hooks`, 315 generated BFF forwarders).
- No Effect Schema in contracts or domain entities (zod at contract edges, accepted). Effect Schema only inside Effect-only payloads (job payloads, outbox event bodies, claims, config).
- No `effect/sql` / `@effect/sql-drizzle` / Drizzle native Effect driver (needs drizzle `1.0.0-rc`; repo is on 0.45, `effect-ecosystem-research.md` 2.4). Drizzle remains the schema and query owner.
- No `effect/workflow` or `effect/cluster` commitment. They stay behind the time-boxed spike S5 (section 11).
- No rewrite of `packages/nest/{docker,swarm,mesh,supervisor-core,...}` internals in this program; they are consumed as ports.
- No custom DI container, no decorator-based Effect wrappers.
- No web rewrite. The web keeps the generated oRPC hooks; the contracts do not change shape because of Effect.

---

## 1. Principles

| # | Principle | Concrete rule | Today (evidence) |
|---|---|---|---|
| P1 | Effect owns construction and lifecycle | A service is `Layer.launch(MainLive)`; no `NestFactory` in new code | Nest builds everything, bridge copies instances into `Layer.succeed` (`packages/nest/effect/src/collect-effect-layer.ts:14-28`) |
| P2 | Dependencies are resolved at layer build, never in method `R` | Public service/repository methods have `R` restricted to the **Ambient** set (`CurrentActor`, `Correlation`); a type test enforces it | `UserServiceShape.list` returns `Effect<..., UserRepository \| DatabasePort>` (`apps/api-services/services/identity/src/modules/user/services/user.service.ts:12-26`) |
| P3 | Every failure is typed and tagged; one failure, one tag | `DomainError` carries a `kind`; mapping to transport is one table | identity collapses to `UserServiceFailure({cause: unknown})` (`user.service.ts`), health uses a helper, sample uses `catchTag` |
| P4 | Request-scoped facts are services, not parameters | `CurrentActor`, `Correlation`, `RequestInfo`; services never see oRPC `context` | `actorOf(context)` first argument of every method (per audit, `user.controller.ts:44-47`) |
| P5 | Interruption reaches the leaf | `AbortSignal` is mandatory in every `tryPromise`; DB, child processes, HTTP calls are cancelable | `Effect.tryPromise({ try: operation })` ignores the signal (per audit, `user.repository.ts:184-189`; `health.service.ts` `registry.runOnce()`) |
| P6 | Resources are scoped | Pool, server, child process, subscriptions: `acquireRelease` inside a Layer or `Effect.scoped` | DB pool, Docker client, mesh sockets are Nest providers with `onModuleDestroy` |
| P7 | Pure rules stay pure | Domain rules are plain functions returning `Either`-like results or typed failures; no `throw` lifted by `Effect.try` | `rule(() => { userRules.assert...() })` (`user.service.ts`) |
| P8 | Time, randomness, ids are services | `Clock`, `Random`, `IdGen`; no `Date.now()` / `crypto.randomUUID()` in domain code | uptime bug `process.uptime() / 1000` untestable (`apps/api-services/services/health/src/modules/health/controllers/health.controller.ts:72`) |
| P9 | One way to do each thing | one error table, one actor mechanism, one Db, one stream bridge, one client factory | three error styles, ALS vs parameter vs cookie, two SSE bridges |
| P10 | Boundaries are plain TS | contracts (zod), Drizzle schema, oRPC types; Effect is an implementation detail behind the handler wrapper | n/a |
| P11 | Wiring is verified twice | compile time (Layer types) and boot time (eager build, fail fast listing all missing config) | silent `continue` on duplicates / unresolved (`collect-effect-layer.ts:19-22`); lazy build (`effect-runtime.ts:43-46`) |
| P12 | Nothing is hidden in globals | no `EffectServices` global augmentation, no module-level singletons, no AsyncLocalStorage | `orpc-context.ts:19-28` global interface |

---

## 2. The layer graph

### 2.1 Four strata and the dependency direction

```
            L3  APPLICATION   HttpEdge, routers (oRPC handlers), Readiness, Probes,
                              Workers, Consumers, Schedulers            (leaf layers, launched)
                                 |  uses
            L2  REQUEST       RequestInfo, CurrentActor, Correlation, CurrentTx
                 (ambient)       provided PER REQUEST as a Context fragment (not a built Layer)
                                 |  read by L1 and by L0 adapters that must propagate it
            L1  DOMAIN        Repository<X>, Service<X>, Policy<X>      (built once)
                                 |  uses
            L0  INFRASTRUCTURE Config, Logger/Tracer/Metrics, Clock/Random/IdGen, Db<Owner>,
                              Crypto/KeyRing, ServiceClients, CommandRunner, FileSystem,
                              EventBus/Outbox, JobQueue/Scheduler/Lease, Ports to Docker/Git/Wg/Traefik
```

Hard rules (enforced by ESLint `no-restricted-imports` boundaries plus the layer types):

- Imports and layer requirements point **downward only**: L3 -> L1 -> L0. L0 never imports a domain package.
- L2 is **ambient**: L1 may require `CurrentActor | Correlation` in method `R` (that is the compile-time authz hook, section 5.5); L0 may read them only in three places: `Logger` (annotation), `ServiceClients` (claim + correlation propagation), `Audit`.
- Features never `Layer.provide` L0 internally. They declare what they need (`Layer<UserService, never, Db | Clock>`) and the service root closes it. Exception: a feature-private repository, assembled with `Layer.provideMerge` so tests can still replace it (section 5.4).
- A domain feature never requires another feature's **repository**; it requires the other feature's **service** (or a `Port` for a sibling service).

### 2.2 Inventory of layers

All ids are `"<service>/<Feature>/<Name>"`, e.g. `"identity/User/UserService"`; shared infra ids are `"infra/<Name>"`.

| Stratum | Tag | Shape (essence) | Live layer | Test layer | Package |
|---|---|---|---|---|---|
| L0 | `AppConfig` | typed record built from `Config`; secrets are `Redacted<string>`; **fails at build listing every missing key** | `AppConfig.fromEnv(schema)` (wraps `EnvService` zod values) | `AppConfig.fromRecord` | effect-infra |
| L0 | `Logger` (Effect built-in) | JSON line to `@deployer/logger` with annotations `{service, correlationId, actorId, route}` | `LoggerLive` | `Logger.Test` collecting lines | effect-infra |
| L0 | `Tracer`, `Metrics` | `OtelTracer.layerGlobal` (traces only, accepted DEC-EFF-12 "logs first, traces next"); `Metric` registry | `ObservabilityLive` (no-op until OTel enabled) | none (no-op) | effect-infra |
| L0 | `Clock`, `Random` | built-in | built-in | `TestClock`, seeded `Random` | effect |
| L0 | `IdGen` | `next(): Effect<string>` (uuidv7); `correlation()` | `IdGenLive` | `IdGen.Sequential` | effect-core |
| L0 | `Db<Owner>` | `use(fn(db, signal))`, `transaction(effect)`; typed `DbError` | `PgDbLive(owner)` (pool via `acquireRelease`) | `PgTestDb` (Testcontainers + rolled-back tx), `Db.InMemory` for rule-only tests | effect-infra |
| L0 | `LocalDb` | same shape over `bun:sqlite` (runtime's `local_*` tables) | `SqliteDbLive` | in-memory sqlite | effect-infra |
| L0 | `Crypto` / `KeyRing` | `sign(claim, kid)`, `verify(token)`, `seal(plaintext)/open(box)` carrying `kid`; keys are `Redacted` | `KeyRingLive` (from config / keyring table) | `KeyRing.Fixed` | effect-infra |
| L0 | `ServiceClients` | `client(service, contract)`: Effect-returning oRPC client; attaches claim + `x-correlation-id`; applies `ResiliencePolicy` | `ServiceClientsLive` over `ServiceClientRegistry` (`packages/nest/service-client/src/service-client.registry.ts`) | `ServiceClients.Fake(handlers)` serving another service's router **in process** | effect-orpc |
| L0 | `CommandRunner` | `run(cmd, {signal, onLine})`, scoped child, SIGTERM -> grace -> SIGKILL on interrupt | `BunCommandRunnerLive` | `CommandRunner.Script([...])` | effect-infra |
| L0 | `FileSystem` | thin Bun file ops with typed errors | `BunFsLive` | in-memory map | effect-infra |
| L0 | `EventBus` | in-process `PubSub` fan-out (never cross-process) | `EventBusLive` | same | effect-infra |
| L0 | `Outbox` | `emit(event)` **inside the caller's `Db.transaction`** | `OutboxLive` | `Outbox.Recording` | effect-infra |
| L0 | `JobQueue` | `enqueue`, `cancel`, `claim`; Postgres lease + heartbeat | `PgJobQueueLive` | `JobQueue.InMemory` driven by `TestClock` | effect-infra |
| L0 | `Scheduler`, `Lease` | `every(name, Schedule, effect)`, leader lease on Postgres advisory lock | `SchedulerLive` | TestClock | effect-infra |
| L0 | Ports to external systems | `Docker`, `Swarm`, `Git`, `Traefik`, `Wireguard` (each a Tag with typed errors) | `DockerLive` (Nest island adapter at first, native later) | in-memory fakes | per service, shared where common |
| L1 | `<X>Repository` | Drizzle only; typed `DbError` mapped to `<X>RepositoryError` kinds | `XRepository.Live` requires `Db<Owner>` | `XRepository.Test` (Ref-backed) | service |
| L1 | `<X>Service` | use cases; policy + repository + events; `R` = Ambient | `XService.Live` | `XService.Test` (rare; usually fake the repo) | service |
| L1 | `<X>Policy` | pure `can*` functions + `Effect` wrappers failing `Forbidden` | `XPolicy.Live` | same | service |
| L2 | `RequestInfo` | `{ requestId, method, route, startedAt, remoteAddr }` | provided by `api()` | `RequestInfo.Test` | effect-orpc |
| L2 | `CurrentActor` | `Actor = { kind: "user"|"system"|"service"|"anonymous", id, role, platformRole, claimId, sessionId? }` | provided by `api()` from verified claim | `Actor.admin`, `Actor.user(id)`, `Actor.system(name)` | effect-core |
| L2 | `Correlation` | `{ id, parentId? }`, from `x-correlation-id` or `IdGen` | provided by `api()` | `Correlation.Fixed` | effect-core |
| L2 | `CurrentTx` | `Context.Reference<TxHandle \| undefined>`; set by `Db.transaction` | internal to `Db` | n/a | effect-infra |
| L3 | `HttpEdge` | `Bun.serve` + `OpenAPIHandler`; liveness first; drains on close | `HttpEdgeLive(router, opts)` | `HttpEdge.Ephemeral` (port 0) | effect-orpc |
| L3 | `Readiness`, `Probes` | readiness state machine; probe registry (`Probe` tags contribute checks) | `ReadinessLive` | `Readiness.Test` | effect-infra |
| L3 | `Worker<J>`, `Consumer<E>` | job worker with `FiberMap`; outbox consumer with cursor | `Worker.layer(...)`, `OutboxConsumer.layer(...)` | TestClock + InMemory queue | effect-infra |

### 2.3 Conventions for tags, layers and composition

**One Tag, one Live, one Test; the Tag is the contract.**

```ts
// identity/src/user/application/user.service.ts
import { Context, Effect, Layer } from "effect";
import { CurrentActor, type Ambient } from "@deployer/effect-core";

/** Public shape. Every method: R extends Ambient, E is a closed union of tagged errors. */
export type UserServiceShape = {
  readonly list: (q: UserQuery) => Effect.Effect<UserPage, UserForbidden, Ambient>;
  readonly findById: (id: UserId) => Effect.Effect<User | null, UserForbidden, Ambient>;
  readonly delete: (id: UserId) => Effect.Effect<void, UserNotFound | UserForbidden | UserConflict, Ambient>;
};

export class UserService extends Context.Service<UserService, UserServiceShape>()(
  "identity/User/UserService",
) {
  /** Live leaves its dependencies OPEN, so a test can swap any of them. */
  static readonly Live: Layer.Layer<UserService, never, UserRepository | UserPolicy | Outbox | Clock> =
    Layer.effect(
      UserService,
      Effect.gen(function* () {
        const users = yield* UserRepository;     // resolved HERE, at layer build
        const policy = yield* UserPolicy;
        const outbox = yield* Outbox;

        const delete_ = Effect.fn("UserService.delete")(function* (id: UserId) {
          const actor = yield* CurrentActor;     // ambient: allowed in R
          const target = yield* users.findById(id);
          if (target === null) return yield* new UserNotFound({ id });
          yield* policy.canDelete(actor, target); // fails UserForbidden
          yield* users.delete(id);
          yield* outbox.emit(UserDeleted.make({ id, by: actor.id }));
        });

        return UserService.of({ list: /* ... */, findById: /* ... */, delete: delete_ });
      }),
    );
}
```

Rules:

- **Tag and `Live` live together** in `<name>.ts` (amends one-class-per-file for tag + impl pairs, accepted DEC-EFF-8). There is no `Impl` class: the implementation is a record built by `make`. Test layers live in `<name>.test-layer.ts` next to it and may only be imported from `*.spec.ts` / `testing/` (lint boundary), so they never enter the production bundle.
- **`Effect.fn("Service.method")` for every method**: free span name, and stack frames that name the method (P-observability, section 8).
- **Naming of layers**: `XLive` / `X.Live` (one tag), `XTest`, feature assembly `<Feature>Live` (e.g. `UserFeatureLive`), stratum assembly `InfraLive`, `DomainLive`, `AppLive`. Never `Module`/`Provider`.
- **Composition operators**: `Layer.provide` to close a requirement you do not want exposed, `Layer.provideMerge` to close it and keep it visible (used for repositories so tests can replace them), `Layer.mergeAll` to put peers side by side. A feature exports `Layer<FeatureOut, ConfigError, FeatureIn>` and never calls `Layer.provide(InfraLive)`.
- **No `Layer.succeed` of a class instance** except in tests. A real service is `Layer.effect`/`Layer.effectDiscard`.
- **Ids** are stable strings (`"identity/User/UserService"`); renaming one is a breaking change for the `ServiceClients.Fake` and the wiring spec, so ids are checked by the wiring test (section 5.7).

### 2.4 What is ambient, precisely

```ts
// effect-core
export type Ambient = CurrentActor | Correlation;          // allowed in service-method R
export type RequestR = Ambient | RequestInfo | CurrentTx;  // what api() provides per request
```

`CurrentActor` is a `Context.Service` **without a default**: a service method that reads it carries `CurrentActor` in `R`, and only a request boundary (`api()`), a worker (`runAs(Actor.system("deploy-worker"))`), or a test (`Effect.provideService(CurrentActor, Actor.admin)`) can discharge it. That is the compile-time answer to "which actor is acting here" (SUB-A, section 5.5) and what `actorOf(context)` could not give.

### 2.5 The composition root of a service

Phase 2 (Nest gone): `main.ts` is the only file allowed to launch.

```ts
// identity/src/main.ts
import { Effect, Layer } from "effect";
import { runMain, HttpEdge, Readiness, Probes, ShutdownGrace } from "@deployer/effect-infra";
import { AppConfig } from "./config";
import { identityRouter } from "./http/router";
import { UserFeatureLive } from "./user/user.feature";
import { PermissionFeatureLive } from "./permission/permission.feature";
import { PushFeatureLive } from "./push/push.feature";
import { AnalyticsFeatureLive } from "./analytics/analytics.feature";

/** L0: everything a feature may ask for. Closed here, once. */
const InfraLive = Layer.mergeAll(
  LoggerLive, ObservabilityLive, IdGenLive, KeyRingLive, OutboxLive, EventBusLive,
  PgDbLive("identity"),                 // scoped pool: acquireRelease, closed on shutdown
  ServiceClientsLive,                   // typed clients for siblings (reads CurrentActor/Correlation)
).pipe(Layer.provideMerge(AppConfig.Live));

/** L1: features assembled; their open requirements are exactly InfraLive's outputs. */
const DomainLive = Layer.mergeAll(
  UserFeatureLive, PermissionFeatureLive, PushFeatureLive, AnalyticsFeatureLive,
).pipe(Layer.provideMerge(InfraLive));

/** Probes contributed by features + infra; liveness answers before any of this builds. */
const ProbesLive = Probes.layer([DbProbe, MigrationsProbe, KeyRingProbe /* ... */]);

/** L3: the leaves that make the process do something. */
const MainLive = Layer.mergeAll(
  HttpEdge.layer({ router: identityRouter, port: apiServicePort("identity") }),
  ReadinessLive,
).pipe(
  Layer.provideMerge(ProbesLive),
  Layer.provideMerge(DomainLive),
);

// TS error here if any requirement is unresolved: that IS the compile-time wiring check.
runMain(Layer.launch(MainLive), { name: "svc-identity", grace: "20 seconds" });
```

What this gives, in order, at runtime:

1. `HttpEdge` is the **first** thing built that touches the port: it binds and answers `/health` immediately (replaces the Express `mountLiveness` trick in `apps/api-services/shared/src/server/bootstrap.ts`), with `/health/ready` returning 503 while `Readiness` is `starting`. The orchestrator-restart-loop argument in `bootstrap.ts`'s doc comment is preserved.
2. `AppConfig` builds first and fails with **all** missing keys in one error (exit code 5 for dependency/config class, 1 otherwise; the existing `DependencyNotReadyError` -> exit 5 contract in `health/src/main.ts` is kept by `runMain`).
3. `PgDbLive` acquires the pool; `MigrationsProbe` compares journal head to applied (fixes the weak "journal count > 0" check, ARCH-101 per audit).
4. `Readiness` flips to `ready` when `Probes.preflight` passes (replaces `PreflightService`).
5. SIGTERM/SIGINT: `runMain` interrupts the main fiber. Finalizers run in reverse: `Readiness -> draining` (503 on ready), `HttpEdge` stops accepting, awaits in-flight request fibers (tracked in a `FiberSet`) up to `grace`, then interrupts the remainder; consumers/workers stop claiming and interrupt their job fibers (their `onExit` writes terminal state); the DB pool closes last. This resolves EFF-008 (handler fibers were root fibers that `dispose()` neither interrupted nor awaited, per audit).
6. `runMain` is ~15 lines in `effect-infra` (signal handlers + exit codes); we do not depend on `@effect/platform-bun` as a server (research row 16).

Phase 1 variant (Nest shell still hosts HTTP): same `InfraLive`/`DomainLive`, but `AppLive = DomainLive` is built by a ManagedRuntime **eagerly** in `onApplicationBootstrap` (fail fast) and handed to the oRPC context factory; there is no discovery:

```ts
// effect-nest (temporary)
@Injectable()
export class EffectHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private rt!: ManagedRuntime.ManagedRuntime<AppServices, ConfigError>;
  constructor(@Inject(APP_LAYER) private readonly layer: Layer.Layer<AppServices, ConfigError>) {}
  async onApplicationBootstrap() {
    this.rt = ManagedRuntime.make(this.layer);
    await this.rt.context();               // eager: a bad layer fails boot, not the first request
  }
  context() { return this.rt.context(); }  // typed Context<AppServices>, no cast, no global augmentation
  async onApplicationShutdown() { await this.rt.dispose(); }  // closes scoped resources (pool) in reverse order
}
```

This replaces `collectEffectLayer` (silent skip on duplicate tokens and unresolved instances, `Layer<unknown>`) and the `EffectServices` global augmentation (`packages/nest/effect/src/orpc-context.ts:19-28`): `AppServices` is `Layer.Success<typeof AppLive>`, derived by the compiler.

---

## 3. Hosting: the role of NestJS in a full-Effect world

### 3.1 Options

- **(a) Thin Nest shell**: Nest keeps HTTP (Express adapter), `@Controller` + `@Implement` per procedure, `AuthModule`, `ORPCModule`, lifecycle hooks; Effect keeps everything else, built from an explicit `AppLive`.
- **(b) Drop Nest for a minimal oRPC adapter** on `Bun.serve`: `OpenAPIHandler` from `@orpc/openapi/fetch` (already a dependency: `OpenAPILink` from the same package powers `ServiceClient`, `apps/api-services/shared/src/server/service-client.ts`; `@orpc/node` is also in the catalog at `2.0.0-beta.46`, root `package.json:164-176`), `handle(request, { prefix, context })`, plus a small router for non-oRPC routes (health, Better Auth handler, SSE streams, file download).
- **(c) `effect/http` / `HttpApi`**: rejected (non-goal 1).

### 3.2 Trade-off against what actually exists

| Concern | Nest today | (a) thin shell | (b) oRPC `OpenAPIHandler` + `Bun.serve` | Verdict |
|---|---|---|---|---|
| DI graph | 143 `@Injectable` / 38 `@Module` in `shared/src`, `scripts/check-di-graph.ts` | Layers replace DI for new code; two containers during migration (the very thing that produces request-scope bubbling, `orpc-host.ts:69-72,144`, EFF-015) | One container (Layers); wiring is compile-time typed | (b) |
| Lifecycle / graceful stop | Nest hooks, Rx `AppLifecycleService` | Two lifecycles (Nest hooks + ManagedRuntime) | One `Scope` | (b) |
| Better Auth | `@thallesp/nestjs-better-auth` + `APP_GUARD` (`auth.module.ts:185,226`); BFF only needs it after the signed-claim change | Keep as is | `auth.handler` is a web `Request -> Response` function; mount at `/api/auth/*` in the edge router (official Effect guide does the same, research 2.5). Services stop needing it at all (claim) | (b), after claim lands |
| Guards / middleware | `APP_GUARD`, `AuthPlugin`, `transformNestJSErrorToOrpcError` interceptors | unchanged | oRPC middleware (`requestContext`, `authz`, `errorMap`) is already the enforcement point per `samples/api-sample` README; Nest guards disappear | (b) |
| OpenAPI / docs | `@nestjs/swagger` + `@scalar/nestjs-api-reference` appear only in the BFF test controller (`bff/src/domains/test/controllers/test.controller.ts`); contracts generate OpenAPI via `@orpc/openapi` | unchanged | `OpenAPIGenerator` over the same contracts; no Nest package needed | equal |
| SSE | `@Sse("stream")` in shared `health.module.ts:54` and oRPC event iterators for contracts | works | oRPC event iterator / `ReadableStream` responses on `Bun.serve`; Effect `Stream` -> iterator at the edge | (b) after spike S1 (SSE on Bun under load) |
| Testing | SWC + `emitDecoratorMetadata` + `server.deps.inline` workarounds (`tooling/vitest/src/service.ts:120-175`), Nest `Test.createTestingModule` | same cost | plain Vitest (no SWC), no testing module; `ContractHarness` | (b) |
| Bundling | "bundling breaks Nest DI" (`ARCHITECTURE.md:63`), `design:paramtypes` | `--packages=external` boot test | full `bun build` bundle, even `--compile` is possible for a service with no decorator metadata | (b) |
| Boot time / image size | Nest graph + reflect-metadata + express + swagger libs | same | smaller; fewer processes' worth of reflection | (b) |
| Ecosystem and hiring | Nest is familiar; Effect is not | Nest remains the familiar shell | The remaining surface is oRPC + web standards (`Request`/`Response`) | neutral |
| Risk | known | low | **new HTTP edge**: CORS (`createCorsMiddleware`), body parsing (`bodyParser:false` already), cookies, compression, large uploads (zip upload route), `Set-Cookie` exposure, SSE keep-alive, request timeouts | the only real cost; fenced by spikes S1, S2 |
| Legacy Nest classes (docker/swarm/mesh/supervisors/traefik/analytics) | the entire fleet and runtime substance (fleet 36, runtime 83 `@Injectable`) | host them natively | host them in a **NestIsland** (`createApplicationContext`, no HTTP adapter) behind ports | island |

### 3.3 Recommendation (firm)

**End state is (b). Get there through (a). Nest remains only as an `ApplicationContext`-only island for classes not yet rewritten, never as the HTTP host.**

- **Phase 1 (now to the end of the cutover):** thin shell (a) for every service already on Nest. Differences from today: the runtime is built from an explicit `AppLive` (no discovery), controllers are generated one-liners that bind `api(contract.proc)` (`@Implement` stays because it registers the OpenAPI route; the body is `return router.proc`), `createOrpcModule` stops injecting `REQUEST` (the context factory receives the `ExecutionContext`, as the sample does, `samples/api-sample/src/app.module.ts:41-50`).
- **Phase 2 (per service, the day its island has no Nest providers that handlers need):** flip `HOST=edge`. The service entrypoint becomes the `main.ts` of section 2.5. One release with both entrypoints behind the env flag, then delete the shell (v3 rule: no compatibility layers, `v3/AGENTS.md` "Safety and Boundaries").
- **Islands:** `NestIsland.port(NestToken, EffectTag)` exposes selected providers of a `createApplicationContext(LegacyModule)` as Effect services. The island is `Layer.effect` with `acquireRelease` (`app.close()` on release). It has **no** HTTP, **no** guards, **no** controllers. A port's methods are wrapped with `Effect.tryPromise({ try: (signal) => ..., catch })`; the island's providers keep their constructor DI and `@Injectable`. Expected islands: `DockerIsland`, `SwarmIsland`, `MeshIsland`, `SupervisorIsland` (BFF only), `TraefikIsland`. Each is retired when its port gets a native `Live`.

Order of Nest retirement by service (each is gated on "no handler-reachable provider left in the island, or the island is a pure port"): health (week 4, it has 1 `@Injectable`; the shared `ServiceHealthModule`, `HealthModule`, `PreflightModule` must be re-expressed as `Probes`/`Readiness` first), identity (5 `@Injectable`, but analytics/push/permission must be ported), project (16), then fleet and runtime (island-heavy), BFF last (26 controllers, Better Auth routes, setup SSE, 22 injectables).

### 3.4 Why not stay on (a) forever

The cost of (a) is not the Nest runtime, it is having **two containers and two lifecycles**: the `EffectRuntime` built from Nest instances is the source of every wiring problem in the audit (silent skips, lazily built runtime, request-scope bubbling, `Layer<unknown>` casts, hand-maintained service unions). Under (a) you can fix them, but the fix is a second DI system sitting beside the first. Under (b) the problem class disappears.

### 3.5 Why not drop Nest immediately

143 + 83 + 36 + 25 (`packages/nest`) = roughly 290 Nest classes still carry the platform's real behavior (swarm, mesh, docker, supervisors, traefik, health registry, analytics). A big-bang rewrite is both unnecessary (ports isolate them) and the largest risk in the program. The island design lets Effect become the host first and the classes leave Nest one at a time.

---

## 4. The oRPC boundary

### 4.1 One wrapper: `api(contract)`

Each service has `http/api.ts`, built from the shared kit; handler files never touch oRPC internals.

```ts
// effect-orpc/src/api.ts  (sketch)
export const makeApi = <Ctx extends BaseCtx>() => <C extends AnyContractRouter>(contract: C) =>
  implement(contract)
    .use(requestContext)   // 1. verify claim -> Actor; Correlation; RequestInfo; merge into "effect/context"
    .use(authzFromMeta);   // 2. coarse policy from contract meta (default-deny), shadow mode flag

/** handler authoring: failure channel is a CLOSED union of DomainError; mapping is central. */
export const handle = <P extends AnyProcedure, A, E extends DomainError, R extends RequestR | AppServices>(
  body: (opts: HandlerOpts<P>) => Effect.Effect<A, E, R>,
) => /* wraps: Effect.scoped, span, mapDomainErrors, catchCause -> defect policy, interruption */;
```

Handlers:

```ts
// identity/src/http/user.handlers.ts
const os = api(userContract);

export const userRouter = os.router({
  list: os.list.effect(handle(function* ({ input }) {
    const users = yield* UserService;            // resolved from the base context: no @Inject, no controller field
    return yield* users.list(input.query);       // E = UserForbidden: mapped by kind, no catchTag here
  })),
  delete: os.delete.effect(handle(function* ({ input }) {
    const users = yield* UserService;
    yield* users.delete(input.params.id);
  })),
});
```

Compile-time properties this yields (all type tests in `effect-testing`, section 7.6):

- `os.router({...})` must include every procedure of the contract (oRPC's own typing), so "controller forgot a route" is a compile error; the wiring test then checks the router against contract leaves (`packages/nest/service-client/src/contract-leaves.ts` already computes them).
- `handle`'s `R` must be `<= RequestR | AppServices`, where `AppServices = Layer.Success<typeof AppLive>` is injected into `makeApi<...>()` by the service. A handler that `yield*`s something not in `AppLive` does not compile.
- `E extends DomainError` (below). A raw `ORPCError` or untagged error does not compile; the escape hatch is `Effect.orDie` for infra errors (becomes a defect with a logged cause).

### 4.2 Per-request layer provisioning

oRPC's `.effect()` runs each handler as a root fiber against the `effect/context` entry of the initial context (`Effect.runPromiseExitWith(context)`, per audit). The runtime/base services are therefore passed in the **initial context** and per-request services are **merged in by a middleware**, not by `Effect.provide` (which the oRPC docs warn rebuilds layers per call, research 2.2):

```ts
// effect-orpc/src/request-context.ts  (sketch)
export const requestContext = base.middleware(async ({ context, next }) => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const id = yield* IdGen;
      const claim = yield* ClaimVerifier.verifyHeader(context.request.headers.get("x-deployer-actor"));
      const actor = claim ?? Actor.anonymous;
      const corr = Correlation.from(context.request.headers.get("x-correlation-id"), id);
      return Context.empty().pipe(
        Context.add(CurrentActor, actor),
        Context.add(Correlation, corr),
        Context.add(RequestInfo, RequestInfo.of(context.request, corr)),
      );
    }),
    { /* base context supplies IdGen, ClaimVerifier */ },
  );
  if (Exit.isFailure(exit)) throw ORPCError("UNAUTHORIZED", /* kind: invalid_claim */);
  return next({
    context: { "effect/context": Context.merge(context["effect/context"], exit.value) },
  });
});
```

Constructing a three-element `Context` and merging it with the cached base `Context` is a few allocations per request; no layer is built. Request-scoped *finalizers* (rare) are handled by the `handle` wrapper's `Effect.scoped`, since handler fibers have no `Scope` (oRPC doc caveat).

### 4.3 Errors: the mapping table

One base class and six kinds, derived from the existing standard codes (`packages/transport/orpc/src/standard-errors.ts`: `STANDARD_DOMAIN_ORPC_CODE`, `STANDARD_DOMAIN_HTTP_STATUS`):

```ts
// effect-core/src/errors.ts
export type ErrorKind = "not_found" | "validation" | "conflict" | "unauthorized" | "forbidden" | "dependency_missing";

export abstract class DomainError extends Data.TaggedError("DomainError")<{}> { /* not instantiated */ }

/** Declares an error class: tag + kind + public payload in one expression. */
export const domainError =
  <const Tag extends string, const K extends ErrorKind>(tag: Tag, kind: K) =>
  <Fields extends Record<string, unknown> = {}>() =>
    class extends Data.TaggedError(tag)<Fields & { readonly cause?: unknown }> {
      static readonly kind = kind;
      readonly kind = kind;
      /** What the client may see. Default: nothing but the tag. Never include `cause`. */
      publicData(): Record<string, unknown> { return {}; }
    };

// identity/src/user/domain/user.errors.ts
export class UserNotFound extends domainError("UserNotFound", "not_found")<{ readonly id: string }>() {
  override publicData() { return { id: this.id }; }
}
export class UserForbidden extends domainError("UserForbidden", "forbidden")<{ readonly action: string }>() {}
export class EmailTaken   extends domainError("EmailTaken", "conflict")<{ readonly email: string }>() {}
```

The mapping is **by kind, total by construction**: `kind -> ORPCError code + HTTP status + payload shape` is the six-row table already in `standard-errors.ts`; `mapDomainError(e)` is one function with an exhaustive `switch (e.kind)`, so adding a seventh kind is a compile error until the table gets a row. A new tagged error needs no mapper entry (the shared mapping table accepted by the operator is "per kind", with the per-failure part being the tag and `publicData()`). Because every `standard.zod` operation declares the six standard errors, the mapper's output type is always within the contract's declared errors, which preserves the sample's compile-time contract/failure alignment (`samples/api-sample/test/contract-errors.test.ts:15-26`, per audit) without hand-written `catchTag` in each controller.

Defect policy (in `handle`): `Effect.catchCause` -> if the cause is interruption-only, rethrow (oRPC turns it into the abort); if it contains a failure that is not a `DomainError` or a die, log the full `Cause` (pretty) with `{correlationId, actorId, route}` and respond `INTERNAL_SERVER_ERROR` with `data: { correlationId }`, never the cause (closes EFF-013). Infrastructure errors (`DbError`, `HttpClientError`) are **not** in handler `E`: repositories/adapters either map them to a domain kind (`dependency_missing` when a downstream is down, `conflict` for a unique violation) or `Effect.orDie` them.

### 4.4 Streaming (RxJS at the edge, Stream inside)

Accepted: RxJS stays at the transport edge. Concretely:

- **Inside the domain**: `Stream<A, E, R>` for pull-based sequences (log tails, deployment progress), `PubSub`/`Queue` in `EventBus` for in-process fan-out. No `Observable` in services written after Template v1.
- **At the edge** (`effect-orpc/stream.ts`): `streamHandler(stream)` converts `Stream` to the oRPC event iterator (`Stream.toAsyncIterable`-style helper, name to confirm, EFF-023). The iterator's `return()` (client disconnect) interrupts the stream fiber; the `AbortSignal` provided by oRPC is wired to the handler fiber so a disconnect mid-`Effect.sleep` also cancels. For contracts typed with the repo's `Observable` schema (`packages/transport/orpc/src/observable/contract.ts`), an `asObservable(stream)` adapter is the only RxJS code in a service.
- **Legacy producers** (`packages/nest/events`, swarm events, `deployment-stream-bridge.service.ts`): `Stream.fromObservable` adapter inside the port, so domain code sees a `Stream`.
- **Heartbeats**: the edge adds keep-alive comments to every stream (fixes shared `HealthStreamController` D-2, dead heartbeat), configured once in `HttpEdge`.
- **Multi-replica fan-out** stays out of scope of Effect: `PubSub` is in-process only; cross-process uses Postgres `LISTEN/NOTIFY` behind `Outbox` consumers (ARCH-067).

### 4.5 Cancellation

`AbortSignal` (client abort) -> oRPC `opts.signal` -> `@orpc/effect` interrupts the handler fiber -> every `Effect` underneath is interruptible. For this to mean something at the leaves:

- `fromAbortable((signal) => promise, mapError)` in `effect-core` is the **only** allowed way to lift a Promise; ESLint bans `Effect.tryPromise` whose `try` does not take the signal parameter.
- `Db.use` passes `signal` and additionally cancels server side (section 6.3). `CommandRunner` kills the process group. `ServiceClients` passes `signal` to `fetch`. Ports over Nest classes wrap with `fromAbortable` and, where the class has no cancel hook, accept that the work continues but the fiber is released (documented per port in its `*.port.ts` header).

### 4.6 Middleware as Layers/effects

| Concern | Mechanism |
|---|---|
| `requestContext` (claim, correlation) | oRPC middleware above; runs an Effect against the base context |
| `authzFromMeta` (coarse, SUB-A) | oRPC middleware reads `meta.authz = { resource, action, risk }` from the contract; asks `Authorizer` service (L1, an Effect) to `check(actor, meta)`; **default-deny** when meta is absent (the `standard.zod` builder makes `authz` mandatory at `build()` time: a type error otherwise); shadow mode logs would-be denials and passes |
| Rate limit | `RateLimiter` service (Ref + Clock) applied as `.use(rateLimit("check", 300/min))`; replaces the monolith's `rateLimit(300/min)` on `check` (`effect-health-identity.md` row 3) |
| Audit | `AuditLog` service called from `handle` for risky procedures (`meta.authz.risk >= "high"`): `Effect.fn` span + outbox emit in the same Db transaction when the handler used one |
| Timeouts | `handle` applies `Effect.timeout(meta.timeout ?? defaultTimeout)` mapped to `dependency_missing`-like `GATEWAY_TIMEOUT` kind; long jobs return 202 and run in `JobQueue` instead |

---

## 5. Module, folder and file conventions

### 5.1 Layout per service

```
apps/api-services/services/<svc>/
  package.json  tsconfig.json  eslint.config.ts  vitest.config.mts   (effect preset, no SWC)
  src/
    main.ts                     composition root: the ONLY launch site
    config.ts                   AppConfig schema (Config + Redacted) for this service
    app.layer.ts                InfraLive / DomainLive / AppLive exports; AppServices type
    http/
      api.ts                    makeApi<AppServices>() bound once
      router.ts                 router = merge of feature routers; wiring-test target
      <feature>.handlers.ts     thin: yield* service, return; no rules, no mapping
    <feature>/                  feature-first (never layer-first)
      domain/
        <feature>.types.ts      plain TS types (zod-inferred where the contract already defines them)
        <feature>.errors.ts     domainError(...) classes; the ONLY place errors are declared
        <feature>.rules.ts      pure functions; no Effect imports except for returning typed failures
        <feature>.policy.ts     Policy tag + Live: can*(actor, target) -> Effect<void, Forbidden>
      application/
        <feature>.service.ts    Tag + shape + static Live (use cases)
        <feature>.service.test-layer.ts
      infrastructure/
        <feature>.repository.ts           Tag + shape + Live (Drizzle only)
        <feature>.repository.sql.ts       query builders / row mappers (pure)
        <feature>.repository.test-layer.ts
        <port>.adapter.ts                 adapters to external systems (Docker, Git, ...)
      <feature>.feature.ts      <Feature>Live: assembles the feature's layers, leaves L0 open
      <feature>.service.spec.ts, <feature>.policy.spec.ts, <feature>.repository.spec.ts
  test/
    harness.ts                  ContractHarness bound to this service (section 7)
    e2e/*.e2e-spec.ts
```

Direction inside a feature: `http -> application -> domain`; `application -> infrastructure` only through Tags; `domain` imports nothing from `application`/`infrastructure`/`http`. Enforced by `eslint-plugin-boundaries`-style `no-restricted-imports` (the existing `tooling/eslint` preset gets an `effectService` config, EFF-042).

### 5.2 Naming

| Thing | Name |
|---|---|
| Service Tag | `UserService`, id `"identity/User/UserService"` |
| Repository Tag | `UserRepository`, id `"identity/User/UserRepository"` |
| Port to something external | `DockerPort`, `GitPort`, `WireguardPort` (suffix `Port`), adapters `<x>.adapter.ts` |
| Live / Test | `X.Live` static member; `XTest` exported from `x.test-layer.ts` |
| Error | `<Noun><Condition>`: `UserNotFound`, `EmailTaken`, `DeploymentNotCancellable`; one tag per distinct failure |
| Handler file | `<feature>.handlers.ts`, exporting `<feature>Router` |
| Spans | `Service.method` (`UserService.delete`), repository `Repo.method`; job spans `job:<type>` |
| Config keys | `DEPLOYER_<SVC>_<NAME>`; secrets via `Config.redacted` |

### 5.3 How contracts map to handlers

Contracts remain in `packages/contracts/<svc>` (`@deployer/<svc>-contracts`), built with `standard.zod` (root `AGENTS.md` section 1). `http/<feature>.handlers.ts` implements **exactly** `<svc>Contract.<feature>` and exports a router. `http/router.ts` composes feature routers into the typed `Router<typeof svcContract>`. Parity script `scripts/check-service-surface-parity.py` keeps checking the per-app contract composition; the wiring test adds "every contract leaf has a handler and a `meta.authz`".

### 5.4 Avoiding layer leak (R types)

1. **Shape rule**: in every Tag shape, `R` is `Ambient` (services, repositories used by services) or `never` (adapters, infra). Type helper in `effect-core`:

```ts
export type AssertNoLeak<Shape> = {
  [K in keyof Shape]: Shape[K] extends (...a: any[]) => Effect.Effect<any, any, infer R>
    ? [R] extends [Ambient] ? true : never   // `never` makes the assignment below fail
    : true;
};
// user.service.types.spec.ts
const _noLeak: AssertNoLeak<UserServiceShape> = {} as Record<keyof UserServiceShape, true>;
```

   Generated once per Tag by the template; a unit test file per feature holds them (also runs in `tsc`/`bun check --no-script`).
2. **No `Effect.provide` inside methods**; `Effect.provideService` only inside `api()`/`runAs`/tests.
3. **`Live` leaves requirements open** (section 2.3), so a leak shows up as an unexpected requirement on `Layer<...>` that fails `ManagedRuntime.make`/`Layer.launch` at the root (compile error with the missing tag in the message).
4. **Do not export `XRepository` from the feature barrel**; consumers get the service. Lint rule on the barrel.

### 5.5 Policy and authorization (SUB-A)

Two tiers, no phantom brands:

- **Tier 1, per procedure, coarse**: `meta.authz = { resource: "user", action: "delete", risk: "high" }` on the contract; `authzFromMeta` middleware asks the `Authorizer` (backed by the existing, currently unused `PermissionService` + `role_rules`, which becomes the first `Policy` Layer, `effect-health-identity.md` 4.2). Missing meta fails the contract build (type error) = default deny. Shadow mode: `Authorizer` logs `{decision, wouldDeny}` and passes until enforcement flips per resource.
- **Tier 2, per resource, in the service**: pure rules + `Effect` wrappers; the hierarchy rule ("never act on an equal or higher role unless superAdmin", AUTH-006/AUTH-NEW-C) lives here once:

```ts
// identity/src/user/domain/user.policy.ts
export class UserPolicy extends Context.Service<UserPolicy, {
  readonly canDelete: (actor: Actor, target: User) => Effect.Effect<void, UserForbidden>;
  readonly canSetRole: (actor: Actor, target: User, role: PlatformRole) => Effect.Effect<void, UserForbidden>;
}>()("identity/User/UserPolicy") {
  static readonly Live = Layer.succeed(UserPolicy, {
    canDelete: (actor, target) =>
      rules.outranksOrIsSuper(actor, target) && !rules.isSelf(actor, target)
        ? Effect.void
        : Effect.fail(new UserForbidden({ action: "delete" })),
    canSetRole: (actor, target, role) => /* ... */ Effect.void,
  });
}
```

The `CurrentActor` in a service method's `R` is the compile-time "this code is actor-dependent" marker; there is no way to call `UserService.delete` from a handler, worker, or test without choosing an actor. The privilege matrix test (AUTH-045, SEC-038) is a table-driven `it.effect.each` over `(actor, procedure, expected)` using pure policies, plus a generated 403 matrix from contract meta run through `ContractHarness`.

### 5.6 Repositories

```ts
// identity/src/user/infrastructure/user.repository.ts
export class UserRepository extends Context.Service<UserRepository, {
  readonly findById: (id: UserId) => Effect.Effect<User | null>;            // R = never: Db is closed at Live
  readonly insert: (u: NewUser) => Effect.Effect<User, EmailTaken>;           // unique violation -> typed error HERE
  readonly update: (id: UserId, p: UserPatch) => Effect.Effect<User, UserNotFound>;
  readonly delete: (id: UserId) => Effect.Effect<void>;
}>()("identity/User/UserRepository") {
  static readonly Live = Layer.effect(UserRepository, Effect.gen(function* () {
    const db = yield* Db;                                   // Db<"identity">; resolves to tx inside Db.transaction
    return UserRepository.of({
      findById: Effect.fn("UserRepository.findById")((id) =>
        db.use((d, signal) => d.select().from(user).where(eq(user.id, id)).limit(1)).pipe(
          Effect.map((rows) => (rows[0] ? toUser(rows[0]) : null)),
        ),
      ),
      insert: Effect.fn("UserRepository.insert")((u) =>
        db.use((d) => d.insert(user).values(toRow(u)).returning()).pipe(
          Effect.map((rows) => toUser(rows[0]!)),
          Effect.catchTag("DbUniqueViolation", (e) =>
            e.constraint === "user_email_key" ? Effect.fail(new EmailTaken({ email: u.email })) : Effect.die(e)),
        ),
      ),
      /* ... */
    });
  }));
}
```

`DbError` (tagged: `DbUnavailable`, `DbTimeout`, `DbUniqueViolation`, `DbForeignKey`, `DbSerialization`, `DbUnknown`) is an infra error; repositories translate the ones the domain cares about and `die` the rest. The "check-then-write" pattern identity uses today (`findById -> emailExists -> update`, per audit `user.service.ts:331-363`) is replaced by "write and let the constraint speak" (typed `EmailTaken`), which removes the race.

### 5.7 Verifying wiring

- **Compile time**: `Layer.launch(MainLive)` / `ManagedRuntime.make(AppLive)` require `never` in the `R` slot; `makeApi<AppServices>()` bounds handlers; router typing checks procedure completeness; `AssertNoLeak` checks shapes.
- **Boot time**: eager build in `onApplicationBootstrap` (phase 1) or `Layer.launch` (phase 2); `AppConfig` lists all missing keys; `Probes.preflight` gates readiness.
- **Wiring spec** (one per service, `src/wiring.spec.ts`, no DB): builds `AppLive` with `InfraTest` (all L0 fakes), then asserts (a) every `Context.Service` id is unique across the workspace (a registry test over `*.ts` exports), (b) every contract leaf has a handler and `meta.authz`, (c) every `Probe` is registered, (d) the layer builds in < 2 s. This **replaces** `scripts/check-di-graph.ts` for Effect services (that script only sees `@Module` imports and is itself a cutover item, step 12).

---

## 6. Data access

### 6.1 The `Db<Owner>` layer

```ts
// effect-infra/src/db.ts  (sketch)
export class Db<Owner extends TableOwner = TableOwner> extends Context.Service<Db<Owner>, {
  /** Run a Drizzle callback. Uses the ambient transaction if any, else the pool. Abortable. */
  readonly use: <A>(fn: (db: OwnerDb<Owner>, signal: AbortSignal) => Promise<A>) => Effect.Effect<A, DbError>;
  /** Run `effect` inside ONE transaction on ONE dedicated connection. */
  readonly transaction: <A, E, R>(effect: Effect.Effect<A, E, R>, opts?: TxOptions) => Effect.Effect<A, E | DbError, R>;
}>()("infra/Db") {}

export const PgDbLive = <Owner extends TableOwner>(owner: Owner) =>
  Layer.effect(Db, Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool({ connectionString: Redacted.value(cfg.databaseUrl), max: cfg.dbPoolMax })),
      (p) => Effect.promise(() => p.end()),                    // closed last, on scope exit
    );
    /* use(): current tx if CurrentTx is set, else pool.connect(); register pid for cancel */
    /* transaction(): acquireUseRelease(pool.connect()) + BEGIN/COMMIT/ROLLBACK + CurrentTx set via provideService */
  }));
```

- `OwnerDb<Owner>` is `NodePgDatabase<OwnerSchema<Owner>>`, where `OwnerSchema` is the owner's barrel (`@deployer/nest-schema/global/<owner>`, `packages/nest/schema/src/global/{identity,project,runtime,fleet,health,platform}`) plus the `SHARED_TABLES` it may read. Type-level this limits the **relational query API** to owned tables; raw `db.insert(otherTable)` is prevented by (i) ESLint `no-restricted-imports` of other owners' barrels per workspace, (ii) the existing `table-ownership.spec.ts` (`packages/nest/schema/src/ownership/table-ownership.ts`), (iii) per-service Postgres roles generated from `TABLE_OWNERSHIP` (the roadmap's substrate #4 in `monolith-cutover.md` section 7). Be explicit: only (iii) is a hard boundary; (i)/(ii) are review-time.
- Two flavors, same shape: `PgDb` (global schema) and `LocalDb` over `bun:sqlite` (runtime's `local_queue_jobs`, `local_event_outbox`, `local_build_cache`, `local_runtime_processes`, which `table-ownership.ts` assigns to runtime). Cross-store atomicity does not exist and is not promised; `JobQueue` and `Outbox` pick one store per service and say which (open decision D-11).
- `BaseDatabaseService.db` throws synchronously when uninitialised (`packages/nest/database-core/src/base-database.service.ts:41-47`); in the Layer world there is no uninitialised state (the pool is acquired before anything depends on it). During migration the island adapter wraps the getter in `Effect.try` mapping to `DbUnavailable` (EFF-019).

### 6.2 Fiber-scoped transactions

The repo's 11 callback-style `db.transaction(async tx => ...)` sites (project: `service.repository.ts:183,502,623,659`, `project.repository.ts:241,297,335`; runtime: `deployment.repository.ts:399,456,588,738`, per audit) do not compose with Effect: you cannot `yield*` inside an `async` callback without re-entering the runtime and losing interruption. Design:

- `transaction(effect)` = `Effect.acquireUseRelease(pool.connect(), (client) => BEGIN, then run effect with `CurrentTx = { client, db: drizzle(client) }` provided, COMMIT on success / ROLLBACK on failure or interrupt, release)`. The handle is stored in a `Context.Reference<TxHandle | undefined>` (`CurrentTx`) so any repository using `Db.use` inside the effect transparently runs on the transaction connection, **including repositories of other features** (cross-repository unit of work), with no tx parameter threading.
- **Nesting**: a nested `transaction` inside an active one becomes a `SAVEPOINT` (named per depth); `Db.transaction(effect, { mode: "join" })` joins without a savepoint. Default for use cases: the **service method** opens the transaction; repository methods never open one unless they are single-statement-group units of work by design ("repository method = one unit of work" remains valid for simple cases, accepted DEC-EFF-4).
- **Outbox in the tx**: `Outbox.emit` is `Db.use(insert into outbox)`, so it commits or rolls back with the business write (the INFRASTRUCTURE_TABLES rationale in `table-ownership.ts`).
- **Retries**: only `DbSerialization` / deadlock are retried by `transaction(..., { retry: Schedule.exponential("20 millis").pipe(Schedule.jittered, Schedule.upTo(3)) })`, and only when the effect is declared idempotent by the caller.
- **Never** run external I/O (HTTP to a sibling, docker) inside a transaction by convention; lint can't catch it, review and the `Tx`-ambient `ServiceClients` guard can: `ServiceClients` fails fast with `Defect("external call inside transaction")` when `CurrentTx` is set (dev/test only flag).

### 6.3 Cancellation to the database (mandatory)

node-postgres has no per-query `AbortSignal` that cancels server work. Design (spike S2):

- `use`/`transaction` record `pg_backend_pid()` of the connection they hold. On interrupt/abort, an `onInterrupt` finalizer issues `SELECT pg_cancel_backend($pid)` over a separate pool connection, then releases/destroys the client; the interrupted Drizzle promise rejects and is swallowed. Statement timeout default `SET LOCAL statement_timeout` per transaction (config) as the safety net.
- Exit criterion of S2: a 30 s `pg_sleep` query is cancelled within 1 s of fiber interruption, the pool has no leaked connections, and the transaction rolls back (test uses the Testcontainers harness).
- Bun's `bun:sqlite` is synchronous; interruption cannot preempt a running statement, which is acceptable for local tables (short statements); long local work goes in chunks with `Effect.yieldNow` between.

### 6.4 Migrations

- Drizzle-kit stays the single migration system; do not add `effect/sql`'s migrator (research 2.4). The cutover moves the config into `packages/nest/schema` (cutover step 2).
- Services **never migrate at boot**. Migrations run from the BFF CLI `setup-db` command (`apps/api-services/bff/src/cli/commands/setup-db.command.ts`) / an init job under a leader `Lease`. Services only **verify**: `MigrationsProbe` compares the journal head (`__drizzle_migrations` last hash / `packages/nest/schema` expected head) to applied and makes `Readiness` fail on mismatch (closes ARCH-101 and the half-journaled 0040 problem as a boot error instead of a silent drift).
- Rollback of a failed migration is an ops concern (OPS), not a service concern; services refuse to serve instead of guessing.

---

## 7. Testing architecture

### 7.1 Pyramid and tools

| Level | Subject | Tool | Dependencies |
|---|---|---|---|
| Unit: rules/policies | pure functions | `vitest` + `it.effect.prop` for invariants | none |
| Unit: service | `XService.Live` + `XRepository.Test` + `XPolicy.Live` + `TestClock` | `@effect/vitest` `it.effect`, `it.layer` | none |
| Unit: repository | `XRepository.Live` against real Postgres | `it.layer(PgTestDb)` (Testcontainers once per run, schema once, **rollback per test**) | Docker |
| Contract-level | router + **real middleware chain** | `ContractHarness` (below) | in-memory L0 |
| Wiring | `AppLive` with `InfraTest` | `wiring.spec.ts` | none |
| Type-level | no-leak, handler `E` closed, handler/contract alignment | `expectTypeOf` specs | none |
| e2e | whole service(s), real HTTP, real DB | `TestApp` (`HttpEdge.Ephemeral` + `PgTestDb`) | Docker |
| Time | retries, leases, timeouts, schedules | `TestClock.adjust` | none |

### 7.2 `@effect/vitest` and the Vitest 5 implication

`@effect/vitest@4.0.6` peers `vitest >=5 <6`; the catalog has `^4.1.9` (research 3). Decision: **upgrade the monorepo to Vitest 5 first** (a 1-2 engineer-week task in Template v1, spike S6) because `it.effect`, `it.layer`, `TestClock` integration and `it.effect.prop` are the backbone of this architecture. What changes:

- `tooling/vitest/src/service.ts` currently forces `esbuild: false`, `swc.vite({ legacyDecorator, decoratorMetadata })`, `server.deps.inline: true` for zod subpaths, and a two-project (unit/e2e) config (lines 120-175). For Effect-only services none of the SWC machinery is needed; add `createEffectServiceConfig()` (default oxc/esbuild transform, `globals: false`, fast) and keep `createServiceTestConfig()` for services still on the Nest shell until phase 2. Verify that `unplugin-swc` and the `server.deps.inline` workaround still work under Vitest 5 (S6 exit criterion: the existing suites of one Nest service and `packages/nest/effect` pass on Vitest 5 unchanged).
- `resolveWorkspacePaths()` throws unless `apps/api` exists (`tooling/vitest/src/service.ts:37-47,71,214-215`); that is already cutover blocker #1 and is fixed in the same change (the e2e `globalSetup` moves to `@deployer/effect-testing`).
- Interim (before Vitest 5 lands): plain Vitest + `Effect.runPromise` + `TestClock` from `effect/testing` through a 20-line helper (EFF-030). Do not write new tests in the old style that will be rewritten.

### 7.3 One test layer per port

Every Tag ships `XTest` in `x.test-layer.ts`:

```ts
// identity/src/user/infrastructure/user.repository.test-layer.ts
export const UserRepositoryTest = (seed: readonly User[] = []) =>
  Layer.effect(UserRepository, Effect.gen(function* () {
    const rows = yield* Ref.make(new Map(seed.map((u) => [u.id, u])));
    return UserRepository.of({
      findById: (id) => Ref.get(rows).pipe(Effect.map((m) => m.get(id) ?? null)),
      insert: (u) => Effect.gen(function* () {
        const m = yield* Ref.get(rows);
        if ([...m.values()].some((x) => x.email === u.email)) return yield* new EmailTaken({ email: u.email });
        const user = yield* makeUser(u);                       // uses IdGen + Clock
        yield* Ref.update(rows, (m) => new Map(m).set(user.id, user));
        return user;
      }),
      /* ... */
    });
  }));
```

A service spec:

```ts
// user.service.spec.ts
import { it, expect, layer } from "@effect/vitest";

const TestLive = UserService.Live.pipe(
  Layer.provide(UserRepositoryTest([admin, bob])),
  Layer.provide(UserPolicy.Live),
  Layer.provide(Outbox.Recording),
  Layer.provide(IdGen.Sequential),
);

layer(TestLive)("UserService", (it) => {
  it.effect("an admin cannot delete a superAdmin", () =>
    Effect.gen(function* () {
      const users = yield* UserService;
      const exit = yield* users.delete(superAdmin.id).pipe(Effect.provideService(CurrentActor, Actor.admin), Effect.exit);
      expect(Exit.isFailure(exit) && Cause.failureOption(exit.cause)).toEqual(Option.some(new UserForbidden({ action: "delete" })));
    }));
});
```

This replaces the ad-hoc object-literal fakes and the `vi.fn()`/`vi.clearAllMocks` convention in root `AGENTS.md` section 7 (amended in the same change, EFF-039); the new rule is "no `vi.fn()` for ports; write or reuse the port's `Test` layer".

### 7.4 `ContractHarness`: contract tests that include middleware

Today `callProcedure` in `packages/transport/orpc/src/testing/index.ts:29-35` calls `~orpc.handler` directly, skipping validation and middleware, so health's controller spec never exercises auth (audit 5.12). Replace it with:

```ts
// effect-testing/src/contract-harness.ts
export const ContractHarness = {
  make: <R extends AnyRouter>(router: R, infra: Layer.Layer<AppServices, never, never>) =>
    Effect.gen(function* () {
      const base = yield* Effect.context<AppServices>();   // from infra
      const as = (actor: Actor, opts?: { headers?: HeadersInit }) => ({
        call: <P extends ProcedurePath<R>>(path: P, input: InputOf<R, P>) =>
          callThroughMiddleware(router, path, input, {
            request: fakeRequest({ actor: signClaim(actor), ...opts }),  // real verification path
            "effect/context": base,
          }),   // runs claim verification, authzFromMeta, validation, handler, error mapping, output validation
      });
      return { as, anonymous: as(Actor.anonymous), admin: as(Actor.admin), user: (id: string) => as(Actor.user(id)) };
    }),
};
// usage
it.effect("user cannot list users (403, not 500)", () => Effect.gen(function* () {
  const h = yield* ContractHarness.make(identityRouter, InfraTest.pipe(Layer.merge(DomainTest)));
  const res = yield* h.user("u1").call("user.list", {});
  expect(res).toMatchObject({ error: { code: "FORBIDDEN" } });
}));
```

It uses the real `requestContext` and `authzFromMeta`, so removing `meta.authz` or the middleware fails a test (EFF-031 done-when). A generated `it.each` over every contract leaf asserts the 403 matrix (SEC-038): for each procedure and each platform role, the expected allow/deny comes from the **contract meta**, not hand-written.

### 7.5 e2e harness

- `@deployer/effect-testing/e2e`: `PgTestContainer` (one container per Vitest run: port the logic of `apps/api/vitest.shared-postgres.e2e.ts`/`vitest.global-setup.e2e.ts`/`vitest.teardown.e2e.ts`, cutover step 7, rather than extracting the old file set), migrations applied once, `TestApp.layer({ services: [identity, project], overrides })` that starts each service's real `HttpEdge` on port 0 inside one process and wires `ServiceClients.Fake` to the in-process URLs. Per-test isolation: wrap the test in `Db.transaction` with forced rollback (`PgTestDb`); tests that need commits (outbox consumers, job worker) use a schema-per-file clone.
- This **replaces** `apps/api-services/shared/src/e2e-harness/shared-api-runtime` and the services' `src/e2e/runtime.ts` (cutover steps 7-8 land here, not in the old harness).
- Playwright journeys (JRN-*) are unchanged and sit above.

### 7.6 Type-level tests

`AssertNoLeak`, "handler failure channel is a `DomainError` subset" (replaces `health.contract.spec.ts` which only checks the client side), "handler requirements are within `RequestR | AppServices`", "every `DomainError` subclass has a `kind`" (EFF-034). Run by `bun check --no-script` through `tsc`-equivalent (`bun check --no-script`); no runtime cost.

---

## 8. Observability and operability

- **Correlation ids**: generated by `requestContext` (`IdGen`, uuidv7) or taken from `x-correlation-id` (the BFF always sets it before fan-out); stored in `Correlation`; **every log line** carries it through `Effect.annotateLogs` applied once in `api()` (`withLogAnnotations`); every outgoing `ServiceClients` call forwards it; defect responses return it in `data.correlationId`; BFF screens echo it in `x-correlation-id` so a user-visible error is greppable across processes. Delivered first (accepted DEC-EFF-12).
- **Structured logs**: `LoggerLive` formats `{ts, level, service, correlationId, actorId, route, msg, ...annotations}` to stdout in JSON in production (pretty in dev) and delegates to `@deployer/logger`. `Redacted` values print as `<redacted>` by construction; a unit test pushes a `Redacted` through the logger (EFF-151). No `console.*` in L1-L3 (lint).
- **Traces (next step)**: `@effect/opentelemetry` `OtelTracer.layerGlobal` plus the existing `ORPCInstrumentation` pattern so `Effect.fn` spans nest under oRPC spans (research 2.8). Traces only; OTel *logs* are not enabled because the `sdk-logs <0.300` peer range conflicts with `@opentelemetry/sdk-node ^0.300.0` (research 3). Spike S4 verifies context survives `Effect.sleep`/forks. `traceparent` is propagated by `ServiceClients` (header) so the trace crosses BFF -> services.
- **Metrics**: `Metric` counters/histograms defined once (`http_request_duration{route,kind}`, `domain_error_total{tag}`, `db_query_duration`, `job_duration{type,outcome}`, `outbox_lag_seconds{consumer}`), exported when OBS-049's endpoint exists. Not blocking.
- **Health / ready as layers**: `Probe` is a Tag `{ name, check: Effect<ProbeResult>, timeout, critical }`; features contribute probes via `Probes.layer([...])`. `Readiness` (Ref state: `starting | ready | degraded | draining`) is flipped by `Probes.preflight` at boot and by the continuous `Probes.run` loop (`Schedule.spaced(cfg.probeInterval)` forked in scope, jittered, per-probe `Effect.timeout`, clears the leaked `timeoutAfter` timers of the shared registry). `/health` = liveness (always 200 when the edge is up), `/health/ready` = `Readiness` (200/503, no I/O per request), `/health/detailed` = last snapshot. This re-expresses the shared `HealthRegistry` (`apps/api-services/shared/src/server/health/`) and `PreflightService` without RxJS; `changes$` becomes a `PubSub` that an `OutboxConsumer` or `AuditLog` subscribes to (OBS-003).
- **Supervisors**: dropped from `svc-health` (accepted). Supervisors live in the BFF process (`bff` hosts `SupervisorOrchestratorService`); the platform view is a BFF screen. Inside the new model a "supervisor" is just a forked scoped fiber (`Effect.forkScoped` with `Schedule`), supervised by the `Scope`; the Nest `supervisor-core` is a port on the BFF island until rewritten.
- **Lifecycle phases**: `AppLifecycleService` (Rx state observer) is replaced by `Readiness` states; the monolith's `lifecycle {phase, step, message}` in `check` (parity row 1) is a `Readiness.snapshot()` field.
- **Operational endpoints**: `/health/stream` (SSE) remains, built from `Readiness`/`Probes` `PubSub`, with a real heartbeat and no duplicate first emit (D-2, D-3 fixed by construction: `Stream.concat(Stream.make(current), changes)` with `Stream.merge(heartbeat)`).

---

## 9. Cross-service

### 9.1 Service-to-service calls

`ServiceClients.client(service, contract)` returns an oRPC client whose procedures return `Effect<Output, ServiceCallError | DeclaredErrors>`: built on `createEffectClient` from `@orpc/effect` (propagates the abort signal, demonstrated in `samples/api-sample/src/modules/demo/demo.controller.ts:28-45`, per audit) over the existing `ServiceClientRegistry` (`packages/nest/service-client`), so the origin resolver and per-contract caching are reused (`service-client.registry.ts`: cache keyed by contract object). It sits in `effect-orpc`; the two Promise stacks (`ServiceClient` in `apps/api-services/shared/src/server/service-client.ts` and `packages/nest/service-client`) collapse into it (ARCH item "single client stack").

Per-call it does, in order: read `CurrentActor`/`Correlation` from the fiber, **mint a service-scoped claim** (below), set `x-deployer-actor`, `x-correlation-id`, `traceparent`, apply the `ResiliencePolicy` for that call class, pass `signal`.

Generated BFF delegation controllers (`bff/src/modules/delegation/generated/*.delegation.ts`, per audit) stay thin Promise-less forwarders: the generator (`scripts/gen-bff-delegation.py`) is re-pointed to emit `os.<proc>.effect(handle(function* ({input}) { const c = yield* ServiceClients; return yield* c.client("identity", userContract).user.list(input); }))`. 18 files, mechanical.

### 9.2 Signed actor claim (replaces cookie relay and ALS)

- **Issuer**: the BFF, after resolving the Better Auth session once per inbound request (cookie cache of 5 minutes stays; sensitive procedures call `getSession({ disableCookieCache: true })`, AUTH-013). It signs a claim: `{ iss: "bff", aud: "<service>", sub: userId, role, platformRole, sid: sessionId, corr, iat, exp: +30s, jti, kid }` with **EdDSA (Ed25519)** via `KeyRing`. Compact JWS in `x-deployer-actor`. One claim per (request, audience), minted lazily by `ServiceClients`, `exp` short so replay window is seconds.
- **Verifier**: every service's `requestContext` verifies signature (public keys from `KeyRing`, `kid` rotation: current + previous accepted for one TTL), `aud`, `exp`, optional `jti` replay cache (Ref of seen jti until exp; only for write procedures). Verified claim -> `Actor`. No claim -> `Actor.anonymous`; `authzFromMeta` then denies anything not declared public.
- **Background callers**: `Actor.system(name)` signed by the **issuing service** with its own `KeyRing` key (`kind: "service"`), solving the anonymous `svc-project -> svc-fleet` call and the webhook/trigger system-actor gap (ARCH-056, cutover step 5). Verifiers accept service claims only for procedures whose `meta.authz.allowSystem` lists that issuer.
- **Mesh-internal key** (`x-mesh-internal-key`, `service-auth-context.ts:50-56`) becomes a claim of `kind: "mesh"` with scoped `aud`; the header disappears from the relay.
- **Keys**: `KeyRing` entries `{ kid, alg, public, private? (Redacted), notBefore, notAfter }` in the BFF-owned keyring table (identity-owned) + env bootstrap; rotation = add key, wait one TTL, retire. Services need only public keys (fetched at boot from the BFF `/.well-known/keys` over the internal network, cached, refreshed on `kid` miss with a rate limit).
- **Consequence**: services no longer import `AuthModule` just to satisfy `createOrpcModule` (documented as an opaque failure in `orpc-host.ts` comments); boot gets smaller and `createBetterAuth` leaves the services' dependency set. Better Auth stays BFF-only.

### 9.3 Retries, timeouts, circuit breaker (Schedule policies)

One module `ResiliencePolicy` in `effect-infra`, applied by `ServiceClients` and by ports:

| Class | Timeout | Retry | Notes |
|---|---|---|---|
| `read` (GET, idempotent) | 3 s | `Schedule.exponential("100 millis", 2).pipe(jittered, upTo(2))` on `ServiceUnavailable \| Timeout \| 502/503/504` only | never retries a domain error (4xx) |
| `write` (POST/PUT/DELETE) | 10 s | none by default; with an idempotency key header retry as `read` | idempotency keys required for deploy/webhook-triggered writes |
| `stream` (SSE) | no total timeout; idle timeout 30 s | reconnect with `Schedule.fibonacci("1 second").pipe(upTo(30 seconds))` at the *consumer*, resume from `Last-Event-ID` | |
| `probe` | 3 s | none | feeds `Probe` result |

Circuit breaker: Effect core has none; a ~60-line `CircuitBreaker` (Ref state `closed/open/half-open`, `Clock`-driven reset, per `(service, class)`) lives in `effect-infra` and is tested with `TestClock`. Bulkhead: `Semaphore` per downstream port (docker: 4 concurrent builds per node, git: 8) configured via `AppConfig`.

### 9.4 Outbox consumers

`OutboxConsumer.layer({ name, handler, batch: 50, poll: Schedule.spaced("1 second").pipe(jittered) })`: a forked scoped fiber claims rows after its cursor (`outbox_consumer_cursors(consumer, last_seq)`) with `FOR UPDATE SKIP LOCKED` in a `Db.transaction`, runs `handler` per event (handlers **must be idempotent by `eventId`**, at-least-once), advances the cursor in the same transaction, backs off on error, parks a poison event after N attempts into `outbox_dead_letters`. Producers write via `Outbox.emit` in the business transaction. Multi-replica: all replicas run the consumer; `SKIP LOCKED` + cursor row lock gives single delivery per event per consumer, no leader needed. Consumers registered today: none (`LocalEventOutboxDispatcherService` only `markSent`, per cutover section 7); first consumers: identity notifications/push, health SLO feed, audit.

---

## 10. Packaging

### 10.1 Split and rename

| Package (new) | Contents | Depends on | Replaces |
|---|---|---|---|
| `@deployer/effect-core` | `DomainError`/`domainError`, `ErrorKind` + mapping table, `Actor`, `CurrentActor`, `Correlation`, `Ambient`, `IdGen`, `fromAbortable`, `AssertNoLeak`, `ResiliencePolicy` types, `Redacted`/`Config` helpers, pure claim types | `effect` (peer) | parts of `nest-effect` + new |
| `@deployer/effect-orpc` | `makeApi`, `handle`, `requestContext`, `authzFromMeta`, `HttpEdge`, stream bridge (`streamHandler`, `asObservable`), `ServiceClients`, claim verifier/signer glue, `standardErrorActions` bridge | effect-core, `@orpc/*` (peers, exact), `packages/transport/orpc` | `nest-effect/orpc-context`, `shared/server/orpc-host.ts` (phase 2) |
| `@deployer/effect-infra` | `Db`/`PgDbLive`/`SqliteDbLive`, `Logger/Observability` layers, `KeyRing`, `CommandRunner`, `FileSystem`, `EventBus`, `Outbox`, `OutboxConsumer`, `JobQueue`/`Worker`, `Scheduler`/`Lease`, `Probes`/`Readiness`, `runMain`, `CircuitBreaker` | effect-core | `shared/server/{preflight,health}`, `database-core` (Effect part) |
| `@deployer/effect-testing` | `ContractHarness`, `TestApp`, `PgTestContainer`/`PgTestDb`, `InfraTest`, `Actor` fixtures, type-test helpers, `wiringSpec()` | all above, `@effect/vitest` | `nest-effect/testing`, `orpc-utils/testing#callProcedure` |
| `@deployer/effect-nest` (temporary) | `EffectHost` (eager ManagedRuntime), `NestIsland`, `facade(Tag)` | effect-core | `nest-effect` (renamed, shrunk); **deleted** with the last Nest island |

`mesh-agent` (`apps/mesh-agent`, plain Bun, 1501 lines in 12 files per audit) depends on **effect-core and effect-infra's Bun-only subset** only; binary size is measured before adoption (S3: `bun build --compile` delta must stay under an agreed budget, default +8 MB).

Peer-dependency policy: `effect`, `@orpc/*` are **peers**, resolved from the catalog and pinned **exactly** (`effect@4.0.6`, `@orpc/*@2.0.0-beta.46`, accepted); `bun why effect` must show one copy (EFF-011); one `Context.Service` identity per process is a hard requirement because two copies produce "service not found" at runtime.

Versioning: all five packages are workspace-internal (`"*"`), versioned in lockstep with `bump-version`; no publishing. Breaking changes are made in one change set together with all consumers (v3 rule: no shims). Changelog lives in each package's `CHANGELOG.md`.

### 10.2 `create-service` template generator

New MCP tool + script (`create-service { name, owner, features: [..] }`, alongside `create-app`/`create-package` of `packages/mcp-repo-manager`) emitting, **compiling and passing `bun check --no-script` on day one**:

- the tree of section 5.1 with one sample feature (`ping` or a real stub), `main.ts`, `app.layer.ts`, `config.ts`, `http/{api,router}.ts`, `wiring.spec.ts`, `test/harness.ts`, `*.service.spec.ts`, `AssertNoLeak` specs;
- `package.json` with peers, scripts (`dev`, `build` = `bun build src/main.ts --target=bun` (full bundle), `test`, `lint`, `type-check`), `vitest.config.mts` via `createEffectServiceConfig()`, `eslint.config.ts` with the `effectService` preset (boundaries, `tryPromise` signal rule, no raw `process.env`, no `Effect.runPromise` outside `main.ts`/tests, no `console`, no `Effect.provide` in handlers);
- a Dockerfile fragment using the corrected `HEALTHCHECK` for the service port (ARCH-051);
- registration lines to add to `apiServicePort` catalog, compose, `TABLE_OWNERSHIP` (and a failing test until a table is claimed), contract package skeleton `@deployer/<svc>-contracts` with `standard.zod` ops and mandatory `meta.authz`.

The sample (`samples/api-sample`) is folded into the template and `docs/architecture/14-effect-services.md`, then deleted (DEC-EFF-10 accepted: "thin consumer of nest-effect in the workspace with CI tests" meanwhile: it moves under `samples/` as a workspace member consuming `effect-core`/`effect-orpc`, with catalog versions, until the generator output replaces it).

---

## 11. Migration plan

### 11.1 Order and effort

Effort in engineer-weeks (ew); one engineer fully on it unless parallel is stated. Estimates include tests and docs; they do not include the product work the substrates unlock.

| # | Step | Contents | Effort | Exit criterion |
|---|---|---|---|---|
| 0 | **Template v1 foundation** | effect-core (errors, Actor, Ambient, `fromAbortable`, claim types); effect-orpc (`makeApi`/`handle`/`requestContext`, error table, defect policy); effect-infra (`Db` + tx, Logger, Config/Redacted, IdGen, `runMain`, `Probes`/`Readiness`); effect-testing (`ContractHarness`, `InfraTest`, wiring spec); `effect-nest` (`EffectHost` eager, `NestIsland`, facade); Vitest 5 upgrade (S6); ESLint preset; docs `14-effect-services.md` + AGENTS/ARCHITECTURE reconciliation | **5-6** (Vitest 5 is 1-2 of it, can run in parallel) | health re-done on the template: 9 existing tests ported, uptime bug has a failing-first test, `bun check --no-script` green |
| 1 | **health** (reference service) | rewrite onto Layers; `HealthService.report()` domain object (fixes uptime x1000, hard-coded name); `Probes` replaces `HealthRegistry` use; authz stance (`check` public with rate limit, `detailed` `requireAuth`); heartbeat fix; supervisors field dropped; phase-2 `HOST=edge` proof | **1.5** | service runs under `HttpEdge`, shell deleted for health; S1 (SSE/Bun) passed |
| 2 | **BFF: claim issue + ServiceClients** (parallel with 3) | KeyRing, claim minting, `ServiceClients` over the registry, correlation id; keep BFF on the Nest shell | **2** | services verify claims; ALS relay deleted behind a flag; fan-out e2e green |
| 3 | **identity** finish | user domain refactored to tagged-per-failure (delete `UserServiceFailure`), hierarchy rule, `Db`; permission -> `Policy`/`Authorizer` (SUB-A skeleton on 3 procedures); push (fix DI bug by rewriting, VAPID decision) and analytics (split 934-line service: repos + host-metrics adapter + report service) as Layers; remove `AuthModule` dependency via claim | **4-5** | all 34 procedures on Layers; 403 matrix generated; identity on `HttpEdge` |
| 4 | **project** | 4 modules, 7 tx sites rewritten with `Db.transaction`, cascade/dependency logic, fleet calls via `ServiceClients`, outbox emits in tx | **4** | no `db.transaction(async` left; cancel test (S2) in CI |
| 5 | **runtime: job worker (SUB-B), greenfield** | `deployment_jobs` table, `JobQueue`/`Worker` (lease, heartbeat, `FiberMap`, cancel -> interrupt), `CommandRunner` scoped children, terminal-state CAS; built as the first Effect module inside runtime (runtime otherwise still on the shell + islands) | **3-4** (parallel-able with 4) | kill -9 mid-job reclaims via lease; cancel kills child < 1 s; S5 workflow spike decision recorded |
| 6 | **fleet** | cluster/fleet/platform/providers/reachability; Docker/Swarm/Wireguard/Traefik ports (island first), reachability streams as `Stream`, node-removal saga with `Effect.acquireRelease`-style compensation | **5-6** | islands reduced to pure ports; streams interrupt on disconnect |
| 7 | **runtime remainder** | deployment, docker, providers, runners (117 files / 28.6k lines, 32 specs, 4 tx sites); builders registry (cutover step 4) and trigger registry (step 5) are written **directly** in the target style | **8-10** | runtime off the shell |
| 8 | **BFF edge** | orchestrators/screens as Effect (`Effect.all` with concurrency/timeouts/partial failures); generated delegation re-emitted; Better Auth routes + setup SSE + docs routes onto `HttpEdge`; supervisors as scoped fibers or port; shell removed | **3-4** | no Nest HTTP host anywhere |
| 9 | **mesh-agent** (parallel, any time after 0) | `Layer`/`Scope`/`Schedule` for the agent loop, gossip, door converger, wireguard driver; effect-core only; binary-size gate | **1.5-2** | tick loop and SIGTERM semantics (`apps/mesh-agent/src/main.ts`: leave WireGuard up on SIGTERM) preserved as tests |
| 10 | **Retire `effect-nest`, Nest islands, `check-di-graph.ts`, SWC test config** | delete shims and old packages; update docs | **1** | `grep -r "@nestjs" apps/api-services` returns only island adapters, then nothing |

Total about **38-46 ew sequential; about 28-32 calendar weeks for two engineers** with the parallelism marked. The first reusable template (steps 0-1) is at week ~7 for one engineer; steps 2-3 can start as soon as step 0's `requestContext`/claim types exist (week ~3).

### 11.2 Strangler seams (where old and new meet, per service)

1. **Per procedure**: a procedure can be served by an Effect handler or by an old Nest handler inside the same router (today's state in identity). `os.router({...})` + `@Implement` bridging means a feature moves procedure by procedure.
2. **Per provider**: a Nest provider becomes an Effect service through `NestIsland.port(Token, Tag)` (Effect -> Nest) while it still lives in the shell; the reverse direction is `facade(Tag)` (Nest -> Effect): a generated `Promise` wrapper that runs each method with `Actor.system("legacy:<module>")`, marked `@deprecated legacy-facade`, banned from new code by lint, tracked by EFF-118. This is the accepted "mixed-mode with facade".
3. **Per process**: `HOST=nest|edge` env switch for one release.
4. **Per contract consumer**: old Promise clients and `ServiceClients` coexist until step 2 finishes; `ServiceClients` wraps the same `ServiceClientRegistry` so origins and caching do not fork.
5. **Per table**: no data migration is needed; ownership (`TABLE_OWNERSHIP`) is unchanged.

### 11.3 Mixed mode rules

- A service is "mixed" only between the first Effect module landing and step N of its row above; mixed services are labelled in `docs/architecture/14-effect-services.md` with the remaining islands and tracked by one issue per service (EFF-118).
- New code in a mixed service is **always** Effect-style, even if its neighbors are not; classic modules are not extended except for bugfixes.
- Nest code reaches Effect only through `facade(...)`; Effect reaches Nest only through `NestIsland.port(...)`. No third path.
- The shared `@deployer/shared` core (`apps/api-services/shared/src/core`, 62k lines across 367 files, per audit) is **not** migrated wholesale: pieces move when a service needs them as ports; unmigrated pieces stay Nest and are consumed through islands.

### 11.4 Spikes (all time-boxed, in step 0)

| ID | Question | Exit criterion |
|---|---|---|
| S1 | `OpenAPIHandler` (`@orpc/openapi/fetch`, beta.46) on `Bun.serve`: parity with `@orpc/nest` routing, SSE/event-iterator under load, CORS and compression plugins, 25 MB zip upload route | health + one stream + one upload served; request-abort interrupts the handler fiber |
| S2 | DB cancellation via `pg_cancel_backend` and dedicated-connection transactions with Drizzle 0.45 | 30 s `pg_sleep` cancelled < 1 s, no leaked connection, rollback verified |
| S3 | Effect footprint in mesh-agent `bun build --compile`; boot time of a 7-process tier | size/boot numbers recorded, budget agreed |
| S4 | OTel context across `Effect.sleep`/forks and `OtelTracer.layerGlobal` with `sdk-node ^0.300.0` | nested spans in one trace across a sleep |
| S5 | `effect/workflow` + `SingleRunner` on Postgres vs the SQL worker (research prototype 4) | decision gate `EFF-149`: adopt only if kill/interrupt/resume pass and `bun check --no-script` stays fast; default is the SQL worker |
| S6 | Vitest 5 + `@effect/vitest@4.0.6` + `unplugin-swc` + `server.deps.inline` workaround | existing suites of one Nest service and `packages/nest/effect` green on Vitest 5 |

### 11.5 Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | oRPC 2 beta breaks `.effect()`/`effect/context` typing on a bump | M | H | exact pin, bump owned by one person, all oRPC specifics isolated in `effect-orpc` (handlers only import `api`/`handle`), contract type tests in CI |
| R2 | Unstable Effect modules churn (`process`, `sql`, `workflow`) | M | M | we depend on **stable** modules only (Effect, Layer, Schema for payloads, Schedule, Config, Redacted, Stream, Scope, Metric, Logger, TestClock); `CommandRunner` wraps spawn behind our own port, `ChildProcess` stays optional |
| R3 | `HttpEdge` regressions (CORS, cookies, uploads, SSE keep-alive) | M | H | S1, one-release `HOST` flag, Playwright journeys against both hosts before deleting the shell |
| R4 | DB cancel/tx design fails on Drizzle 0.45 | L | H | S2 first; fallback: tx via `client.query` + manual repositories for the 11 transaction sites, `statement_timeout` as the safety net |
| R5 | Two-engine learning curve / bus factor | H | M | the template generator + checklists, one "Effect reviewer" per PR for the first 3 services, in-repo `ai-docs` pointer in AGENTS.md (assistants emit v3 syntax) |
| R6 | Vitest 5 upgrade destabilises 40+ suites | M | M | S6 before anything else depends on it; keep `createServiceTestConfig()` until phase 2 |
| R7 | Scope creep (rewriting `packages/nest/*` internals, schemas) | H | H | non-goals; ports only; "migrate what the next substrate needs" gate per step |
| R8 | Signed claim design flaw (replay, key rotation) | L | H | 30 s TTL, `aud`, `jti` cache for writes, `kid` rotation tests with `TestClock`; security review before enforcing (SUB-A shadow first) |
| R9 | Migration stalls and leaves long-lived mixed services | M | M | tracked per service; the `HOST` flag and island list are the exit checklist; step 10 deletes shims |
| R10 | Cutover (`apps/api` removal) delayed by Template v1 | M | M | section 11.6: infra-only cutover steps proceed now; code-porting steps land in target style as the second/third consumers of the template |
| R11 | Dual `effect` copies (two `Context.Service` identities) | L | H | peer dependency, single copy check in CI (`bun why effect`), boot assertion `Context.isKey` identity in wiring spec |
| R12 | `bun build` full bundle misses dynamic requires (Drizzle drivers, Better Auth) | M | M | boot test of the built artifact in CI (`bun dist/main.js` + `/health/ready`), `--packages=external` stays allowed for services with unbundleable deps (accepted DEC-EFF-9) |
| R13 | Effect API drift from training-data v3 syntax | H | L | lint (`Context.Tag`, `Effect.Service`, `Layer.scoped` banned by `no-restricted-syntax`), reviewer checklist |

### 11.6 Impact on the monolith cutover (`monolith-cutover.md` section 6)

The cutover is mostly infrastructure; Effect changes only the code-porting steps and makes two scripts obsolete.

| Step | Effect impact | Action |
|---|---|---|
| 1 Final topology | none | proceed now |
| 2 Move drizzle config + auth:generate into `packages/nest/schema` | none | proceed now (migrations stay drizzle-kit; services only verify) |
| 3 Port `backfill-env-secrets` to BFF CLI | uses `KeyRing`/`Crypto.seal` with `kid` (also SEC-016) | write it against `Crypto`; S effort grows by 2-3 days |
| 4 Builder strategy registry to runtime | write **directly** as Effect services (builders = Tag + `Live`, `CommandRunner`) as an early consumer of step 0; not ported as a Nest class | schedule after step 0, inside step 5/7 of 11.1 |
| 5 Trigger registry, webhook routing, system actor | the system actor is exactly `Actor.system` + service claims (9.2) | blocks on step 2 of 11.1 (claim), then lands in runtime/fleet |
| 6 Analytics download controller | a raw `HttpEdge` route (stream a stored report) + identity analytics rewrite | land with identity (step 3 of 11.1) |
| 7 Extract e2e harness | **do not extract the old harness**; port only Postgres container/global-setup logic into `effect-testing`; fix `resolveWorkspacePaths` throwing without `apps/api` (`tooling/vitest/src/service.ts:37-47`) now (S) | split: (a) minimal `resolveWorkspacePaths` + shared-postgres move now, (b) full `TestApp` later |
| 8 Port or drop the 16 e2e specs | port into `ContractHarness`/`TestApp` style only for already-migrated services; the rest are ported once at their migration step | spec count is not a cutover blocker; features-lost list (cutover section 5) is the gate |
| 9-11 compose, images, setup | none | proceed now; `HEALTHCHECK` per service port is fixed in the generator template |
| 12 Scripts/tooling | `check-di-graph.ts` is **retired**, not retargeted, once the BFF and services are on Layers; until then retarget minimally. `sync-api-vitest-aliases.py`, `verify-mesh-master-decision.ts`: unchanged | retarget scope shrinks |
| 13 Docs | add `14-effect-services.md`; AGENTS/ARCHITECTURE reconciled | same change |
| 14 `git rm -r apps/api` | still gated on `ARCH-032` snapshot tag and on steps 4-6 and the features-lost list | do not wait for Effect work otherwise (EFF-002 stands) |

Net: cutover critical path gains no new blockers except "claim before step 5"; steps 4-6 move from weeks 1-3 to weeks 4-9. Freeze the monolith's health/user/push/analytics (EFF-070) immediately; they are superseded, not maintained.

### 11.7 Impact on the roadmap substrates

| Substrate | Design under full Effect |
|---|---|
| **SUB-A authz (SEC-001)** | `meta.authz` mandatory on contracts (default-deny at build), `Authorizer` service (Layer) backed by the permission engine + `role_rules`, `authzFromMeta` middleware with shadow mode, `Policy` Tags per feature, `CurrentActor` in `R`; generated 403 matrix via `ContractHarness`; identity is the first adopter (step 3). No Nest guards. Effort inside step 3: the skeleton on 3 procedures is ~1 ew; the other 200+ procedures are mechanical annotation. |
| **SUB-B durable queue + real cancel (DEPLOY-014..018)** | `JobQueue`/`Worker` Layer on Postgres: claim `FOR UPDATE SKIP LOCKED`, lease + heartbeat (`Effect.repeat(Schedule.spaced)` in the job's scope), one fiber per job in a `FiberMap`, `cancel` sets `cancel_requested` (cross-replica via heartbeat poll) and interrupts the local fiber; `Effect.onExit` writes the terminal state with a status compare-and-set (no terminal overwrite, DEPLOY-018); `CommandRunner` kills the child process group on interrupt; boot reconcile re-claims expired leases (DEPLOY-016). `effect/workflow` only if S5 passes. |
| **SUB-C event bus with consumers (OBS-001)** | `Outbox.emit` in the business transaction + `OutboxConsumer` Layers with cursors/dead letters (9.4); `Probes`/`Readiness` `PubSub` as the health `changes$` source; notifications/push/audit/SLO consumers are Layers registered in `MainLive`; in-process `EventBus` only for same-process fan-out. |
| **SUB-D roster authority + quorum (IDEA-004)** | Mostly mesh-agent/fleet: capability-scoped signed roster ops use the same `Crypto` + `KeyRing` (`kid`, Ed25519) and the claim format; quorum collection is `Effect.all` with `Schedule`/timeouts in the agent. The mesh-agent step (9) is the vehicle; no other dependency on this design except `effect-core`. |

Other roadmap items this design supersedes or re-scopes (for the next roadmap pass): `EFF-006`/`EFF-007` (boot validation and type erasure: gone by construction), `EFF-009` (infra layer: this is the whole design), `EFF-010` (now "Layers", not "R = never classes"), `EFF-021` (resource policy: pool/server/children are scoped layers; Nest providers only inside islands), `EFF-016`/`EFF-017` (claim + `ServiceClients`), `EFF-018`/`EFF-019`/`EFF-020` (Db/tx/abort), `EFF-044`/`EFF-045` (sample becomes template), `EFF-049`/`EFF-092` (facade and island rules), `EFF-115` (mesh-agent), `DEC-EFF-17` (flipped: full Effect, hybrid rejected).

---

## 12. Decisions

### 12.1 Made by this design (beyond the operator's accepted list)

| ID | Decision |
|---|---|
| D-A | Effect owns the process; Nest is a transitional shell and then an application-context-only island (section 3) |
| D-B | End-state HTTP is oRPC `OpenAPIHandler` on `Bun.serve`; `effect/http`/HttpApi rejected |
| D-C | Error mapping is **by kind** (six kinds from `standard-errors.ts`), classes declare their kind via `domainError(tag, kind)`; mapper is exhaustive |
| D-D | `CurrentActor` has no default and appears in `R` of actor-dependent service methods; `Ambient = CurrentActor | Correlation` is the only allowed `R` leak |
| D-E | Per-request context is merged into `effect/context` by an oRPC middleware, not by `Effect.provide` |
| D-F | Tag + `Live` in one file; `Test` layers in `*.test-layer.ts`, importable only from specs; no `Impl` classes |
| D-G | Transactions use a dedicated pooled connection with `BEGIN/COMMIT`, `CurrentTx` as a `Context.Reference`, savepoints for nesting; cancel via `pg_cancel_backend` |
| D-H | Services never migrate at boot; they verify the journal head as a readiness probe |
| D-I | Signed actor claim = Ed25519 JWS, 30 s TTL, per-audience, `kid` rotation, background callers sign their own service claims |
| D-J | Services drop `AuthModule`/Better Auth; Better Auth is BFF-only |
| D-K | Package split into five `effect-*` packages, `effect`/`@orpc/*` as exact-pinned peers |
| D-L | Vitest 5 upgrade is the first prerequisite; Effect-only services use a SWC-free test config |
| D-M | `runMain` hand-rolled; `@effect/platform-bun` not used as server |
| D-N | Probes and readiness replace `HealthRegistry`/`PreflightService` RxJS machinery; supervisors leave `svc-health` |
| D-O | Resilience classes (`read`/`write`/`stream`/`probe`) with the default policies of 9.3; in-house `CircuitBreaker` |
| D-P | Contract meta `authz` mandatory (default-deny at contract build) |
| D-Q | Outbox consumers are polled cursor Layers (at-least-once, idempotent by `eventId`); `effect/workflow` and `PersistedQueue` are not adopted without S5 |

### 12.2 Still open (need an operator answer or a spike result)

| ID | Question | Blocks | Default if unanswered |
|---|---|---|---|
| D-1 | Does S1 pass (`OpenAPIHandler` on `Bun.serve` with SSE and uploads)? If not, stay on thin Nest shell (a) permanently for HTTP only and keep islands | step 1 phase-2 flip | (a) as fallback |
| D-2 | Claim signature scheme final: EdDSA JWS (recommended) vs reusing Better Auth's JWT plugin keys | step 2 | EdDSA JWS via `KeyRing` |
| D-3 | Where `KeyRing` public keys are published to services: BFF `/.well-known/keys` (recommended) vs a shared table read by every service | step 2 | BFF endpoint |
| D-4 | Per-service Postgres roles generated from `TABLE_OWNERSHIP` (the only hard ownership boundary): do it now or after cutover | `Db<Owner>` hardening | after cutover |
| D-5 | S5 outcome: SQL worker vs `effect/workflow` | step 5 | SQL worker |
| D-6 | Outbox/job store per service: Postgres everywhere vs `LocalDb` (sqlite) for runtime-local queue and outbox (today `local_*` tables); no cross-store atomicity either way | steps 4-5, SUB-B/C | Postgres for outbox and job queue, sqlite only for build cache and process table |
| D-7 | OTel enablement date (traces) after correlation-id logging is in | step 0+ | after step 3 |
| D-8 | Vitest 5 compatibility of the SWC toolchain (S6) and whether to keep SWC for the shell phase or force services off decorators faster | step 0 | keep SWC config for shell-phase services |
| D-9 | mesh-agent binary-size budget (S3) | step 9 | +8 MB |
| D-10 | BFF HTTP edge: keep Nest for Better Auth routes and setup SSE until step 8, or move them earlier | step 8 | step 8 |
| D-11 | Idempotency-key contract for write procedures called by workers (header name, storage, TTL) | resilience `write` retry | `Idempotency-Key`, 24 h, table `idempotency_keys` per owner |
| D-12 | Naming: confirm `@deployer/effect-*` scope (repo rename to `@deployer` scope already done per `scripts/migrate-repo-scope.ts`; some code still imports `@repo/*`, cutover section 1) | step 0 | `@deployer/effect-*` |
