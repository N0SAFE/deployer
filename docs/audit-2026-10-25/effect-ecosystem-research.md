# Effect ecosystem research (late 2026) for Deployer v3

> Researched 2026-10-26. Read-only audit: nothing was installed, built or run. Repo facts come from reading `package.json`, `samples/api-sample`, `packages/nest/effect` and the roadmap.
> **Evidence tags:** `[doc]` = official page/registry fetched this session (effect.website, orm.drizzle.team, better-auth.com, orpc.dev, registry.npmjs.org, GitHub release pages, or the docs/source shipped inside the installed `effect@4.0.6` package, called `[local]` when read from `node_modules`). `[search]` = search snippet or third-party page. `[mem]` = prior knowledge, not re-verified. Fetch tool summarizes pages with a small model, so `[doc]` details of long pages are as good as that summary.

---

## 0. TL;DR

1. **Effect 4 is stable** (`effect@4.0.0` declared stable 2026-10-01; latest `4.0.6` on 2026-10-22). Repo already pins `^4.0.6`. Core modules (Effect, Layer, Schema, Stream, Schedule, Config, Redacted, Cron, ManagedRuntime, Tracer, Metric, Logger, TestClock) are `@stability stable` and follow semver. **Everything we would want for a deploy platform beyond the core is still `@stability unstable`**: `workflow`, `cluster`, `persistence` (PersistedQueue), `http`/`http-api`, `rpc`, `sql`, `process` (ChildProcess), `observability` (Otlp), `schema/Model`. Unstable modules may break in minor releases.
2. Adopt Effect for the **service layer** (typed errors, Layers, Scope/interruption, Schedule, Config/Redacted, tracing). Keep **oRPC + Nest as the transport**. Do not move to HttpApi/@effect/rpc (unstable, no ecosystem, would discard the generated web hooks/contracts).
3. For **durable queue/cancel/saga (SUB-B)** the Effect-native answer (`effect/workflow` + `effect/cluster` `SingleRunner` on Postgres) is attractive but unstable and has no production reports I could find. Recommendation: build `deployment_jobs` on Postgres (as DEPLOY-014 already says) **with an Effect worker** (Scope, fiber per job, `Fiber.interrupt` for cancel, `Schedule` retry), and prototype `effect/workflow` side-by-side before committing. `PersistedQueue` (SQL store) is a possible shortcut for the outbox consumer but is at-least-once and unstable.
4. **Version hygiene issues already visible in the repo** (section 3) will bite: `@effect/vitest@4.0.6` needs Vitest 5 (repo has 4.1.x), Drizzle's Effect driver needs drizzle 1.0 rc (repo has 0.45), `@orpc/*` is on 2.0 beta while `@orpc/openapi-client` is pinned 1.14.6, Nest catalog is 11 while the sample runs 12.2.

---

## 1. Recommendations (adopt / adapt / avoid)

