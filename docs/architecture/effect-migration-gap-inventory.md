# Effect architecture — complete gap inventory

Date: 2026-11-04. Read-only audit. Nothing was built, linted, tested or modified.
Supersedes the "Remaining" table of `effect-migration-roadmap.md` where they disagree (disagreements are listed in §9).

Scope: every app under `apps/`, every package under `packages/`, `tooling/`, `samples/`, plus the cross-cutting gates.

---

## 0. The rubric — what "supports the new architecture" means

Twelve checks, derived from `docs/architecture/effect-migration-roadmap.md`,
`docs/architecture/effect-host.md`, `docs/audit-2026-10-25/effect-target-architecture.md`,
`apps/api/AGENTS.md` and `apps/api/shared/AGENTS.md`.

| # | Check | Verdict key |
|---|---|---|
| C1 | Domain state/rules live in an Effect `Context.Service` tag, not an `@Injectable` class | `TAG` |
| C2 | No `EffectRuntime` injected into domain code; boundaries take `EffectHost` | `HOST` |
| C3 | Endpoints use `procedure(contract).effect(body)`; no legacy `implement().handler()`, no `.use(Module[EffectContextOf])` | `PROC` |
| C4 | Service root calls `assertRequirementsMet` and resolves per-controller `contextFor` | `REQ` |
| C5 | Every failure is typed (`domainError` / `AppError` subclass); no `throw new Error` in services/repositories | `ERR` |
| C6 | `Effect.tryPromise` carries an `AbortSignal` (`fromAbortable`); resources are `acquireRelease`d | `INT` |
| C7 | No module-level/static singletons, no `EffectServices` global augmentation, no ALS | `GLOB` |
| C8 | Feature-first module shape (`<domain>/{controllers,services,repositories,errors}`), not layer-first | `SHAPE` |
| C9 | Logger, never `console.*` | `LOG` |
| C10 | Zero type assertions (`as unknown as`, `as any`, `@ts-ignore`) in non-test code | `TYPE` |
| C11 | Every contract procedure declares `.errors(...)` | `CONTR` |
| C12 | Every Effect package ships a `Test`/fake layer | `TEST` |

---

## 1. Executive summary

| Shard | C1 TAG | C2 HOST | C3 PROC | C4 REQ | C5 ERR | C6 INT | C7 GLOB | C8 SHAPE | C9 LOG | C10 TYPE | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `apps/api/services/health` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ 3 | ✅ | **done** |
| `apps/api/services/node-agent` | ✅ | ✅ | ✅ | ✅ | ⚠️ 3 | ⚠️ 6 | ✅ | ⚠️ 1 flat | ⚠️ 18 | ⚠️ 3 | near-done |
| `apps/api/services/project` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ 1 | ✅ | ✅ | ⚠️ 2 | ⚠️ 2 | near-done |
| `apps/api/services/identity` | ⚠️ 2 | ✅ | ✅ | ✅ | ⚠️ 10 | ⚠️ 7 | ✅ | ⚠️ 8 flat | ⚠️ 2 | ✅ | near-done |
| `apps/api/services/fleet` | ⚠️ 2 | ✅ | ❌ 12 | ❌ flat ctx | ⚠️ 1 | ⚠️ 2 | ✅ | ⚠️ | ⚠️ 1 | ✅ | partial |
| `apps/api/services/runtime` | ❌ 45 | ✅ | ❌ 60+17 | ✅ | ⚠️ 2 | ⚠️ 13 | ✅ | ❌ layer-first | ⚠️ 2 | ⚠️ 6 | **largest gap** |
| `apps/api/shared` | ❌ 81 | ✅ (0 inject) | ⚠️ 8 | n/a | ⚠️ 29 | ⚠️ 14 | ⚠️ 11 | ⚠️ 25 pure-Nest modules | ⚠️ 3 | ⚠️ 21 | **largest gap** |
| `apps/api/bff` | ⚠️ 6 | ✅ | ❌ 343 `.handler` | ❌ none | ⚠️ 4 | ⚠️ 1 | ✅ | ⚠️ | ⚠️ 4 | ✅ | **0 `.effect()`** |
| `apps/setup` | ❌ 13 | ⚠️ 20 raw runs | ❌ 13 `.handler` | ✅ | ⚠️ 10 | ⚠️ | ✅ | ⚠️ 5 pure-Nest modules | ⚠️ 4 | ✅ | partial |
| `apps/web` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ✅ | ✅ (2 raw fetch) |
| `apps/doc` | — | — | — | — | — | — | — | — | — | — | ❌ 15 pages teach the old pattern |
| `packages/**` | 17 EN / 6 EN⁻ / 3 NC | — | — | — | — | — | — | — | — | — | 6 partial, 3 Nest-coupled, 12 without Test layer |
| gates / CI | — | — | — | — | — | — | — | — | — | — | **7 of 12 checks have no gate** |

Totals: **221 files with `@Injectable()`** (excluding specs and `dist`), **452 legacy `.handler()` sites**,
**0 `.effect()` in the BFF**, **75 bare `Effect.tryPromise`**, **35 contracts missing `.errors()`**.

Update (2026-11-04): the request is now a required Effect service (`HttpRequest`, `http/Request`), supplied per call by
`createOrpcModule` and `serve()`; `Scope.REQUEST` is not used anywhere. The auth conformance pass removed ~5.4k lines of
second authorization surface, and C1/C3/C5/C9/C10 are gated per app (see §12).

---

## 2. `apps/api/bff` — the single biggest violation

### 2.1 The delegation module: 284 verbatim pass-through handlers

`apps/api/bff/src/modules/delegation/generated/**` — 21 files. Every method is literally
`implement(<contract>.<op>).handler(({ input }) => this.client.<op>(input))`.
The target architecture calls this a design smell by name: "The BFF is not a proxy."

| File | `.handler(` |
|---|---:|
| `deployment.delegation.ts` | 51 |
| `docker.delegation.ts` | 35 |
| `analytics.delegation.ts` | 28 |
| `project.delegation.ts` | 16 |
| `providers.delegation.ts` | 16 |
| `cluster.delegation.ts` | 16 |
| `mesh.delegation.ts` | 15 |
| `reachability.delegation.ts` | 15 |
| `service.delegation.ts` | 15 |
| `user.delegation.ts` | 15 |
| `domain.delegation.ts` | 13 |
| `nodes.delegation.ts` | 11 |
| `platform.delegation.ts` | 10 |
| `providerSchema.delegation.ts` | 8 |
| `push.delegation.ts` | 6 |
| `approval.delegation.ts` | 4 |
| `role.delegation.ts` | 4 |
| `health.delegation.ts` | 2 |
| `audit.delegation.ts` | 2 |
| `stepUp.delegation.ts` | 1 |
| `servicePreviewTopology.delegation.ts` | 1 |
| **total** | **284** |

Mounted by `modules/delegation/delegation.module.ts:44-66`; exposed through
`orpc/service-surface.ts` (315-procedure router). These files are `*.delegation.ts`, so the
`controllersUseProcedure` ESLint rule (which only covers `**/*.controller.ts`) does not see them.

### 2.2 Endpoints that *do* compose, still on the legacy builder

| File | `.handler(` | Should be |
|---|---:|---|
| `domains/setup/controllers/setup.controller.ts` | 10 (`:58,65,78,117,136,149,161,212,226,233`) | `.effect()` + tags |
| `domains/test/controllers/test.controller.ts` | 8 (`:202,218,232,251,267,290,318,338`) | `.effect()` |
| `modules/dashboard/controllers/orchestration.controller.ts` | 7 (`:60,147,173,207,239,277,302`) | `.effect()` |
| `modules/console/controllers/console-control.controller.ts` | 6 (`:41,51,61,71,81,91`) | `.effect()` |

### 2.3 `@Injectable()` classes that must become tags (6)

| Path:line | Class | Why |
|---|---|---|
| `src/modules/shared/services/overview-composer.service.ts:35` | `OverviewComposerService` | N+1 fan-out + partial-failure policy across 4 services. Pure domain. |
| `src/modules/shared/services/screen-read.service.ts:57` | `ScreenReadService` | Owns every service-read argument shape. A rule, not a wire. |
| `src/modules/health/services/platform-health.service.ts:24` | `PlatformHealthService` | Aggregate verdict state machine; also does raw `fetch()` at `:55`. |
| `src/domains/setup/services/post-setup-destination.service.ts:36` | `PostSetupDestinationService` | `dashboard` vs `api-console` precedence rule. |
| `src/domains/setup/services/post-setup-verification.service.ts:78` | `PostSetupVerificationService` | Ingress probe + "never throw on a failed probe" rule. |
| `src/cli/services/cli-auth.service.ts:42` | `CliAuthService` | CLI *commands* may stay Nest; the logic behind them may not. |

Transport adapters, still `@Injectable` (6) — `clients/{identity,project,runtime,fleet}/*.client.ts`,
`clients/identity/analytics.client.ts`, `modules/console/clients/managed-web.client.ts`.
Legitimately Nest (7 CLI commands + `ServiceClientRegistry` + `ServiceAuthContextMiddleware`).

### 2.4 Other BFF findings

- `assertRequirementsMet`: **absent** from `src/main.ts` (justified by 0 `.effect()`, but nothing states or checks it).
- `EffectContextOf` / `.use(Module[...])`: 0 — the legacy declaration form is gone; the 42 `.use(` are `requireAuth()` / `publicAccess()`.
- `throw new Error`: 4 — `cli/commands/reseal-secrets.command.ts:74`, `cli/services/cli-auth.service.ts:120,239`, `views/lib/auth.ts:31`.
- `console.*`: 4 — `src/cli.ts:39`, `cli/commands/node-startup-check.command.ts:85`, `src/main.ts:41,44`.
- Type escapes: **0** in production (all in specs).
- `src/modules/shared/errors/service-not-found.error.ts:2` — `class ServiceNotFoundError extends Error`, not a `domainError`.
- **Dead code**: `src/clients/health/health.client.ts:32` — `const healthClient = new HealthClient(new ServiceClientRegistry())` at module scope, unreferenced, bypasses `bffServiceClientOptions`.
- No `ServiceClients` Effect tag exists anywhere: `packages/service-client` exports `BaseClient` and `ServiceClientRegistry` as plain classes, and `client/base-client.ts:14` still documents `@Injectable()`. Every BFF domain service reaches services through a Promise face.

---

## 3. `apps/api/services/runtime` — the largest service gap

### 3.1 `@Injectable()` holding domain state/rules — 45 classes

**`modules/deployment/` (33)**

| Path | Class | Note |
|---|---|---|
| `builders/builder-registry.service.ts:32` | `BuilderRegistryService` | strategy dispatch, `OnModuleInit` |
| `builders/deployment-artifact-builder.service.ts:50` | `DeploymentArtifactBuilderService` | build orchestration |
| `builders/strategies/dockerfile-builder.strategy.ts:18` | `DockerfileBuilderStrategy` | Promise `BuilderStrategy` |
| `builders/strategies/docker-compose-builder.strategy.ts:34` | `DockerComposeBuilderStrategy` | Promise |
| `builders/strategies/buildpack-family-builder.strategy.ts:30` | `BuildpackFamilyBuilderStrategy` | Promise |
| `services/deployment.service.ts:178` | `DeploymentService` | **1244 LOC**, 7 in-memory `Map`s |
| `services/deployment-execution-workflow.service.ts:43` | `DeploymentExecutionWorkflowService` | phase + retry policy |
| `services/container-link.service.ts:32` | `DeploymentContainerLinkService` | label→enrichment rules |
| `repositories/deployment.repository.ts:170` | `DeploymentRepository` | 900+ LOC + `inTransaction` |
| `queue/deployment-queue-lifecycle.service.ts:54` | `DeploymentQueueLifecycleService` | **20 `runPromiseUnwrapped` sites** |
| `queue/deployment-queue.worker.service.ts:139` | `DeploymentQueueWorkerService` | worker loops, heartbeat |
| `queue/deployment-queue-reconciliation.service.ts:32` | `DeploymentQueueReconciliationService` | startup timer |
| `queue/deployment-queue-event.service.ts:11` | `DeploymentQueueEventService` | RxJS pooled bus — stays RxJS |
| `events/deployment-event.service.ts:11` | `DeploymentEventService` | RxJS pooled bus — stays RxJS |
| `events/deployment-read-model-projector.service.ts:29` | `DeploymentReadModelProjectorService` | outbox→projection |
| `mesh/services/deployment-stream-orchestrator.service.ts:21` | `DeploymentStreamOrchestratorService` | thin delegate |
| `preview/preview-env-overlay.service.ts:8` | `PreviewEnvOverlayService` | **pure function** wearing `@Injectable` |
| `storage/storage-provider-registry.service.ts:13` | `StorageProviderRegistryService` | provider dispatch |
| `storage/policy/storage-policy-resolver-registry.service.ts:7` | `StoragePolicyResolverRegistryService` | priority chain |
| `storage/policy/runtime-configuration-storage-policy-resolver.service.ts:10` | policy rule |
| `storage/policy/service-custom-data-storage-policy-resolver.service.ts:12` | policy rule |
| `storage/policy/service-top-level-storage-policy-resolver.service.ts:10` | policy rule |
| `storage/{local,nfs,s3,volume}/*.service.ts:32,32,33,31` | 4 Promise storage providers |
| `triggers/deployment-trigger-registry.service.ts:30` | `DeploymentTriggerRegistryService` | trigger dispatch |
| `triggers/api-trigger.source.ts:26` | `ApiTriggerSource` | Promise |
| `triggers/github-push-trigger.source.ts:34` | `GithubPushTriggerSource` | Promise |

**`modules/docker/` (9)**

| Path | Class | Note |
|---|---|---|
| `repositories/facade/docker.repository.ts:133` | `DockerRepository` | **~700 LOC**, 12 injected ports, 9 `runPromiseUnwrapped` |
| `domains/images/application/docker-images-application.service.ts:25` | `DockerImagesApplicationService` | |
| `domains/images/orchestration/docker-images-orchestrator.service.ts:17` | `DockerImagesOrchestratorService` | |
| `domains/images/queue/docker-image-auto-scan-listener.service.ts:33` | `DockerImageAutoScanListenerService` | 3 state collections |
| `domains/images/security/docker-image-security-scan.service.ts:29` | `DockerImageSecurityScanService` | in-flight map |
| `domains/runtime/orchestration/docker-runtime-activity-domain.service.ts:12` | activity projection | |
| `domains/runtime/orchestration/docker-runtime-orchestrator.service.ts:16` | orchestrator | |
| `repositories/images/catalog/docker-image-catalog.repository.ts:10` | **pure pass-through** — delete |
| `repositories/images/security/docker-image-security.repository.ts:5` | **pure pass-through** — delete |

**`modules/providers/` + `modules/runners/` (6)**
`code/shared/code-provider-registry.service.ts:10`, `code/upload/services/upload-bundle-registry.service.ts:12`,
`code/custom/services/custom-source-provider.service.ts:66`, `code/github/services/github-source-provider.service.ts:19`,
`code/gitlab/services/gitlab-source-provider.service.ts:19`, `code/upload/services/upload-source-provider.service.ts:74`,
`runners/swarm/swarm-compose-realizer.service.ts:385`.

### 3.2 Endpoints still on `implement().handler()` — 74 sites

| File | `.handler(` | Note |
|---|---:|---|
| `deployment/controllers/deployment.controller.ts` | **50** (`:66…:625`) | 1 of 51 is `.effect()` — `:55` only |
| `docker/controllers/docker.controller.ts` | 10 (`:133,140,177,190,327,372,380,431,460,519`) | 25 of 35 are `.effect()`; the 10 left are RxJS stream endpoints |
| `docker/domains/containers/mesh/node-router.ts:23-53` | 17 | whole router on the old `implement()` builder |

### 3.3 Other runtime findings