| # | Area | Verdict | One-line reason | Roadmap link |
|---|---|---|---|---|
| 1 | Core `effect` 4.x (Effect, Layer, Context.Service, Schema errors, Schedule, Scope) | **Adopt** | Stable, semver, already installed; v3 is feature-frozen | all |
| 2 | oRPC contracts as the API surface, `@orpc/effect` `.effect()` handlers | **Adopt, pin exact** | Works today; but package is `2.0.0-beta.x` (only beta tags exist) | SUB-A, all |
| 3 | `effect/http-api`, `effect/rpc`, `effect/http` server instead of oRPC/Nest | **Avoid** | Unstable modules, loses oRPC contract/openapi/tanstack tooling, rewrite of 315 forwarders and web hooks | ARCH-090 |
| 4 | Effect Schema in **contracts/entities** (replace zod) | **Avoid for now** | zod is the contract lingua franca (`@orpc/zod`, drizzle-zod, forms). Coexist via Standard Schema; use Effect Schema only inside Effect-only code (config, workflow payloads) | - |
| 5 | Effect Schema for **workflow/queue payloads, config, tagged errors** | **Adopt** | Required by workflow/PersistedQueue/Config anyway | DEPLOY-003 |
| 6 | `effect/sql` + `@effect/sql-pg` as the DB layer | **Adapt (wait)** | Unstable; Drizzle stays the schema/query owner; bridge via a thin `Db` service wrapping Drizzle with `Effect.tryPromise` + typed `DbError` | ARCH-047 |
| 7 | Drizzle native Effect driver (`drizzle-orm/effect-postgres`) | **Avoid now / revisit** | Needs drizzle `1.0.0-rc` + `@effect/sql-pg`; repo is on 0.45.x; no transaction docs found | - |
| 8 | Better Auth + Effect | **Adapt** | Official guide only mounts `auth.handler` and calls `auth.api.getSession` in `Effect.tryPromise`; no official HttpApi middleware. Wrap in an `Actor`/`AuthSession` service fed by oRPC middleware | SUB-A, AUTH-* |
| 9 | Keep Nest, bridge with `ManagedRuntime` (current `@deployer/nest-effect`) | **Adopt + extend** | Works; add an "infra layer" (Tracer, Logger, Config, SqlClient/Db) merged into the runtime; do not drop Nest during the cutover | ARCH-* |
| 10 | `effect/workflow` + `effect/cluster` (`SingleRunner`, Postgres) for deploy pipeline | **Prototype, do not commit** | Matches needs (idempotency key, interrupt, `withCompensation`, durable clock) but `unstable`, no production reports found | SUB-B, DEPLOY-014/017/018 |
| 11 | `PersistedQueue` (SQL store) | **Adapt for outbox/notification consumers only** | At-least-once, id dedupe, retry schedule; unstable. Deployment jobs need lease/heartbeat/DLQ semantics we control in SQL | SUB-C, OBS-001/002 |
| 12 | `Cron` / `Schedule` / `ClusterCron` | **Adopt `Schedule`+`Cron` (stable); defer `ClusterCron`** | Stable primitives cover the health-probe scheduler; single-leader semantics need a DB lease anyway | OBS-030 |
| 13 | OTLP via `effect/observability` or `@effect/opentelemetry` | **Adopt `@effect/opentelemetry` + keep `ORPCInstrumentation`** | `OtelTracer.layerGlobal` nests Effect spans under oRPC spans [doc]; Otlp module is unstable | OBS-* |
| 14 | `Config` + `Redacted` | **Adopt** | Stable; fixes secret-in-logs class of bugs | SEC-016, PROJ-020 |
| 15 | `@effect/vitest` + `TestClock` | **Adopt after Vitest 5 upgrade** | Peer is `vitest >=5 <6`; interim: plain Vitest + `Effect.runPromise` + `TestClock` from `effect/testing` | SEC-038 |
| 16 | `@effect/platform-bun` | **Avoid as server; fine as runtime helper** | Server stays Nest/Express. `BunRuntime`/FileSystem OK in agents/CLIs. No known-issues list found | mesh-agent |
| 17 | `effect/process` `ChildProcess` for docker/git/wg | **Adapt** | Typed, scoped (kills child on interrupt), streaming; unstable. Wrap behind our own `CommandRunner` service so API churn is one file | DEPLOY-017 |
| 18 | Typed error to oRPC mapping | **Adopt** | Domain `Data.TaggedError` in services, `catchTag` to `errors.X()` at the controller boundary (as sample does); centralise in one `mapDomainError` helper | SUB-A |
| 19 | Authz via policy service + Actor in Context | **Adopt** | Fits `Context.Service` + oRPC middleware; see section 14 | SEC-001 |
| 20 | `Effect.Model`/`SqlModel`, `effect/eventlog`, `effect/cluster` Entities, `effect/ai` | **Avoid** | Scope creep, unstable | - |

---

## 2. Findings per topic

### 2.1 Core `effect` stability and version