- `assertRequirementsMet` present (`src/main.ts:40`); `contextFor` used (`app.module.ts:96`).
- `EffectRuntime` injection: **0** (good). Raw `Effect.runPromise` in prod: `deployment/repositories/deployment.repository.ts:184` (a repository running its own runtime), `queue/deployment-queue.worker.service.ts:171`, `docker/domains/entity/orchestration/docker-entity-domain.service.ts:109`, `docker/domains/containers/runtime/docker-container-access.ts:163`.
- `Effect.tryPromise` without signal: 13 — `core/effects.ts:11`, `queue/deployment-queue.worker.service.ts:52,173,221`, `docker/catalog/docker-catalog.ts:45,48`, `docker/domains/containers/orchestration/docker-container-resolution.ts:351,353,354`, `docker/domains/containers/runtime/docker-terminal-sessions.ts:55,59,60`, `docker/domains/containers/runtime/mesh-fallback.ts:59`, `docker/domains/entity/orchestration/docker-entity-domain.service.ts:106`, `docker/domains/images/orchestration/docker-images.service.ts:43,44`.
- `throw new Error`: `deployment/queue/repositories/deployment-queue.repository.ts:169,435`.
- `as unknown as`: `docker/domains/entity/orchestration/docker-entity-domain.service.ts:136`, `docker/domains/entity/orchestration/entity-stream-rules.ts:91`, `docker/domains/containers/runtime/docker-container-access.ts:302`. Plus `as never` bridges: `core/database/runtime-db.ts:34,39`, `core/mesh/join-runtime-mesh.ts:38`, `docker/domains/entity/orchestration/entity-chunks.ts:54`.
- `console.*`: `src/main.ts:62,65`.
- **Shape**: `modules/deployment/` is one vertical domain sliced by *layer*
  (`builders/ controllers/ events/ mesh/ preview/ queue/ repositories/ services/ storage/ triggers/`).
  `modules/docker/` is half-converted: `domains/<entity>/` is the target shape, but
  `controllers/ repositories/ services/ shared/ catalog/` remain as competing top-level layers.
  `docker-image-scanner.service.ts` lives under `repositories/images/security/`.

---

## 4. `apps/api/services/fleet`

| Finding | Detail |
|---|---|
| `@Injectable` domain projector | `modules/cluster/events/cluster-swarm-events.service.ts:52` `ClusterSwarmEventsService` — 5 `BehaviorSubject` + 1 `Subject`, swarm→entity projection, `runPromiseUnwrapped` ×5, `Effect.runFork`. Should be an Effect service exposing `Observable`s. |
| `@Injectable` boundary | `modules/providers/edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider.ts:86` — keep, but self-registers into `EdgeProviderRegistry` in its constructor (`:93-95`). |
| **Legacy endpoints: 12** | `enrollment/enrollment.controller.ts:16,21` (2/2), `mesh-view/mesh-view.controller.ts:21,28,35,42,49,56` (6/6), `platform/controllers/platform.controller.ts:44,86,98,118` (4/4). `EnrollmentService` and `MeshViewService` are plain Promise classes — the whole domains are un-migrated. |
| **`contextFor` NOT wired** | `src/app.module.ts:119` resolves `"effect/context": await host.context()` — the **flat, unprefixed** context. Fleet's 87 `.effect()` handlers run on the pre-strict view, so their requirement sets are unverified at runtime. This is the only service in this state. |
| `throw new Error` | `modules/mesh-view/mesh-view.service.ts:118` — should be the existing `NodeAgentUnsupported` (`reachability/reachability.errors.ts:9`). |
| `Effect.runPromise` in a controller | `modules/cluster/controllers/cluster.controller.ts:100` — hand-rolled `.effect()`. |
| `console.*` | `src/main.ts:61,64`; `modules/platform/controllers/platform.controller.ts:56` (a `catch` that swallows the auth failure into a log). |
| Dead services | `FleetFailureContainmentService:47`, `ServiceDagService:41`, `DriftReconciliationService:53`, `FleetReadinessGateService:65`, `FleetRollbackService:48`, `FleetRolloutPlannerService:54`, `CrossProjectGateService:40` — no tag, no provider, no consumer. |
| Stale comments | 7 module files reference `*.layers.ts` files that do not exist (`cluster.module.ts:25`, `fleet.module.ts:13`, `platform.module.ts:32`, `provider-schema.module.ts:10`, `reachability.module.ts:9`, `push.module.ts:12`, `app.module.ts:122`). |

---

## 5. `apps/api/services/identity`

| Finding | Detail |
|---|---|
| 2 `@Injectable` writing Drizzle directly | `modules/audit/denial-audit.installer.ts:14` `DenialAuditInstaller` (`:25-38`); `modules/role/role.seed.ts:33` `RoleSeeder` (`:40`). Legitimate lifecycle hooks, hand-rolled repositories. Target: `AuditDenialSink` / `RoleSeeder` tags + a thin bootstrap provider. |
| `throw new Error` in repositories (10) | `analytics/repositories/analytics.repository.ts:280,352`; `approval/approval.repository.ts:138,140`; `push/repositories/push.repository.ts:205,303`; `role/role.repository.ts:140`; `user/repositories/user.repository.ts:260,274,321`. |
| `Effect.tryPromise` without signal (7) | `analytics/repositories/analytics.repository.ts:423`, `approval/approval.repository.ts:119`, `permission/repositories/permission.repository.ts:57`, `permission/services/permission.service.ts:132`, `push/repositories/push.repository.utils.ts:7`, `user/repositories/user.repository.utils.ts:7`, `analytics/services/analytics.service.ts:774` (bare `systeminformation` call, no port, failure swallowed into `available:false`). |
| Layering violations | `permission/services/permission.service.ts:30` returns a Drizzle `SQL` from a service; `permission/permission.types.ts:3` `InferSelectModel`; `user/repositories/user.repository.ts:14,194,205` applies `userRules` inside the query. |
| `Effect.runPromise` in domain code | `permission/services/permission.service.ts:122`; `analytics/controllers/analytics.controller.ts:38` (a controller running `serve(context)(…)` itself instead of `.effect()`). |
| Shape | `user|push|permission|analytics` = `controllers/ services/ repositories/ domain/`; `role|approval|audit|step-up` = **flat at module root**. Two conventions in one service. |
| `console.*` | `src/main.ts:61,64`. |

---

## 6. `apps/api/services/project` and `node-agent`

### project (closest to done)

- `@Injectable`: **0**. All 20 domain services/repos are tags with `static live`. `assertRequirementsMet` ✅, `contextFor` ✅.
- `Effect.runPromise` inside `Effect.gen` (breaks interruption): `modules/project/services/project-stream.ts:192`, `modules/service/services/service.service.ts:900`.
- Business rules inside a repository: `modules/service/repositories/service.repository.ts:103` (`insertCreatedEvent` emits a domain event), `:155`/`:213` (`autoLinkSubServiceDependencies`, 3-pass DAG insert), `:284` (`rebuildSubtreePaths`), `:34-57` (`toDto` + schema coercion). Also `project/repositories/project.repository.mappers.ts:71` (per-env rule defaults in a mapper).
- `Effect.tryPromise` without signal: `modules/project/project-effects.ts:41`.
- `as unknown as`: `project/services/project-stream.ts:149`, `service/services/service.service.ts:842`.
- `console.*`: `src/main.ts:60,63`. Direct `logger` instead of the Effect logger: `project/services/project-network.service.ts:92`, `service/services/service-network.service.ts:105,249`.
- Shape: `modules/network/` is a lone gateway file with no module.

### node-agent

- `@Injectable`: 1 — `src/transport/mesh-transport.service.ts:61` `MeshTransportService`. **Legitimate** Nest boundary; uses `EffectHost` correctly (`:75`, `runUnwrapped` at `:100,172,174,183,193`).
- **18 `console.warn` in production mesh code**: `modules/mesh/services/relay.service.ts:161,166,171`; `roster-gossip.service.ts:140,165,218,233,244,257`; `credential-rotation.service.ts:57`; `join-tokens.service.ts:90`; `network/doors/doors-tick.service.ts:64,71`; `core/orpc/serve.ts:18`; `main.ts:51,54`.
- `throw new Error`: `transport/mesh-transport.service.ts:84,93,266`; `network/doors/door-config.ts:38`.
- `Effect.tryPromise` without signal: `modules/mesh/services/relay.service.ts:115,257`, `roster-gossip.service.ts:179,205`, `credential-rotation.service.ts:89`, `network/wireguard.service.ts:135`, `network/doors/docker-engine.ts:63`.
- `as unknown as`: `transport/mesh-transport.service.ts:108`, `local/sqlite.ts:31,32`.
- Shape: `modules/node/` is flat — `node-door.controller.ts` beside `services/`.
- No e2e coverage at all (49 unit specs).

### health (reference — done)

No migration work. Only `console.log` gated behind `EFFECT_SCOPE_REPORT=1` (`src/main.ts:61`) and 2 `console.error` (`:74,77`) plus `controllers/health.controller.ts:28` to move to the logger.

---

## 7. `apps/api/shared` — the platform core

### 7.1 `@Injectable()` → should be a tag: 81 classes

Grouped by module (full list of class names in the companion table below):

| Module | Count | Classes |
|---|---:|---|
| `core/modules/traefik/` | 12 | `TraefikEventService`, `TraefikTemplateRepository`, `TraefikRepository`, `TraefikConfigRefresher`, `TraefikFileSystemService`, `TraefikIngressConfigService`, `TraefikMiddlewareLibraryService`, `TraefikSyncService`, `TraefikTemplateService`, `TraefikValidationService`, `TraefikVariableResolverService`, `TraefikService` |
| `core/modules/setup/` | 4 | `InitializationService`, `LocalInitializationService`, `RemoteInitializationService`, `SetupEventService` |
| `core/modules/domain/` | 6 | `ProjectDomainRepository`, `ServiceDomainMappingRepository`, `DomainConflictService`, `DomainRoutingService`, `DomainVerificationService`, `ServiceDomainMappingService` |
| `core/modules/database/` | 6 | `GlobalDatabaseService`, `GlobalDatabaseLifecycleService`*, `BootstrapAdvisoryLockService`, `DatabaseFailureTracker`, `DatabaseProbeService`, `DatabaseStartupGuard` |
| `core/modules/events/` | 6 | `CoreEventStreamPoolService`, `LocalEventOutboxDispatcherService`, `LocalEventOutboxRepository`, `CoreEventLogRepository`, `CoreEventStreamRepository`, `CoreEventSyncService` |
| `core/modules/platform-ingress/` | 6 | `AppInstanceService`, `EnvHostnameService`, `IngressLanesService`, `PlatformConfigService`, `PlatformRoutesSource`, `PlatformWebTargetService` |
| `core/modules/mesh/` + `mesh-node/` | 6 | `MeshInitializationService`, `NodeMeshConfigRepository`, `SystemMeshClusterRepository`, `SystemMeshConfigService`, `MeshVersionService`, `ClusterSettings`, `NodeAgentBootstrapService` |
| `core/modules/reachability/` | 5 | `PublicAccessPointEventService`, `NodeNetworkConfigRepository`, `PublicAccessPointService`, `PublicEdgeService`, `ReachabilityService` |
| `core/modules/git/` | 5 | `GitService`, `GithubDeploymentCacheRepository`, `GithubDeploymentRulesRepository`, `GithubRepositoryConfigRepository`, `GitHubService` |
| `core/modules/configuration/` | 4 | `ConfigurationDefinitionService`, `ConfigurationResolverService`, `ConfigurationStateMachineBuilderService`, `RuntimeConfigurationAccessorService` |
| `core/modules/deployment/` | 3 | `DeploymentProviderBuilderRunnerStateMachineService`, `PreviewCleanupPolicyService`, `PreviewNamingService` |
| `core/modules/edge/` | 3 | `EdgeProviderRegistry`, `EdgeStateStore`, `DirectEdgeProvider` |
| `core/modules/supervision/` | 2 | `SupervisorEventBus`, `SupervisorRegistrar` |
| `core/modules/auth/` | 2 | `AuthCoreService`, `AuthService` (`Scope.REQUEST`) |
| `core/modules/swarm/` | 2 | `GlobalClusterNodesRepository`, `NodeInventoryService` |
| `core/modules/app-config/`, `bootstrap/`, `egress/`, `node-state/`, `system-metrics` | 1 each | `AppConfigService`, `BootstrapOrchestratorService`, `EgressService`, `NodeConfigSnapshot`, (`SystemMetrics` is already a tag) |
| `core/middlewares/internal-error/` | 1 | `InternalErrorInsightService` |
| `core/utils/` | 1 | `MigrationJournalService` |
| `server/` | 2 | `ServiceClient`, `PreflightService` |

\* legitimately a lifecycle provider, but it also holds the pool handle.

Legitimately Nest (14): `LoggerMiddleware`, `SsrAuthGuardMiddleware`, `InternalErrorContextMiddleware`,
`InternalErrorExceptionFilter`, `MiddlewareGuard`, `CompositeMiddlewareGuard`, `DynamicMiddlewareGuard`,
`RoleCatalogueRefresher`, `LocalDatabaseLifecycle`, `ScannerPoolLifecycle`, `EventsPersistenceWiring`,
`SupervisorDriftControl`, `SwarmLifecycle`, `GlobalDatabaseLifecycleService`.

Already-migrated tags in this shard (the reference shape): `ApprovalGuard`, `SessionResolver`,
`ProjectAccessRepository`, `ProjectAccessService`, `HealthRegistry`, 5 health indicators.

### 7.2 Boundary runs that bypass a host (26 files)

`runPromiseUnwrapped` / `runSyncUnwrapped` imported as free functions and called from Nest classes:

`config/drizzle/schema-codecs.ts:6,124,126`; `config/env/env.service.ts:3,26`;
`core/modules/auth/orpc/middlewares.ts:6,37`; `core/modules/bootstrap/bootstrap-orchestrator.service.ts:50,117,164,202`;
`core/modules/database/global/global-database.service.ts:4,71`; `database/services/database-startup-guard.service.ts:4,43,154`;
`core/modules/docker/docker.module.ts:16,41`; `core/modules/events/base/base-event.service.ts:6,287,392`;
`core/modules/mesh-node/node-agent-bootstrap.service.ts:18,42,70`; `core/modules/mesh/controllers/mesh.controller.ts:8,99,164,194,195,242,244`;
`mesh/repositories/system-mesh-cluster.repository.ts:7,34`; `mesh/services/system-mesh-config.service.ts:3,76,179`;
`node-state/node-config.snapshot.ts:17,38`; `reachability/services/reachability.service.ts:6,51`;
`setup/services/initialization.service.ts:12,162,192,261,297,313,444`;
**`setup/services/local-initialization.service.ts:32,152,224,226,245,246,354,395,472,489,494,545,549,551,583` (15)**;
`setup/services/remote-initialization.service.ts:10,200,252,253`; `supervision/supervisor-registration.ts:4,61,63`;
`supervisors/supervisor-test-harness.ts:3,20-29`; `swarm/services/node-inventory.service.ts:1,2,99,104,106,108`;
`swarm/swarm.module.ts:41,82`; `traefik/services/traefik-config-refresher.service.ts:19,36`;
`traefik/services/traefik-ingress-config.service.ts:29,91`.

Raw `Effect.run*` in non-test code (same class of violation):
`auth/orpc/plugins/auth.plugin.ts:100`; `egress/egress.service.ts:89`; `mesh/services/node-record.client.ts:110`;
`supervision/supervisor-event.bus.ts:17,40`; `supervision/supervisor-registration.ts:71`;
`supervision/supervisors.module.ts:18,23`; `swarm/swarm.module.ts:81,86`;
`database/local/local-database.module.ts:34,49,61`; `events/base/base-event.service.ts:173,669,717`;
`git/git/services/git.service.ts:19`.

`EffectRuntime` injection: **0** (correct). `EffectContextOf`: **0** (correct).

### 7.3 Module-level / static singletons (11)

| Path:line | Singleton |
|---|---|
| `core/authz/role-catalog.ts:24` | `let snapshot` — process-wide permission snapshot |
| `core/authz/role-catalogue.module.ts:5,46` | its writer |
| `core/modules/auth/orpc/middlewares.ts:50` | `let _meshSecretProvider` + setter (carries a `TODO(ph2)` at `:44`) |
| `core/utils/deployer-version.ts:38` | `let _cachedVersion` |
| `core/modules/events/base/base-event.service.ts:134,135,174,253` | `static eventLogStore`, `static serviceRegistry`, constructor self-registration |
| `core/modules/events/base/abstract-domain-event-stream.service.ts:31,37,121` | `static serviceRegistry` + self-registration |
| `core/modules/auth/services/auth-core.service.ts:343` | `static latestModuleOptions` |
| `core/modules/triggers/base-bridge.service.ts:60` | `static sharedStates = new Map()` |

`EffectServices` global augmentation: 0. `AsyncLocalStorage`: 0.
One `declare module` augmentation remains: `core/orpc/context.ts:29` (`@orpc/server` `DefaultInitialContext`).

### 7.4 `Effect.tryPromise` without `AbortSignal` — 14 sites

`approval/approval.guard.ts:41`, `auth/orpc/session-resolver.ts:27`, `events/base/base-event.service.ts:200`,
`project/repositories/project-access.repository.ts:106`, `supervisors/platform/edge-connector.supervisor.ts:41`,
`supervisors/platform/managed-web.supervisor.ts:56,58,59`, `supervisors/platform/traefik.supervisor.ts:102,105`,
`server/health/indicators/{database,disk,migrations,redis}.indicator.ts:59,40,51,57`.