- `effect@4.0.0` stable on 2026-10-01 (GitHub release tags dated 01 Oct 2026; announced at Effect SF meetup). [doc] <https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0>, [doc] <https://effect.website/blog/this-week-in-effect/138>
- npm dist-tags: `latest` 4.0.6, `rc` 4.0.0-rc.118, `beta` 4.0.0-beta.107, `prev` 3.22.4. [doc] <https://registry.npmjs.org/effect>. 4.0.6 published 22 Oct. [doc] GitHub releases page.
- Repo main package of record is now **`Effect-TS/effect`** (the `effect-smol` repo was the beta incubator). Pre-stable `effect-smol` doc mirrors (mintlify) are stale; treat them as `[search]`.
- v4 packaging: `@effect/platform`, `rpc`, `cluster`, `workflow`, `sql`, `cli`, `ai` folded into `effect` as sub-paths (`effect/http`, `effect/sql`, `effect/workflow`...). Separate packages remain for runtimes, SQL drivers, OpenTelemetry, Vitest. All share one version. [doc] <https://www.effect.website/blog/releases/effect/40-beta>. [local] `effect@4.0.6/package.json` exports: `./cluster ./http ./http-api ./rpc ./sql ./workflow ./persistence ./process ./observability ./eventlog ./testing ...`. There is **no `unstable/` path prefix in 4.0.6**; instability is expressed by the `@stability unstable` JSDoc tag. [local]
- Stability policy: APIs tagged `@stability unstable` can break in minors; untagged follow semver. [doc/search] release notes + [local] tags. I read the tags in the installed source: stable = Effect, Schema, Layer, Stream, Schedule, Config, Redacted, Cron, ManagedRuntime, Tracer, Metric, Logger, TestClock; unstable = workflow/*, cluster/*, persistence/*, http/*, http-api/*, rpc/*, sql/*, process/*, observability/Otlp, schema/Model, eventlog/*. [local]
- Requirements: TypeScript >= 5.9 (7 recommended), Vitest 5 for `@effect/vitest`. [doc] 4.0.0 release notes. Repo root has `typescript ^7.0.2`, sample has 5.9.3: fine.
- Services use `Context.Service` (what the repo already does). `Effect.fn("name")` gives named spans. [local ai-docs]
- Known churn since stable: 4.0.6 notes: SQL transactions now `BEGIN IMMEDIATE` (sqlite pkgs), `SqlClient.make` needs a `driver` field, persistence format change for Chat. 4.0.0 breaking list: `Schema.brand` type-only, `partition/separate` order swap, `Queue.State.takers`. [doc]
- v3: feature-frozen, bug fix/security only, maintenance schedule "to be published". `prev` tag 3.22.4. [doc]
- **Implication:** pin `effect` to an exact patch (not `^4.0.6`) for the unstable-module users, upgrade deliberately, and run the workflow/queue tests on each bump.

### 2.2 HttpApi / HttpServer / @effect/rpc vs oRPC contracts

- `effect/http-api` (HttpApi, HttpApiBuilder, OpenApi, Scalar/Swagger, `HttpApiMiddleware`, `HttpApiSecurity`, `HttpApiClient`, `HttpApiTest`) exists and is active (beta.98 notes: auth header decoding fixes, content-type grouping, type perf). All `@stability unstable`. [doc]+[local]
- Status mapping in HttpApi is annotation-based (`httpApiStatus` on error schemas). [local `HttpApiSchema.ts`]
- Better Auth's own Effect guide does **not** cover HttpApi, only `HttpRouter` + `HttpEffect.fromWebHandler`. [doc] <https://better-auth.com/docs/integrations/effect.md>
- **oRPC interop is first-class and already installed:** `@orpc/effect@2.0.0-beta.46` (peer `effect >=4.0.0`) gives `.effect(function*(){})` handlers and middleware (`middlewareGen`), services via the `effect/context` key (`WithEffectContext`), `createEffectClient` (client calls as Effects, interruption aborts the HTTP call), `catchORPCError*` helpers, `EffectSchemaToJsonSchemaConverter` for OpenAPI, fiber interruption on request abort, and OTel nesting through `OtelTracer.layerGlobal`. [doc] <https://orpc.dev/docs/integrations/effect> and [local] `dist/index.d.mts` exports.
- Caveats from that page: do not use `Effect.provide` inside `effect/wrap` (rebuilds layers per call); wrap `acquireRelease` in `Effect.scoped` (handlers have no Scope); in Next use `unstable_rethrow`. [doc]
- Release status: `@orpc/effect` dist-tag `latest` = `2.0.0-beta.45`, `beta` = `2.0.0-beta.46` (only betas exist); `@orpc/server` `latest` = 1.16.1, `beta` = 2.0.0-beta.46. [doc] registry. So the whole oRPC 2 line is pre-release. Repo catalog pins `@orpc/openapi-client` at `1.14.6` next to 2.0 beta packages: verify compatibility. [local package.json]
- `effect-orpc` (third-party bridge): I could not find or fetch it (npm 403, searches empty). **Not verified; not needed** because `@orpc/effect` is first-party. [search: not found]
- **Verdict:** keep oRPC contracts. Do not build a second contract system. Revisit HttpApi only if oRPC 2 stalls.

### 2.3 Effect Schema vs zod

- Effect Schema (v4 rewrite) exports Standard Schema V1 via `Schema.toStandardSchemaV1` and an experimental Standard JSON Schema. [local `Schema.ts`] zod 4 is Standard Schema natively [mem].
- oRPC OpenAPI falls back to Standard JSON Schema when no dedicated converter exists; dedicated converters: Zod, Valibot, ArkType. Effect has `EffectSchemaToJsonSchemaConverter` in `@orpc/effect`. [doc] <https://orpc.dev/docs/openapi/openapi-specification> + [doc] effect integration page.
- `@orpc/effect` extension lets `.input()/.output()` take Effect Schema directly. [doc]
- Sample (`samples/api-sample`) uses **zod contracts + Effect handlers**; no Effect Schema in contracts. [local] This is the coexistence pattern in practice.
- **Migrating `packages/contracts` entities to Effect Schema:** cost = every `drizzle-zod`, `@orpc/zod` JSON-schema, web form and codegen consumer changes; benefit = single schema for Config/workflow/DB. Not worth it during the cutover. Rule: **zod at the edge (contracts), Effect Schema inside (workflow payloads, queue messages, Config, domain error `Schema.TaggedError` if serialised across processes).** Add a tiny `fromZod`-style decode at the boundary (zod parse in the controller, pass plain types in).

### 2.4 Database: effect/sql, sql-drizzle, Drizzle

- `effect/sql` (`SqlClient`, `SqlSchema`, `Migrator`, `SqlModel`) is in core, `@stability unstable`; drivers are separate (`@effect/sql-pg` 4.0.6, peer `effect ^4.0.6`, uses a built-in PG client per release notes). [local]+[doc registry]+[doc release notes]. Docs example is SQLite; shows `Model.Class`, repositories, `Effect.orDie` on SqlError. [local ai-docs]
- **`@effect/sql-drizzle` for v4:** not found in the registry results/searches. Instead Drizzle ships **native** `drizzle-orm/effect-postgres` (`PgDrizzle.make...`) with `@effect/sql-pg`, but the guide installs **`drizzle-orm@rc`** (1.0.0-rc.5); `latest` is still 0.45.4. No transaction/migration/error-type details on that page. [doc] <https://orm.drizzle.team/docs/connect-effect-postgres>, dist-tags [doc]. Repo has `drizzle-orm ^0.45.1`, `drizzle-kit ^0.31.6`.
- Transactions in Effect SQL: `sql.withTransaction(effect)`; 4.0.6 sqlite drivers moved to `BEGIN IMMEDIATE`. [doc release notes]; Postgres behaviour not verified.
- **Recommendation:** keep Drizzle 0.45 (schema, drizzle-kit migrations, drizzle-zod). Introduce a single `Db` Effect service in `@deployer/nest-database-core` exposing `use(fn: (db) => Promise<A>): Effect<A, DbError>` and `transaction(...)`. Map unique-violation/not-found to typed errors in repositories (not in services). Revisit native Drizzle-Effect when drizzle 1.0 is `latest`. Avoid running two migration systems (`SqlMigrator` vs drizzle-kit).
- This matches AGENTS rule "Drizzle queries only in repositories" and keeps SQL/Effect churn off the 100+ repositories.

### 2.5 Better Auth integration

- Official (Effect 4): mount with `HttpEffect.fromWebHandler(auth.handler)` on an `HttpRouter`; check sessions with `auth.api.getSession({headers})` inside `Effect.tryPromise`; CORS via `HttpMiddleware.cors` + `trustedOrigins`. No HttpApi middleware shown. [doc]
- Third-party `artimath/better-auth-effect` (Kysely adapter + middleware, README uses HttpLayerRouter): exists, maturity unknown. [search]
- Our pattern (sample): Nest owns Better Auth (`@thallesp/nestjs-better-auth`), an oRPC middleware (`requireSession`) puts `auth` into context. [local] That is already the right seam.
- **Recommendation:** model `Actor` as a Context service (section 14). The oRPC middleware does `Effect.tryPromise(getSession)` once per request, maps failures to `UNAUTHORIZED`, and provides `Actor` into `effect/context`. No Effect-specific Better Auth library needed. Version note: catalog pins `better-auth 1.7.7`, sample runs `1.7.13` (latest `1.7.13`, beta `1.8.0-beta.2`). [local]+[doc registry]

### 2.6 NestJS coexistence

- `ManagedRuntime` is the documented bridge to non-Effect frameworks (Express, Hono, ...); must be disposed on shutdown. [doc/search] mintlify mirror + [local ai-docs `04_integration`]. No maintained "nestjs-effect" package found. [search: not found]
- Current repo bridge (`@deployer/nest-effect`): `DiscoveryService` collects Nest providers whose **token is a `Context.Service` key** into `Layer.succeed`s, builds one lazy `ManagedRuntime`, disposes on shutdown. [local] Strengths: zero wiring. Limits: (a) Nest constructs everything, so **no Layer-managed resources** (acquireRelease pools, background fibers, Config, tracer); (b) the service union type is a hand-maintained `EffectServices` global or `AppServices` union; (c) services are `Layer.succeed`, so Effect-side dependencies between services are not checked at build time, they are resolved by Nest and then erased.
- **Recommended extension:** allow `EffectRuntimeModule.forRoot({ layer })` where `layer` is an infra layer (tracer/logger/Config/Db) merged **under** the discovered service layer; give a `OnApplicationBootstrap` hook that builds it eagerly (fail fast on bad Config); expose `runFork` for background fibers tied to the runtime scope. Keep Nest controllers; they only hold oRPC `.effect` handlers.
- Dropping Nest: not recommended during the monolith cutover (ARCH-001..). Nest 12.2 is `latest`; catalog is still 11.1.27 while the sample uses 12.2: decide the Nest major once. [doc registry]+[local]

### 2.7 Durable workflows, queues, cron, cluster

What exists in 4.0.6 [local source]:
- `effect/workflow`: `Workflow.make` (tag, payload/success/error schemas, idempotency key -> deterministic execution id), `execute` (discard/detached), `poll`, `interrupt`, `resume`, `withCompensation` (top-level steps only), `suspend`, `SuspendOnFailure`, `CaptureDefects`; `Activity.make` + `Activity.retry`/`CurrentAttempt`/`idempotencyKey`/`raceAll`; `DurableClock.sleep`; `DurableDeferred`; `DurableQueue`; engines `WorkflowEngine.layerMemory` and `ClusterWorkflowEngine.layer`. All `unstable`. [doc] <https://effect.website/docs/v4/api/effect/unstable/workflow/Workflow> (summary) confirms.
- `effect/cluster`: sharding, entities, `SingleRunner.layer` ("single-process... SQL-backed message storage... in-memory or SQL runner storage"; requires a `SqlClient` and now `Crypto`), `SqlMessageStorage`, `SqlRunnerStorage` (advisory locks on PG), `ClusterCron` (singleton + persisted run messages, no overlap). All `unstable`. [local]+[search] release notes beta.102/0.60.2 mention PG lock/dedupe fixes.
- `effect/persistence/PersistedQueue`: named queues with schema-encoded values, id dedupe, retry schedule, max attempts then failed; stores: memory, Redis, **SQL**; **at-least-once, handlers must be idempotent**; `unstable`. [local] The `4.0.0-beta.98` notes list fixes to SQL lock refresh and failure counting, i.e. it is still being hardened. [doc]
- Production evidence: I found **no** public production experience reports for workflow/cluster on Postgres, only release-note bug fixes. [search] Treat as early.
- Cancel semantics: `Workflow.interrupt(executionId)`; finalizers via `Workflow.addFinalizer`/`provideScope` run on interrupt, but "finalizers are skipped when a cluster owner abandons a run for replay". [doc] -> compensation is not a guaranteed saga-rollback on crash; design activities idempotently regardless.

Fit to Deployer:
- **DEPLOY-014/015/016/017/018 (durable queue, lease reaper, boot reconcile, real cancel):** the roadmap's own plan (`deployment_jobs`, `FOR UPDATE SKIP LOCKED`, lease, heartbeat) is robust and independent of unstable APIs. Do it in SQL; implement the **worker as an Effect program**: one `Scope` + `Fiber` per claimed job, `Fiber.interrupt` on cancel (propagates to `ChildProcess`/docker calls and runs finalizers), `Schedule.exponential` for retries, heartbeat via `Effect.repeat(Schedule.spaced)` forked in the job scope. Cancel = set `cancel_requested`, worker interrupts fiber, writes terminal state in a `Effect.onExit`. This gives "structured concurrency cancel" without adopting workflow.
- **Prototype** `effect/workflow` on `SingleRunner` + Postgres to compare: workflow = deploy pipeline (resolve plan, build, push, deploy, health gate, cutover), activities = each step with `Activity.retry`, compensation for rollback. If stable enough after the prototype, it removes our own lease/heartbeat code; if not, no sunk cost.
- **Cascade deploy (DEPLOY-080)** and **node-removal saga (CLUSTER-018)**: sagas map well to `withCompensation`, but do them after the prototype.
- **Outbox (SUB-C, OBS-001/002):** existing code is a Postgres outbox + local dispatcher. Do not adopt Redis (DEC-ARCH-3 default drop). A consumer-cursor table + `Stream`-based poller (`Stream.repeat`/`Schedule.spaced`) is enough; `PersistedQueue` with the SQL store is an option for the *consumer side* (notifications) because it gives dedupe + retries, but its payload tables/migrations would be created by Effect's own migrator (extra migration system). Prefer own tables unless prototype shows clear savings.
- **Scheduler/cron (OBS-030 probes, cleanup FEAT-*, retention):** `Schedule.cron`/`Cron` and `Effect.repeat` are stable. For multi-replica leader-only execution use a Postgres advisory lock `Effect` wrapper (lease). `ClusterCron` only if we adopt cluster.
- **Webhooks (DEPLOY-075..):** HMAC verify + idempotency key insert (unique) then enqueue job; Effect adds nothing special except `Redacted` for secrets and `Effect.timingSafeEqual`-style helpers [mem; not verified].

### 2.8 Observability

- `effect/observability` (`OtlpTracer`, `OtlpLogger`, `OtlpMetrics`, `PrometheusMetrics`, `OtlpSerialization`) built in, unstable; requires an `HttpClient` layer (`FetchHttpClient`). [local ai-docs `08_observability/20_otlp-tracing.ts`]
- `@effect/opentelemetry@4.0.6`: `NodeSdk.layer`, `OtelTracer.layerGlobal` (Effect tracer backed by the global OTel provider). Peers: `@opentelemetry/api >=1.9 <2`, `sdk-trace-base/node/resources/sdk-metrics >=2 <3`, `sdk-logs`/`api-logs >=0.203 <0.300` (optional), `semantic-conventions >=1.33`. [doc registry] Repo sample uses `@opentelemetry/sdk-node ^0.300.0` and `@orpc/opentelemetry`: **logs peers `<0.300` would conflict if you enable OTel logs through Effect**; traces-only is fine. Not verified at install level.
- oRPC page: add `OtelTracer.layerGlobal` to the layer behind `effect/context` so Effect spans nest under oRPC spans. [doc]
- Correlation ids: not found as a built-in; use `Effect.annotateLogs`/`annotateSpans` with request id and `HttpTraceContext` (exists in `effect/http`) [local file listing]; the practical approach is the OTel trace id from the oRPC span + a `RequestId` annotation in the oRPC `effect/wrap`. [mem/inference]
- **Recommendation:** adopt `Effect.fn("Service.method")` everywhere (named spans for free), traces via `@effect/opentelemetry` + existing `ORPCInstrumentation`; metrics via `Metric` -> OTel or Prometheus later. Deployment log streaming (SSE) is separate (section 2.11).

### 2.9 Config and secrets

- `Config`, `ConfigProvider`, `Redacted` are stable [local]. `PgClient.layer` takes `Redacted` URLs [doc drizzle page]. `Redacted` hides values from logs/`toString`/JSON.
- **Recommendation:** replace ad-hoc env reads (`@repo/env`, `process.env`) in Effect services with `Config` read at runtime build (fail fast with all missing keys listed), `Config.redacted` for tokens/keys; unwrap only at the point of use (docker auth, GitHub token). Directly supports SEC-016/PROJ-020 (key derivation / env-var encryption) and "no secrets in reads". Unwrap-at-edge lint rule is worth adding.

### 2.10 Testing

- `@effect/vitest@4.0.6`: `it.effect`, `it.live`, `layer(...)`, `it.effect.prop`; works with `TestClock` from `effect/testing` (stable). Peer **`vitest >=5.0.0 <6.0.0`**; repo catalog has vitest `^4.1.9` (latest 5.0.5, tag `V4` = 4.1.12). [doc registry]+[local ai-docs `09_testing`]. -> need the Vitest 5 upgrade across the monorepo or skip `@effect/vitest`.
- Without `@effect/vitest`: plain Vitest tests running `Effect.runPromise(effect.pipe(Effect.provide(layer)))` works (the sample does `Layer.succeed(Repo, fake)`). [local sample test]
- `TestClock.adjust` makes retry/timeout/lease tests deterministic: use it for the queue worker, health probe scheduler, and backoff. For layer tests, `Layer.succeed`/`Layer.effect` fakes, `ManagedRuntime` in `packages/nest/effect/testing`. [local]
- Cluster ships `TestRunner`, HttpApi ships `HttpApiTest`, RPC ships `RpcTest`. [local file listing]
- The repo's controller spec convention (mock `implement`) is incompatible with `.effect()` handlers; sample + `testing.ts` shows `callProcedure(controller.x(), {}, effectContext(ctx))`. Update AGENTS test conventions accordingly.

### 2.11 Bun compatibility, streaming/SSE

- `@effect/platform-bun@4.0.6` (peer `effect ^4.0.6`, dep `@effect/platform-node-shared`): `BunHttpServer` over `Bun.serve`, streaming bodies, multipart, `Bun.file` responses with ranges, WebSocket upgrade. [doc/search] effect.website API pages. No known-issues list found. [search: none]
- `drizzle` has Bun-specific patches in dist-tags (`bun-timestampstring-patch`), and `@effect/sql-sqlite-bun` exists. [doc registry] - unrelated to our PG path but shows Bun is a tested target.
- Our server runs Nest/Express under Bun (sample `bun src/main.ts`); Effect core is runtime-agnostic. SSE/streaming stay with oRPC `eventIterator` + `@orpc/server` (sample has `stream.contract.ts`, `log-stream.service.ts`, and an rxjs bridge). Effect `Stream` -> async iterator: `Stream.toAsyncIterable`-style helper [mem; verify]. The sample currently bridges RxJS; migrate to `Stream`/`PubSub` as services move, one stream at a time (ARCH-067 multi-replica fan-out still needs LISTEN/NOTIFY).
- **Not verified:** actual Bun runtime behaviour of workflow/cluster/`ChildProcess` spawner (platform-bun provides the spawner layer; I did not confirm `ChildProcessSpawner` is implemented for Bun).

### 2.12 Docker / swarm / process execution

- `effect/process`: `ChildProcess.make`, `ChildProcessSpawner` (`string`, `lines`, `spawn` with `handle.all` stream and `exitCode`), pipelines (`pipeTo`), env/`extendEnv`. Unstable. [local ai-docs `60_child-process`] Scoped: processes are tied to the Scope, interruption kills them [inference from `spawn` returning a scoped handle; not verified].
- Repo already has `packages/nest/docker`, `swarm`; recent commit "use Bun builtins for fs and process execution". Dockerode/Docker socket calls stay as is; wrap each behind a service with typed errors (`DockerError`, `BuildFailed{exitCode, tail}`).
- **Recommendation:** for `docker build`, `docker buildx`, `git clone` in the pipeline, run via one `CommandRunner` service (Effect `ChildProcess` or Bun spawn wrapped with `Effect.acquireRelease` that kills on interrupt). That is what makes DEPLOY-017 (real cancel of in-flight builds) true. Streaming `handle.all` -> line `Stream` -> log sink (DB + SSE).

### 2.13 Typed error to HTTP/oRPC mapping

- Sample pattern: domain `Data.TaggedError` in services, `Effect.catchTag("X", e => Effect.fail(errors.CONFLICT({data})))` in controller, contract-declared `.errors`. [local] `@orpc/effect` has `catchORPCError*` for the inverse (client side).
- Failures not declared (defects) become 500; `Effect.orDie` for infrastructure errors (DB down) as the docs' own SQL example does. [local ai-docs 40_sql]
- Recommendation: a shared `mapDomainErrors(errors)` helper in `@deployer/nest-effect` with a table `{ NotFound -> NOT_FOUND, Conflict -> CONFLICT, Forbidden -> FORBIDDEN, ... }` so controllers do `.pipe(toOrpc(errors))`. Keep domain errors transport-free (AGENTS "typed NestJS exceptions" rule gets replaced by tagged errors in migrated modules: update AGENTS to avoid contradicting guidance).

### 2.14 Authorization patterns

- Idiomatic Effect: `Actor` as a `Context.Service` (or `Context.Reference` w/ default anonymous) provided per request by oRPC middleware; a `Policy`/`Authz` service with `check(actor, action, resource): Effect<void, Forbidden>`; HttpApi has `HttpApiMiddleware` + `HttpApiSecurity` for the same idea (not used by us). [local file listing] FiberRef-style per-fiber state in v4 is `Context.Reference`/`References` [local file `References.ts`; usage not verified].
- **SUB-A fit (SEC-001):** each procedure carries `meta {resource, action, risk}`; one oRPC middleware does `Authz.check` before the handler, default-deny when meta missing, shadow mode logs the would-be decision. Because the check is an Effect it can read project membership through repositories in the same trace. Generated 403 matrix (SEC-038) runs against contracts, independent of Effect.
- Services that run in the background (supervisors, schedulers, webhooks; ARCH-056 system actor) get `Actor.system("scheduler")` provided with `Effect.provideService`, so no hidden global.
- Do **not** put the authz check inside repositories; keep in service/middleware (AGENTS layering).

### 2.15 Hiring, learning curve, maturity

- Positives: stable v4, single package, Ziverge announced as first "Effect Adoption Partner", weekly office hours, conferences (Effect Days Dec 9-11), ecosystem projects (Neon `@neondatabase/effect`, `@yielded/auth`, scaffolding CLIs). [doc] This Week in Effect 138.
- Risks: unstable modules we care about; docs lag (mirror sites show beta-era APIs; API names changed between v3/v4, e.g. `Context.Service`, `Effect.catch*` renames); oRPC-Effect still beta; few public postmortems of Effect workflow/cluster in production. LLM assistants often emit v3 syntax; the package ships `AGENTS.md`/`CLAUDE.md` and `ai-docs/` inside `node_modules/effect` specifically to counter that. [local] -> put a pointer to it in our `AGENTS.md`.
- I could not find hiring-market or survey data (search returned unrelated results). [not verified]
- Mitigation: Effect confined to service/worker layer with plain-TS boundaries (oRPC contracts, Drizzle repos, Nest modules stay familiar); written conventions (sample README + AGENTS); one "Effect champion" review per PR for the first modules.

### 2.16 Other self-hosted infra products on Effect

- No open-source deployment platform confirmed to be built on Effect. Search returned Openship, peon, ZaneOps (stack not confirmed as Effect). [search] Known Effect-built infra from memory (opencode, Alchemy IaC): opencode appears in Drizzle/Effect search results (`effect-sqlite-package.md` from the opencode repo) [search]; Alchemy v2 docs integrate Drizzle/Effect [search]. Others (Railway Effect template is a deploy template for the Effect *devtools/observability* image, not an Effect-built PaaS) [search].
- Conclusion: we would be among the early users for deploy-platform-shaped workloads; no reference architecture to copy. Hence "prototype first".

---

## 3. Version matrix

| Package | Installed in repo | Latest (registry, 2026-10) | Notes |
|---|---|---|---|
| `effect` | `^4.0.6` (sample resolved 4.0.6; catalog `effect`) | 4.0.6 (`rc` 4.0.0-rc.118, `beta` 4.0.0-beta.107) | Stable. Pin exact. |
| `@orpc/server/client/contract/nest/openapi/effect` | `2.0.0-beta.46` | `@orpc/server` latest 1.16.1, beta 2.0.0-beta.46; `@orpc/effect` latest 2.0.0-beta.45 / beta .46 | Pre-release line. `@orpc/openapi-client` pinned `1.14.6` in catalog: mismatch risk. |
| `@effect/platform-bun` | not installed | 4.0.6 | Server not needed |
| `@effect/sql-pg` | not installed | 4.0.6 | Only if Drizzle-Effect/`effect/sql` adopted |
| `@effect/opentelemetry` | not installed | 4.0.6 (OTel peers: api >=1.9<2, sdk-* >=2<3, logs <0.300 optional) | Repo has `@opentelemetry/sdk-node ^0.300.0` |
| `@effect/vitest` | not installed | 4.0.6 (peer `vitest >=5 <6`) | **Repo Vitest `^4.1.9`** (latest 5.0.5) |
| `vitest` | `^4.1.9` | 5.0.5 (V4 tag 4.1.12) | Upgrade needed for `@effect/vitest` |
| `drizzle-orm` | `^0.45.1` | latest 0.45.4; `rc` 1.0.0-rc.5; `beta` 1.0.0-beta.22 | Native Effect driver is 1.0 only |
| `drizzle-kit` | `^0.31.6` | not checked | |
| `better-auth` | catalog `1.7.7`, sample `^1.7.13` | 1.7.13 (beta 1.8.0-beta.2) | Align catalog |
| `@nestjs/core` | catalog `^11.1.27`, sample `^12.2.0` | 12.2.0 | Decide major once |
| `typescript` | root `^7.0.2`, sample 5.9.3 | Effect needs >= 5.9 | OK |
| `zod` | `^4.0.0` (sample 4.6.7) | not checked | Standard Schema native [mem] |

Evidence: [local] package.json files + [doc] registry endpoints. Version checks via registry were summarized by a fetch tool; re-run `npm view` before acting.

---

## 4. Risks

1. **Unstable-module churn** (workflow, cluster, persistence, process, sql, http-api): patch releases already change behaviour (SQL tx mode, persistence formats, `SqlClient.make` signature). Mitigate with exact pins, one wrapper file per unstable module, upgrade PRs with tests (TestClock-driven).
2. **oRPC 2 beta + effect extension**: both unstable; pin, track changelog; keep handler bodies as plain services so the transport adapter can change.
3. **Two DI worlds**: Nest instances erased into `Layer.succeed`; no compile-time dependency check between Effect services; services depending on infra layers must be provided at the runtime root. Fix with the infra-layer extension (2.6).
4. **Test-tool mismatch**: `@effect/vitest` needs Vitest 5; AGENTS controller-test convention (mocking `implement`) breaks with `.effect`.
5. **Docs drift/LLM drift**: v3 syntax in training data; community mirrors outdated. Use the in-package `ai-docs`.
6. **Bun**: unknowns around spawner/cluster on Bun; server stays on Express adapter.
7. **At-least-once everywhere** (PersistedQueue, cluster messages): every activity/consumer must be idempotent; deployment steps (docker service update) need idempotency keys.
8. **Scope creep**: Effect makes it tempting to rewrite repositories, schemas and contracts; the roadmap has 136 P0 items that are mostly security/authz, which Effect does not shorten.
9. **Learning curve / bus factor**: single champion risk; conventions must be written down.
10. **Observability peer ranges** (`sdk-logs <0.300`) vs repo's `sdk-node 0.300`.

---

## 5. Mapping to roadmap needs

| Need | Effect fit | Do |
|---|---|---|
| SUB-A authz (SEC-001/033/038, AUTH-025) | High (Context `Actor`, `Authz` service, middleware) | Adopt; implement as oRPC middleware + `Authz` Layer; default-deny, shadow mode |
| SUB-B manifest + durable queue (DEPLOY-003/014/015/016) | Medium (workflow possible but unstable) | SQL tables + Effect worker now; prototype `effect/workflow` in parallel; manifest = zod/Effect Schema JSON stored on the row |
| Deploy cancel (DEPLOY-017/018) | High (fiber interrupt, scoped child processes) | Adopt: one fiber per job, `Fiber.interrupt`, `onExit` writes terminal state, CommandRunner kills children |
| Retries / sagas (DEPLOY-004/080, CLUSTER-018) | High for retry (`Schedule`), medium for saga (`withCompensation`) | `Schedule` now; saga after prototype |
| SUB-C event bus/outbox (OBS-001/002/003, ARCH-062) | Medium | Keep PG outbox; Effect `Stream` poller + per-consumer cursors; consider `PersistedQueue` for notification delivery only |
| Health probes/scheduler (OBS-030) | High (`Schedule.spaced`/`Cron`, `Effect.forEach` concurrency, timeouts) | Adopt; leader lease via advisory lock |
| Webhooks (DEPLOY-075/076) | Medium | `Redacted` secret, raw-body HMAC, idempotency row, enqueue; mostly Nest/Express concerns |
| Audit log (OBS-071) | Medium | oRPC middleware writes via `Effect.fn`, annotated with actor/trace id |
| Secrets (PROJ-020/021, SEC-016) | High (`Config.redacted`) | Adopt |
| Inter-service auth / system actor (ARCH-056) | Medium | `Actor.system` provided per background fiber |
| Multi-replica streams (ARCH-067) | Low | LISTEN/NOTIFY; Effect `PubSub` only in-process |
| Monolith cutover (ARCH-*) | Neutral | Keep Nest; migrate module by module to `.effect` |

---

## 6. What to prototype first (ordered, each 0.5-3 days)

1. **Infra-layer runtime** (`@deployer/nest-effect`): `forRoot({ layer })` with `Config` + `OtelTracer.layerGlobal` + `Db` service; prove a `.effect` handler produces nested spans and fails fast on missing Config. (Also a test for `Redacted` not leaking in logs.)
2. **Actor + Authz middleware** on 3 procedures (one read, one mutation, one admin): shadow-mode log, 403 matrix generated from contract metadata. This is SUB-A's skeleton and validates the `effect/context` plumbing with Better Auth `getSession`.
3. **Job worker with interruption** (DEPLOY-014/017 core): `deployment_jobs` claim/lease/heartbeat in Drizzle, an Effect worker that runs a fake 30s "build" through a `CommandRunner`, cancel kills the child within 1s, crash-restart test reclaims via lease. Use `TestClock` for lease expiry tests.
4. **Workflow spike (time-boxed)**: the same pipeline expressed with `effect/workflow` + `SingleRunner.layer` on the project's Postgres; measure: migrations it creates, behaviour on kill -9 mid-activity, interrupt, compensation, resume; compare code size to #3. Decision gate: adopt only if it passes kill/interrupt tests and `bun check --no-script` types stay fast.
5. **Outbox consumer with cursor** (SUB-C) using `Stream` poller; optionally compare with `PersistedQueue` SQL store.
6. **Vitest 5 upgrade branch** to unlock `@effect/vitest`; update the AGENTS testing convention for `.effect()` controllers (use `callProcedure` + `effectContext`).
7. Compatibility checks: oRPC beta + `openapi-client 1.14.6`, `@effect/opentelemetry` with `sdk-node 0.300`.

---

## 7. Could not verify

- Any production report of `effect/workflow`, `effect/cluster`, `PersistedQueue` on Postgres (none found).
- `@effect/sql-drizzle` for v4 (not found; only Drizzle's native effect-postgres, which needs drizzle 1.0 rc). Transaction semantics for the Drizzle-Effect path.
- `effect-orpc` third-party package (npm 403; searches empty).
- `@effect/platform-bun` known issues; `ChildProcessSpawner` behaviour on Bun; kill-on-interrupt semantics of `spawn` (inferred, not tested).
- Exact `Stream` -> async-iterable helper name for oRPC event iterators.
- Hiring/community statistics; any open-source deployment platform built on Effect.
- Whether `@effect/opentelemetry` `NodeSdk.layer` already installs the global tracer (docs ambiguous).
- Effect 4 migration guide details on error classes (`Schema.TaggedError` vs `Data.TaggedError`): both appear in installed docs/sample; the official MIGRATION.md fetch returned 404 from the path I tried.
- Postgres-specific `BEGIN IMMEDIATE`-style transaction notes (release notes cited only sqlite packages).
- Everything marked `[mem]`.