`acquireRelease` used **nowhere** in the shard; the only scoping is the manual `Scope.make()`/`Scope.close()`
pair at `database/local/local-database.module.ts:49`.

### 7.5 `throw new Error` — 29 production sites

`config/auth/mail-sink.ts:27`; `config/drizzle/schema-codecs.ts:64,104,116`; `auth/orpc/middlewares.ts:161`;
`database/query/relation-predicates.ts:145,158`; `edge/edge-provider.registry.ts:37`;
`events/base/abstract-domain-event-stream.service.ts:138,197`;
**`events/base/base-event.service.ts:264,321,357,385,473,519,542,563,584,602,636,738` (12)**;
`mesh-node/cluster-settings.ts:69`; `platform-ingress/services/app-instance.service.ts:57`;
`platform-ingress/services/ingress-provider-token.ts:31`; `server/health/health-registry.service.ts:120,161`;
`server/health/health.module.ts:189`; `server/preflight/preflight.service.ts:143`.

Bare `Error` subclasses outside the `AppError` hierarchy:
`domain/errors/domain-error.ts:13`, `mesh/shared/domain/mesh-base-error.ts:17`,
`egress/egress.service.ts:27`, `traefik/config-builder/variables/variable-registry.ts:8`,
`traefik/config-builder/variables/variable-resolver.ts:12`, `server/bootstrap.ts:247`.

### 7.6 Pure-Nest modules — 25 of 28

`app-config/`, `bootstrap/`, `configuration/`, `context/`, `database/`, `deployment/`, `docker/`, `domain/`,
`edge/`, `egress/`, `events/`, `git/`, `mesh/`, `mesh-node/`, `node-state/`, `platform-ingress/`,
`reachability/`, `setup/`, `supervision/`, `supervisors/`, `swarm/`, `traefik/`, `triggers/` define no
`Context.Service` tag of their own. Only `approval/`, `auth/`, `project/` do.

### 7.7 `console.*` (3) and type escapes (21)

`server/orpc-host.ts:119,129`; `server/preflight/preflight.service.ts:172`.
`as unknown as` — 21 sites in 8 files, concentrated in
`auth/services/auth-core.service.ts:233,445,448,477,480,567,625,640` (8),
`events/services/core-event-sync.service.ts:188,218,380,494` (4),
`events/base/base-event.service.ts:174,277,332` (3),
`core/utils/drizzle-filter.utils.ts:344,345`,
`traefik/config-builder/builders/service-builder.ts:48`,
`traefik/config-builder/variables/variable.types.ts:103`,
`auth/plugin-utils/middleware/orpc-middleware-proxy.ts:316`,
`database/services/database-startup-guard.service.ts:141`.
`as any`: 0 outside specs. `@ts-ignore` / `@ts-expect-error`: 0.

---

## 8. `apps/setup`

### 8.1 `@Injectable()` → tags (13)

| Path:line | Class |
|---|---|
| `modules/wizard/setup-gate.service.ts:52` | `SetupGateService` — the gate policy, holds the admin password in memory |
| `modules/wizard/wizard-state.service.ts:47` | `WizardStateService` — `isConfigured` predicate |
| `modules/wizard/wizard-upstream.service.ts:28` | `WizardUpstreamService` — API URL resolution + 503 translation |
| `modules/wizard/wizard-stream.service.ts:40` | `WizardStreamService` — event merge |
| `modules/wizard/mesh-onboarding.service.ts:27` | `MeshOnboardingService` |
| `modules/cluster/services/swarm-bootstrap.service.ts:24` | `SwarmBootstrapService` — found-vs-join policy |
| `modules/cluster/services/cluster-orchestrator.service.ts:43` | `ClusterOrchestratorService` — RxJS retry pipeline |
| `modules/cluster/services/node-agent-launcher.service.ts:22` | `NodeAgentLauncherService` |
| `modules/handover/services/handover-orchestrator.service.ts:72` | `HandoverOrchestratorService` — the six-invariant ordering |
| `modules/handover/services/api-service-provisioner.service.ts:42` | `ApiServiceProvisioner` |
| `modules/handover/services/services-tier-provisioner.service.ts:92` | `ServicesTierProvisioner` |
| `modules/handover/services/ingress-handover.service.ts:53` | `IngressHandoverService` |
| `modules/ingress/services/bootstrap-ingress.service.ts:59` | `BootstrapIngressService` |

Streaming, stays RxJS but is not an Effect bus: `modules/progress/services/orchestration-stream.service.ts:67`,
`modules/health/setup-phase.service.ts:36`.
Correct lifetime providers: `config/database/local-database.module.ts:42`, `modules/cluster/cluster.module.ts:37`,
`modules/health/setup-readiness.indicator.ts:23`.

### 8.2 Endpoints — 13 `.handler()`, 0 `.effect()`, 0 `procedure()`

`modules/wizard/wizard.controller.ts:77,82,90,96,106,117,162,215,224,231,254,288,308`.

### 8.3 Other setup findings

- `assertRequirementsMet` present (`app.config.ts:52`) — the only non-service app that does it.
- Raw Effect runs in Nest classes (20): `config/database/local-database.module.ts:30,45,57`;
  `modules/cluster/cluster.module.ts:44,49`; `wizard-state.service.ts:62,68,110`;
  `setup-gate.service.ts:125,187,322,328`; `config/env/env.service.ts:24`;
  `swarm-bootstrap.service.ts:50,65,72`; `api-service-provisioner.service.ts:144,256,318`;
  `services-tier-provisioner.service.ts:264,500`; `bootstrap-ingress.service.ts:214,564,574,692,729,743,778`.
- `throw new Error` (10): `api-service-provisioner.service.ts:111,140,151,345`;
  `handover-orchestrator.service.ts:624,640`; `services-tier-provisioner.service.ts:221`;
  `bootstrap-ingress.service.ts:799`; `wizard-stream.service.ts:338`; `src/views/lib/auth.ts:38`.
- `console.*` (4): `src/compile.ts:60,67,68,70`.
- Type escapes: 0 in production.
- Pure-Nest modules (no Effect-tag providers): `HandoverModule`, `WizardModule`, `SetupIngressModule`,
  `SetupProgressModule`, `SetupHealthModule`. `SetupClusterModule` mixes tags in.
  `wizard-orpc.module.ts` is the only plain `@Module` (wrapped via `declareModule:162`).

---

## 9. `apps/web` and `apps/doc`

`apps/web` is **not** in scope for the Effect migration and is compliant: 109 files import `@/lib/orpc`,
18 `domains/*/endpoints.ts`, 0 hardcoded route `href`s, 0 `fetch("/api`. Three ORPC bypasses to fix:

- `src/lib/platform/app-instance.server.ts:77,93` — hand-rolled `fetch` to `/platform/app-instances/register` and `/heartbeat`.
- `src/components/devtools/TanStackDevTools.tsx:1273` — `fetch(API_URL + "/health")`.
- `src/app/.well-known/agent-configuration/route.ts:30` — `fetch(getAuthUrl(...))`.

`apps/doc` teaches the pattern the migration replaces — 15 pages:

| Path:line | Contradiction |
|---|---|
| `content/docs/dev/orpc.mdx:26,57` | "Use `@Implement(...)` and `implement(...).handler(...)`" |
| `content/docs/dev/orpc-auth-patterns.mdx:33,73,100,123,150,170` | `.handler(...)` as *the* pattern |
| `content/docs/dev/api-service-adapter.mdx:2` | title: "Service-Adapter Pattern in API" |
| `content/docs/reference/glossary.mdx:37` | defines Service-Adapter as canonical |
| `content/docs/index.mdx:232`, `dev/auth-access-control.mdx:63`, `dev/client-data-layer.mdx:74` | link to it as canonical |
| `content/docs/architecture/mesh-consumer-boundary-pattern.mdx:244,268,381,401,461,558` | `@Injectable` + `.handler(...)` |
| `content/docs/architecture/startup-architecture-v2.mdx:296,420,601,664,718,1052` | 6 `@Injectable` examples |
| `content/docs/architecture/startup-v2-implementation-blueprint.mdx:132,235,586,613,622` | 5 `@Injectable` |
| `content/docs/dev/startup-architecture.mdx:89,130,280,328,391,547` | 6 `@Injectable` |
| `content/docs/deployment/{networking,deployment-capabilities,provider-e2e-first-deploy-plan}.mdx` + `dev/global-db-migration-management.mdx:346` | `@Injectable` as the way to add an edge provider |

Also `content/docs/architecture/internal-packages-monorepo.mdx:21,41-45,69` presents the **deleted**
`@deployer/nest-{database-core,database-local,docker,nodes,supervisor-core}` packages as current.
That page is the single worst offender in the published docs.

---

## 10. `packages/**` — 44 packages

### 10.1 Verdict table

Legend: **EN** effect-native (tags + layers) · **EN⁻** Effect code, no tag · **NC** Nest-coupled · **PT** plain TS · **N/A** not applicable.

| Package | npm name | `effect` | `@nestjs/*` | Tags | Verdict |
|---|---|---|---|---|---|
| `packages/auth` | `@deployer/auth` | no | no | — | PT (by design) |
| `packages/config/env` | `@deployer/env` | no | no | — | PT |
| `packages/contracts/{bff,common,entities,fleet,health,identity,node-agent,project,runtime}` | — | no | no | — | N/A (9 packages) |
| `packages/database` | `@deployer/database` | yes | no | **none** | **EN⁻** — `makeDatabaseHandle` is a shape; no tag, no Layer, no `CurrentTx` |
| `packages/docker` | `@deployer/docker` | yes | no | 6 | EN (reference quality) |
| `packages/effect/core` | `@deployer/effect-core` | yes | no | 2 | EN |
| `packages/effect/infra` | `@deployer/effect-infra` | yes | no | 5 | EN |
| `packages/effect/orpc` | `@deployer/effect-orpc` | yes | no | helpers | EN |
| `packages/effect/platform` | `@deployer/effect-platform` | yes | no | 1 | EN |
| `packages/effect/reachability` | `@deployer/effect-reachability` | yes | no | functions | EN |
| `packages/environment` | `@deployer/environment` | yes | no | 1 | EN |
| `packages/events` | `@deployer/events` | yes | no | **none** | **EN⁻** |
| `packages/infrastructure/logger` | `@deployer/logger` | no | no | — | PT — still a Pino singleton, not the L0 `Logger` |
| `packages/lifecycle` | `@deployer/lifecycle` | yes | no | 1 | EN |
| `packages/mesh/client` | `@deployer/mesh-client` | yes | no | **none** | **EN⁻** |
| `packages/mesh/server` | `@deployer/mesh-server` | **devDep only** | no | — | PT |
| `packages/mesh/service` | `@deployer/mesh-service` | yes | no | **none** | **EN⁻** |
| `packages/nest/effect` | `@deployer/nest-effect` | yes | **peer** | 2 | **NC** — the temporary bridge |
| `packages/nest/mesh` | `@deployer/nest-mesh` | yes | **yes** | 1 | **NC** |
| `packages/nest/schema` | `@deployer/nest-schema` | no | **yes** (one `Logger` import) | — | **NC** — rename only |
| `packages/node/agent-container` | `@deployer/node-agent-container` | yes | no | none | **EN⁻** — explicit Promise face |
| `packages/node-state` | `@deployer/node-state` | yes | no | 4 | EN |
| `packages/platform-supervisors` | `@deployer/platform-supervisors` | yes | no | none (by design) | EN |
| `packages/rate-limit` | `@deployer/rate-limit` | yes | no | 1 | EN |
| `packages/routing/declarative` | `@deployer/declarative-routing` | no | no | — | PT |
| `packages/service-client` | `@deployer/service-client` | yes | no | **none** | **EN⁻** — `ServiceClientRegistry` is a plain class |
| `packages/supervision` | `@deployer/supervision` | yes | no | 2 | EN |
| `packages/swarm` | `@deployer/swarm` | yes | no | 7 | EN |
| `packages/system-metrics` | `@deployer/system-metrics` | yes | no | 1 | EN |
| `packages/transport/orpc` | `@deployer/orpc-utils` | no | no | — | PT |
| `packages/ui/base` | `@deployer/ui` | no | no | — | N/A |
| `packages/utils/{errors,provider-schema,type-guards,vite-assets}` | — | no | no | — | PT |
| `packages/utils/use-safe-query-param-states-from-zod` | — | no | no | — | N/A |

Counts: **EN 17 · EN⁻ 6 · NC 3 · PT/N/A 18**.

### 10.2 Nest-coupling violations — exact list

```
packages/nest/effect/src/collect-effect-layer.ts:1     @nestjs/core/injector/constants (STATIC_CONTEXT)
packages/nest/effect/src/collect-effect-layer.ts:4     type DiscoveryService
packages/nest/effect/src/create-module-context.ts:1    Global, Module, DynamicModule, ModuleMetadata, Type
packages/nest/effect/src/effect-host.ts:5              type FactoryProvider
packages/nest/effect/src/effect-lifecycle.ts:5         OnModuleDestroy, OnModuleInit, Provider, Type
packages/nest/effect/src/effect-runtime.module.ts:1,2  Global, Module, DynamicModule, DiscoveryModule
packages/nest/effect/src/effect-runtime.ts:7,8,14,15   Inject, Injectable, Optional, InjectionToken, OnApplicationShutdown, DiscoveryService, ModulesContainer, InstanceWrapper, NestModuleRef
packages/nest/effect/src/effect-runtime.spec.ts:1      @nestjs/testing
packages/nest/mesh/src/mesh-router.resolver.ts:6,7     type Type, DiscoveryService
packages/nest/mesh/src/mesh-transport.module.ts:1,2    Module, DiscoveryModule, DiscoveryService
packages/nest/schema/src/codecs/codec-registry.ts:3    Logger   ← the only import; one-line fix
```

`@Injectable()` in `packages/**` — one real decorator: `packages/nest/effect/src/effect-runtime.ts:26`.
(`packages/service-client/src/client/base-client.ts:14` is JSDoc example text.)

Outside `packages/`: `tooling/**` is fully Nest-coupled and zero-Effect —
`tooling/bin-pkg-build/src/{app.module.ts:1,cli.ts:4,commands/pkg-build.command.ts:1,30,services/pkg-builder.service.ts:1,63,services/pkg-config.service.ts:1,68}`,
`tooling/dependency-builder/src/{modules/dependency-builder.module.ts:1,commands/build.command.ts:4,63,services/{application-detector,turbo-runner,union-planner,workspace-scanner}.service.ts:1/31,15/113,1/44,4/67}`.
`samples/api-sample/src/effect/*` and `samples/api-sample/requirements-demo/src/effect/*` are **forked copies** of the bridge.

### 10.3 `packages/nest/effect` — the bridge that was supposed to be split

Exported surface (`src/index.ts`): `collectEffectLayer`, `EffectRuntime`, `EffectHostModule`,
`EffectHost`/`effectHostProvider`/`makeEffectHost`/`EffectHostShape`, `EffectRuntimeModule`,
`effectContextFor`/`EffectContext`, `createGlobalModule`/`createModuleContext`/`declareModule`/
`EffectContextOf`/`ExportsOf`/`AllServicesOf`, `assertRequirementsMet`/`procedure`/`requires`/
`GlobalServicesOf`/`UnmetRequirementsOf`/`RequirementsMet`, `ServiceLifecycleRunner`/`serviceLifecycle`,
`Authz`/`makeAuthz`/`authzLive`, and `effectContext` from `@deployer/nest-effect/testing`.

- **`collect-effect-layer.ts` still exists and is live**: `effect-runtime.ts:11` imports it, `:223` calls it,
  `:226/:229` build the `ManagedRuntime` from the `Layer.succeed(wrapper.token, wrapper.instance)` snapshot
  (`collect-effect-layer.ts:41`). This is exactly the P11 violation the roadmap's "Done" table claims is replaced.
- `layerOfClass` is gone (0 hits) ✅.
- The promised split into `effect-core` / `effect-orpc` / `effect-infra` / `effect-testing` + temporary
  `effect-nest` **has not happened**; all five live in one package with `@nestjs/*` as peer deps.
- `Authz` is misplaced: it belongs in `@deployer/effect-authz`, not a Nest bridge. Consumer:
  `apps/api/shared/src/server/orpc-host.ts:16`.

### 10.4 `packages/nest/mesh` and `packages/nest/schema`

- `@deployer/nest-mesh` — declarative mesh transport (`MeshController`, `declareProcedures`, `MeshRouterResolver`,
  `MeshTransportModule`). Framework-adjacent **by construction** (Nest `DiscoveryService` + `Type`). It also carries
  one Effect tag (`MeshRouterResolver extends Context.Service`, `mesh-router.resolver.ts:41`).
  Consumers: `apps/api/services/node-agent` (10 files). No Effect replacement exists; not on the roadmap's delete list.
- `@deployer/nest-schema` — 5.9k LOC of Drizzle tables, codecs, migrations, table ownership. Roadmap: *rename only*.
  Consumers: 40+ files across `apps/api/**` plus `packages/node-state` (`local-database.ts:8`, `nodes/*.repository.ts:3-5`).
  Blocker: the single `@nestjs/common` `Logger` import at `codecs/codec-registry.ts:3`.

### 10.5 Promise faces over Effect services

| Path:line | Wraps |
|---|---|
| `packages/node/agent-container/src/agent-container.ts:180-205` | every `@deployer/docker` call → `runPromiseUnwrapped` |
| `packages/mesh/client/src/pooled-link.ts:89,102,103` | `LinkPool` acquire/evictIdle/closeAll |
| `packages/mesh/client/src/node-door.ts:216` | `Effect.runPromise(call(...))` inside `try/catch` returning `null` — swallows every failure |
| `packages/effect/infra/src/net/safe-http-client.ts:20-39` | `SafeHttp` → `runPromiseExit` then `throw failure.error` |
| `packages/service-client/src/transport/service-fetch.ts:47-54` | `callService` (needed: oRPC `fetch` is Promise) |
| `packages/effect/infra/src/crypto/sync-secret-box.ts:54` | `KeyRing`/`SecretBox` at the Drizzle codec boundary (deliberate) |

### 10.6 `packages/effect/*` — what infrastructure exists, and what is missing vs the catalog

| Package | Tags present | Missing vs `effect-layers-catalog.md` |
|---|---|---|
| `effect-core` | `CurrentActor`, `Correlation`; `domainError`, `fromAbortable`, `serviceOver`, `bindServices`, `runPromiseUnwrapped`, `runSyncUnwrapped` | `IdGen`, `RequestInfo`, branded ids, `ResiliencePolicy` |
| `effect-infra` | `KeyRing`, `SecretBox`, `FileSystem`, `SafeHttp`, `CommandRunner` (+ 4 fakes) | `AppConfig`, `Logger`/`Observability`, `EventBus`, `Outbox`, `JobQueue`, `Scheduler`/`Lease`, `Readiness`/`Probes`, `Db<Owner>` tag, `SecretBox`/`PgDb` fakes |
| `effect-orpc` | `handle`, `catchDomainErrors`, `mapDomainError`, `actorFromContext`, `correlationFromContext`, `provideRequest`, `createServe` | `HttpEdge`, `ServiceClients`, `ContractHarness`, `RequestInfo` tag |
| `effect-platform` | `ArchiveExtractor` (+ `.fake`) | Docker/Swarm/Git/Traefik/DNS/Notifier adapters — they live in the standalone packages instead |
| `effect-reachability` | functions only (`probeAddress`, `probePeer`) | a tag |

### 10.7 Test/fake layer coverage — 12 of 17 Effect packages have none

Have a fake: `effect-infra` (`KeyRing.test`, `FileSystem.test`, `SafeHttp.fake`, `CommandRunner.script`),
`effect-platform` (`ArchiveExtractor.fake`).
Have none: `effect-core`, `effect-orpc`, `effect-reachability`, `database`, `docker`, `swarm`, `node-state`,
`supervision`, `events`, `service-client`, `platform-supervisors`, `environment`, `lifecycle`,
`system-metrics`, `rate-limit`, `mesh/{client,service,server}`.
Three naming conventions coexist for the same concept (`test`, `fake`, `script`); nothing enforces one.

### 10.8 Dead packages

- `@deployer/runthenkill` (`tooling/bin-runthenkill`) — **zero consumers**; only comments in
  `infra/docker/builder/app/entrypoint-app.sh:145` and `tooling/bin-pkg-build/src/services/pkg-builder.*`.
- `@deployer/effect-platform` and `@deployer/effect-reachability` have exactly one consumer each
  (`git.service.ts:9`; `egress.service.ts:13`) — alive but thin.
- `samples/**` — 2 forked copies of the bridge, already diverging.

---

## 11. Contracts — 35 of 423 procedures miss `.errors()`

The prior audit's claim ("only 3 `.errors()` sites, all in `mesh/`") is **stale**: 388 sites exist.

| Package | procedures | `.errors()` | missing |
|---|---:|---:|---:|
| `bff` | 52 | 52 | 0 |
| `identity` | 61 | 61 | 0 |
| `project` | 69 | 69 | 0 |
| `health` | 2 | 2 | 0 |
| `node-agent` | 22 | 22 | 0 |
| `runtime` | 104 | 103 | **1** |
| `fleet` | 113 | 79 | **34** |

Exact missing sites:

- `packages/contracts/fleet/modules/mesh/index.ts` — **15/15**: `:71,89,97,105,108,115,126,134,143,151,163,171,179,187,195`.
- `packages/contracts/fleet/modules/nodes/index.ts` — **9/11**: `:155,163,171,183,195,203,211,219,227`.
- `packages/contracts/fleet/modules/cluster/index.ts` — **6/16** stream contracts: `:159,167,174,182,190,198`.
- `packages/contracts/fleet/modules/providers/code/github/contracts.ts` — `:414,432,450`.
- `packages/contracts/fleet/modules/providers/code/gitlab/contracts.ts` — `:43`.
- `packages/contracts/runtime/modules/deployment/crud.ts:232` — `deploymentUploadBundleContract`.

`.errors(meshDomainErrorContracts(e))` is used in only 2 places: `fleet/modules/mesh/enrollment.ts:21,29`.

Legacy locations are gone: `apps/api/src/` and `packages/contracts/api/` no longer exist.
Drift remains in three divergent router compositions with no gate keeping them aligned:
`apps/api/bff/src/orpc/app-contract.ts:36`, `apps/api/shared/src/core/orpc/app-contract.ts:23`,
`apps/setup/src/views/lib/app-contract.ts:21`.

---

## 12. Gates — 7 of the 12 rubric checks have no automated enforcement

| Rubric check | Enforced? | Where |
|---|---|---|
| C1 no `@Injectable` domain service | ✅ in 4 apps | `effectConventions()` — bans the `Injectable`/`Scope` import in `**/services/**` and `**/repositories/**` (health, identity, project, fleet; runtime still has 9) |
| C2 no `EffectRuntime` injection outside its module | ❌ | prose only (`effect-host.md:81-85`) |
| C3 `procedure().effect()`, no `implement()` | ⚠️ partial | `effectConventions()` (which includes `controllersUseProcedure()`) is on in health/identity/project/fleet/runtime/BFF/shared/setup. `*.delegation.ts` still escapes by filename — that is the 284-handler item |
| C4 `assertRequirementsMet` at every root | ⚠️ | 7/7 apps call it; fleet now resolves `contextFor(controller)` instead of the flat `host.context()` (2026-11-04). No automated check |
| C5 no `throw new Error` | ✅ in 4 apps | `effectConventions()` bans it in `**/services/**` (repositories are exempt: their throw is the `Effect.tryPromise` boundary that becomes `RepositoryFailure`) |
| C6 `AbortSignal` in `tryPromise` | ❌ | prose only (`from-abortable.ts:11-22`) |
| C7 no global augmentation / singletons | ❌ | nothing |
| C8 feature-first shape | ❌ | nothing |
| C9 no `console.*` | ✅ in 4 apps | `effectConventions()` — `no-console` for `src/**`, exempting `main.ts` (boot) and tests |
| C10 no type assertions | ⚠️ partial | `effectConventions()` bans `@ts-ignore`/`@ts-expect-error`; `as unknown as` stays manual on purpose (the rest are typed ports — a better port, not a suppression) |
| C11 `.errors()` on every contract | ❌ | 35/423 missing; no script reads `packages/contracts/**` |
| C12 `Test` layer per Effect package | ❌ | nothing |
| Contracts use `route()` not `oc.route()` | ✅ | `no-restricted-syntax` in 7 contract `eslint.config.ts:10-17` |
| Service owns only its Drizzle tables | ✅ | `serviceSchemaBoundary({owner})` in 5 services |
| No DI cycles | ✅ | `check-di-graph.ts` via `ci.yml:227` (`DI_GATE=cycles`) |
| `@Global()` ⇒ `declareModule(global:true)` | ✅ | `check-global-modules.ts` via `ci.yml:237` |
| Injected classes are value imports | ⚠️ **broken** | `check-di-imports.ts:23` `SCAN = ["apps/api-services", "apps/setup/src"]` — `apps/api-services` does not exist, so the whole API tier is unchecked and the gate passes |
| `shared` must not import an app; no app→peer-app import | ⚠️ advisory | `check-di-graph.ts:540-588` SC7, not gating (`DI_GATE=cycles`) |
| `declareModule` claims non-empty | ❌ unwired | `check-module-claims.ts`; `package.json:315`; not in CI/husky/turbo |
| Package subpath imports resolve | ❌ unwired | `check-package-subpath-imports.ts`; no `package.json` entry at all |
| BFF ↔ web service-surface parity | ❌ unwired | `check-service-surface-parity.py`; referenced only in comments |
| Swarm paths never shell out | ❌ broken | `check-swarm-cli-lock.sh` paths `packages/nest/swarm/src`, `apps/api/shared/src/core/modules/swarm` both gone |
| — | ❌ dead | `check-contract.ts` imports deleted `packages/contracts/api/src` |

Wiring facts:

- `turbo.json` has **no task** for any `check:*`; they are not in `compile`/`lint`/`test`/`type-check`.
- `.husky/pre-commit` = type-check + test + staged lint. No architecture gate.
- `.husky/pre-push` = `bun run check -- --affected` (compile/lint/test/type-check). No architecture gate.
- `ci.yml` runs exactly three: `check:di-graph` (`:227`), `check:di-imports` (`:232`, broken), `check:global-modules` (`:237`).
- `ci.yml:456` e2e job is `continue-on-error: true` — non-blocking.

---

## 13. Tests

| Scope | unit specs | e2e |
|---|---:|---|
| `apps/api/shared` | 81 | — |
| `apps/api/services/runtime` | 74 | 6 |
| `apps/api/services/node-agent` | 49 | **0** |
| `apps/api/services/fleet` | 35 | 2 |
| `apps/api/services/identity` | 18 | 3 |
| `apps/api/services/project` | 10 | 3 |
| `apps/api/bff` | 6 | 4 |
| `apps/api/services/health` | 3 | 2 |
| `apps/web` | 63 | 1 |
| `apps/setup` | 16 | 0 |
| `apps/doc` | **0** | 0 |
| `packages/**` | 172 | — |

Zero test files: `packages/routing/declarative`, `packages/infrastructure/logger`, `packages/utils/provider-schema`.

---

## 14. Ranked backlog

Ordered by leverage: unblocking first, then volume, then hygiene.

| # | Target | Why | Size |
|---|---|---|---|
| 1 | **`apps/api/bff/src/modules/delegation/generated/**`** — 284 pass-through handlers | The single largest violation and the one the target names explicitly. Deleting it unblocks everything else in the BFF. | XL |
| 2 | **`apps/api/services/runtime/modules/deployment`** — 33 `@Injectable`, 50 legacy handlers, layer-first shape | `DeploymentService` 1244 LOC / 7 state maps; `DeploymentQueueLifecycleService` alone has 20 `runPromiseUnwrapped`. | XL |
| 3 | **`apps/api/shared/src/core/modules/traefik`** — 12 `@Injectable` + the shared `events/`, `setup/`, `domain/`, `database/`, `platform-ingress/` modules | 81 classes; the roadmap's own order-1 item. | XL |
| 4 | **`apps/api/services/runtime/modules/docker`** — facade + legacy router | `DockerRepository` 700 LOC / 12 ports / 9 unwrapped runs; 2 pure pass-through repositories to delete; `node-router.ts` on `implement()` (17 sites). | L |
| 5 | **`packages/nest/effect`** — kill `collect-effect-layer.ts`, split the package | P11 violation still live (`effect-runtime.ts:223`); the promised 5-way split has not happened; `Authz` is misplaced. | L |
| 6 | **`packages/database`** — become a real `Db<Owner>` tag + Live/Test layer | Two competing implementations (`makeDatabaseHandle`, `effect-infra/db/pg-db.ts:51`), neither a tag. | L |
| 7 | **Repo-wide `AbortSignal` / `acquireRelease`** | 75 bare `Effect.tryPromise`, 0 `fromAbortable` outside `packages/effect`, 0 scopes. The helper already exists and is unused. | L |
| 8 | **`apps/setup`** — 13 domain services, 13 legacy handlers | Onboarding owner; the roadmap's order-2 item. | L |
| 9 | **`apps/api/services/fleet`** — wire `contextFor`, migrate `enrollment`/`mesh-view`/`platform` | Only service on the flat context; 12 legacy handlers; 7 dead services. | M |
| 10 | **`packages/nest/schema`** — drop the one `@nestjs/common` import, rename to `@deployer/schema` | Unblocks the "no `nest-*` package" rule and the `node-state` dependency smell. 40+ mechanical edits. | M |
| 11 | **Test layers for the 12 Effect packages that have none** | Only 5 of 17 ship a fake; three naming conventions. | L |
| 12 | **`packages/events` + `packages/service-client`** — add tags, delete the class face | `makeEventJournal` and `ServiceClientRegistry` are untagged; `base-client.ts:14` still teaches `@Injectable()`. | M |
| 13 | **Missing `.errors()`** — 35 procedures | Mechanical; `fleet/modules/mesh/index.ts` is 15 of them. | S |
| 14 | **Gates for C1–C12** — *C1/C3/C5/C9/C10 now have one (2026-11-04): `nestjsConfig.configs.effectConventions()`, enabled in health/identity/project/fleet. It is per-app because a migration is per-app; runtime enables it the day its last `@Injectable` service is a tag.* | `check-di-imports` is silently broken; 4 scripts are unwired; 1 is dead. | M |
| 15 | **`apps/doc`** — 15 pages teach `implement().handler()` / Service-Adapter; `internal-packages-monorepo.mdx` lists deleted packages | What the next agent reads first. | M |
| 16 | **Hygiene sweeps** | 29 `throw new Error` in `shared`; 21 `as unknown as`; 12 in identity repos; 18 `console.warn` in node-agent; 4 `console.*` each in bff/setup. | M |
| 17 | **Delete dead code** | `tooling/bin-runthenkill`, `samples/**` bridge forks, 7 unwired fleet services, 2 pass-through docker repositories, `bff/clients/health/health.client.ts:32`, `HealthClient`/`FleetClient`/`AnalyticsClient` (provided, injected nowhere). | S |
| 18 | **Stale doc comments** | 7 `*.layers.ts` references in fleet; the roadmap's `EffectRuntimeModule.forRoot({ layers })` row; `apps/api/shared/src/core/orpc/app-contract.ts:11` comment. | S |

---

## 15. Where this inventory disagrees with `effect-migration-roadmap.md`

| Roadmap claim | Reality |
|---|---|
| "`identity, project, fleet, runtime services` — Effect layers behind `serve`" | runtime still has 45 `@Injectable`; fleet's `enrollment`/`mesh-view`/`platform` domains are plain Promise classes. |
| "`svc-identity, svc-project, svc-fleet, svc-runtime endpoint requirements` — `contextFor`" | **fleet does not use `contextFor`** (`app.module.ts:119` uses the flat `host.context()`). |
| "`EffectRuntimeModule.forRoot({ layers })` and the `*.layers.ts` / `app.layers.ts` assemblies" | No `*.layers.ts` exists anywhere; all six apps import bare `EffectRuntimeModule` and provide tags with `useValue: X.live`. |
| "`@deployer/service-client` — done" | No `Context.Service` tag exists; only a plain `ServiceClientRegistry` class. |
| "`@deployer/events` — done (journal in Effect)" | `makeEventJournal` is a shape, not a tag. |
| "`@deployer/database` — done" | `makeDatabaseHandle` is a shape, not a tag; no `Db<Owner>`, no `CurrentTx`, no Layer. |
| "Legacy `.use(Module[EffectContextOf])` … is deleted after the last service migrates" vs "legacy union deleted" | Mutually exclusive in the same file (`:44-46` vs `:95`). Reality: 0 occurrences — the second is right. |
| "No `nest-effect/<feature>` host and no Promise face: those were a migration layer and are gone" vs "otherwise keep a Promise face in the host" | Contradictory (`:29-30` vs `:98`). Reality: Promise faces remain in `mesh-client`, `agent-container`, `safe-http-client`, `service-fetch`. |
| Prior audit: "only 3 `.errors()` sites, all in `mesh/`" | 388 sites exist; 35 procedures missing. |
| Prior audit: "166 classes still to convert" | 221 files carry `@Injectable`; **81 + 45 + 6 + 13 = 145** are migration targets, the rest are legitimate Nest classes. |
