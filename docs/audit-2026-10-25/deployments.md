# Deployment pipeline audit (v3, branch rewrite-v3, 2026-10-25)

Scope: `apps/api/src/modules/{deployment,runners,providers,provider-schema}`, `packages/utils/provider-schema`, `apps/web/src/app/dashboard/deployments` (+ the project/service deployment pages that actually host trigger/rollback/logs), the forked `apps/api-services/services/runtime`, docs, e2e.
Method: files read directly. Only check run: `bun run test src/modules/{deployment,runners,providers,provider-schema}` in apps/api -> 29 files / 284 tests green (18s). Green unit tests mostly prove mocked wiring, not the behaviours flagged below.
All paths relative to `/home/sebille/Bureau/projects/tests/deployer/v3`. `A=apps/api/src/modules`.

Legend: REAL = implemented and wired end to end; PARTIAL; STUB; MISSING.

---------------------------------------------------------------------
## 1. Feature inventory

### Triggers
| Feature | Status | Evidence |
|---|---|---|
| Manual trigger (API `deployment.trigger`) | PARTIAL | `A/deployment/services/deployment.service.ts:368-565`. Validates access, runtime-config constraints, resolves checkout, enqueues. BUT with no `execution.builder` the builder stays null (`:458`, state machine only normalises for `custom` provider / custom commands, `core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service.ts:208-260`), `artifact-builder.service.ts:68-70` returns `fallbackContainerImage` (null for github/upload), the runner then falls to `"nginx:alpine"` (`A/runners/docker/docker-runtime-runner.service.ts:38`, `A/runners/swarm/swarm-runtime-runner.service.ts:99`) and the deployment is marked `success`. Server never reads `service.builderId`. |
| Manual trigger from UI | PARTIAL/BROKEN | Project page `apps/web/src/app/dashboard/projects/[projectId]/deployments/page.tsx:94-120` sends `{body:{serviceId, environment, source?}} as any`; `source` only built for `providerId==='github'`, contract requires `source` (`packages/contracts/runtime/modules/deployment/crud.ts:94`), so non-github services fail validation; no builder/runner/branch/commit/upload UI. |
| Zip/tar upload source | PARTIAL | `deployment.service.ts:217-255` (uploadBundle, no auth role, no size cap, `/tmp/deployer-uploads`), `A/providers/code/upload/services/upload-source-provider.service.ts`. Registry is in-memory (`upload-bundle-registry.service.ts`) so retry/restart loses uploads. No web UI calls `uploadBundle`. Client-controlled `uploadPath` accepted (see section 3 security). |
| GitHub source (clone + build) | PARTIAL | `github-source-provider.service.ts:24-62`, clone in `core/modules/git/git/services/git.service.ts:17-50`. Anonymous clone only: `getInstallationAccessToken` (`core/modules/git/github/services/github.service.ts:325`) is never called from the clone path, so private repos fail. `--depth 1 --branch <ref>` then `checkout(commit)` fails for any non-tip commit; `refs/pull/N/head` is not a valid `--branch` for clone. |
| GitLab source | STUB | Checkout resolves (`gitlab-source-provider.service.ts`), but `artifact-builder.service.ts:91-119` only supports `github` and `upload` ("Supported providers: github, upload"); `resolveProviderKind` maps gitlab to "upload". GitLab accounts CRUD stores a token (`gitlab-account.controller.ts`) that nothing uses. No GitLab webhook controller. |
| Custom (prebuilt image) source | REAL (narrow) | `custom-source-provider.service.ts`, forced `external` builder via state machine; deploys an image by name with docker runner. Needs registry pull to work; no registry credentials plumbing. |
| GitHub push auto-deploy | STUB | `deployment/triggers/github-push-trigger.source.ts` resolves repo->service correctly, but `github.webhooks.controller.ts:120-131` logs "not dispatched (no system actor)" and returns `skipped`. Nothing ever deploys on push. |
| GitHub PR preview deploy | STUB | `github-webhook-dispatch.service.ts:91-166` + `preview-provisioning.service.ts:63-128` only create a DNS record, a route, and a `preview_environments` row pointing at the service's LATEST deployment (`:239-243`). No per-PR build or deployment is ever triggered; preview host routes to the same container as the service (`core/modules/platform-ingress/services/platform-routes-source.service.ts:252-277`). Preview env overlay service (`deployment/preview/preview-env-overlay.service.ts`) has no callers. |
| Webhook signature verification | PARTIAL/BROKEN | `providers/middleware/github-webhook-auth.middleware.ts:119-195`. (a) Secret read only from `app_config.key='github_webhook'` (`github-apps.repository.ts:173-189`); nothing in the repo ever writes that key (grep: only readers, plus setup of per-app `githubApps.webhookSecret` which is never used for verification) -> `getWebhookSecret()` returns null -> every delivery rejected 401 (fail-closed). (b) HMAC is computed over `JSON.stringify(input.body)` (`:188`), not the raw bytes; any re-serialisation difference makes valid deliveries fail. (c) Durable idempotency `WebhookIdempotencyService.claim()` is never called; middleware only uses the in-memory set. |
| Scheduled / CI-CD / Docker Hub / generic webhook triggers | MISSING | Trigger registry (`triggers/deployment-trigger-registry.service.ts`) has only `api` and `github-push` sources; no schedule, GitLab, registry, or generic signed webhook. |
| Cascade / dependency-ordered deploys | MISSING | `dependencyGraph` is only copied into the job payload (`deployment.service.ts:544-553`); nothing reads it. Cross-project dependency is rejected (`:385-394`). `FleetRolloutPlannerService` (`A/fleet/services/fleet-rollout-planner.service.ts`) is provided but has no caller. |

### Queue / state machine
| Feature | Status | Evidence |
|---|---|---|
| Job queue | PARTIAL | Entirely in-process `Map` + RxJS Subject (`A/deployment/queue/deployment-queue-lifecycle.service.ts:44-45,79`). No Redis/DB persistence, no pruning of finished jobs (memory growth). Mesh replication is best-effort and swallowed (`:449-467`). Serial single worker (`deployment-queue.worker.service.ts:124-125`) -> head-of-line blocking across all projects. |
| Retry / dead-letter | PARTIAL | Fixed 5s retry (`lifecycle:319`), max 5 attempts. `BASE_RETRY_POLICIES` (`deployment.service.ts:135-168`, exposed via `listRetryPolicies/resolveRetryPolicy`) are never consulted by the queue. Nest `BadRequestException` (used by workflow/runners) is not in the "permanent" class list (`worker:349-366`) so deterministic failures retry up to 5x with a full rebuild each time. DLQ replay endpoint works on the in-memory store. |
| Lease reaper | BROKEN | `lifecycle:595-650` resets expired jobs to `queued` but does NOT re-emit on `jobQueued$` (unlike the retry path `scheduleRetryReEmit`), so a reaped job is never re-executed. |
| Crash reconciliation | PARTIAL | `deployment-queue-reconciliation.service.ts:71-165`: only rows in `building` are failed/adopted. Rows in `queued`/`deploying` after a restart stay forever. Swarm adoption marks `success` without a health check. |
| Phase transition API (`listPhaseTransitions/validate/apply`) | STUB | Static table `deployment.service.ts:118-133` (phases `pulling_source/copying_files/creating_symlinks` etc. that the real pipeline does not use). `applyPhaseTransition` can `force` any phase write; the executor never consults it. |
| compilePlan / plan snapshots / template provenance / execution checkpoints / node lifecycle events | STUB | Pure in-memory maps (`deployment.service.ts:177-186,1112-1760`). `cancelExecution`/`resumeExecution` only mutate a map; they do not stop or resume anything. Nothing in the executor emits node events or reads snapshots. |
| Deployment events / SSE streams | PARTIAL | `deployment.stream*` endpoints exist (`controller:204-268`, `service:1839-2164`). Live events are emitted only for queued/cancel/rollback-created. The workflow (`deployment-execution-workflow.service.ts`) writes status/phase/logs to the DB but never emits `statusChanged/phaseUpdated/logAppended` (only `rollbackCompleted`). So a live SSE shows nothing during build/deploy; replay works from DB. `metricsSnapshot` events carry hard-coded zeros (`service:798-808,2236-2247`). Web does not consume streams (polls). |

### Build
| Feature | Status | Evidence |
|---|---|---|
| Dockerfile builder | REAL | `builders/strategies/dockerfile-builder.strategy.ts`, `DockerService.buildImage` (`packages/nest/docker/src/services/docker.service.ts:402-457`). |
| Custom build/run commands | REAL (limited) | Generated `FROM alpine:3.20` Dockerfile (`artifact-builder.service.ts:247-280`); regex CLI policy; installs bun via `curl | bash` at build time. |
| nixpacks / buildpack / railpack | STUB | `buildpack-family-builder.strategy.ts:52-60`: no toolchain, only works with custom commands on the alpine template; `isAvailable()` always true, UI/catalog advertises "auto-detect" (`packages/utils/provider-schema/src/catalog/builders.ts`). Runners are thin delegates to the plain docker runner. |
| docker_compose | PARTIAL (build only) | `docker-compose-builder.strategy.ts` (self-documented gap): builds, returns `image:null`, runtime runner then falls to nginx:alpine. `SwarmComposeRealizerService` (709 lines, `A/runners/swarm/swarm-compose-realizer.service.ts`) is registered (`runners.module.ts:41`) and called by nothing; docs mark SW-025 "landed". |
| Build log capture | MISSING | `followStream(stream)` called without progress callback (`docker.service.ts:455`); builder has no repository access; `buildLogsUrl` always null. Deployment logs contain only milestone lines. |
| Build cache / registry push / image pruning / workspace cleanup | MISSING | Images are local-only `deployer/<svc>:<dep>-<builder>`; no push; `GitService.cleanupDeployment` has no callers (workspace `/tmp/deployer-workspace/deployment-<id>` leaks); no image/container GC. |
| Build secrets / build args | MISSING | `buildImage` supports `buildArgs` but the builder never passes them. |

### Runners
| Feature | Status | Evidence |
|---|---|---|
| Plain docker runner (default) | PARTIAL | `A/runners/docker/docker-runtime-runner.service.ts`. Creates a container, starts, applies Traefik file route, health gate via Docker health (+ optional URL). Network only attached if `networkMode` explicit (`:59-69`), default is the node bridge, which the platform Traefik (on the platform overlay) cannot resolve by container name -> likely 502 unless `DEPLOYER_NETWORK_MODE` is set. Previous deployments' containers are never stopped (only same deploymentId, `:73-77`). Contradicts the "no plain container runtime" platform rule in `apps/api/AGENTS.md`. |
| Swarm runner (start-first, rollback-on-failure, overlay networks, placement) | REAL code, UNREACHABLE | `A/runners/swarm/swarm-runtime-runner.service.ts`. `swarm` is excluded from `deploymentRunnerKindSchema` (state machine `:17-24`) and from the trigger contract (`crud.ts:100-102`), and `triggerDeployment:455` calls `deploymentRunnerKindSchema.parse`. No path selects it. Even if selected: service name embeds the deployment id (`:100-102`) so each deploy creates a NEW service and the old one is never removed; healthcheck only when a URL is set (`:118-125`) so "converged" = task Running; no `endpointPorts`, no Traefik labels (routing is DB/file based). `removeService/scaleService/rollbackService` have no callers. |
| Dockerfile/nixpacks/buildpack/railpack/compose runners | STUB (delegates) | `A/runners/*/…-runtime-runner.service.ts` all delegate to docker runner via `DelegatedRuntimeRunnerBase`. |
| Storage bindings (local/volume/nfs/s3) | PARTIAL | local/volume/nfs mounted by docker runner (`docker-runtime-runner.service.ts:207-279`); s3 never mounted; swarm supports `volume` only (`swarm-runtime-runner.service.ts:451-473`). Per-node volume means no cross-node persistence. |
| Env vars / secrets into workload | PARTIAL | Passed as plain env strings from runtime config (`worker:587-613`, `workflow:1027-1053`); no secret store, no redaction, persisted in queue job result. |

### Lifecycle operations
| Feature | Status | Evidence |
|---|---|---|
| Rollback (execution) | REAL in monolith, BROKEN in `apps/api-services/services/runtime` | Monolith redeploys the target image (`workflow:231-304`, `service:1400-1436`). The services fork lacks this and marks success without touching the system (see section 3). Health-gated (10x5s) but no automatic rollback on failed deploy for docker runner; new route only flips after DB `success` (blue/green by accident via `platform-routes-source.service.ts:213-248`). |
| Rollback (UI) | BROKEN | `projects/[projectId]/deployments/page.tsx:139-146` calls rollback with only `params.id` (`as any`); contract requires `body.targetDeploymentId` (`crud.ts:234-237`). Service-level page has no rollback; the global page header text claims "roll back" there. |
| Cancel | BROKEN | `service:567-624` sets DB `cancelled` and emits events but does not remove/abort the queue job or the in-flight build/deploy. A queued job is later claimed and `markBuildExecutionStarted` flips the row back to `building`; a running job ends with `persistBuildArtifacts(status:'success')` (unconditional UPDATE, `repository:524-591`) overwriting `cancelled`. |
| Retry | PARTIAL | `service:875-944`: new row + job. Payload has no `executionPlan` (builder) -> same nginx fallback trap for github/upload; upload retry fails after restart (in-memory registry). UI only shows Retry for `failed` (global table), API also allows `cancelled`. |
| Delete deployment | PARTIAL | `service:864-873` deletes the row only; no status guard (contract claims 409 while running), no container/service/image teardown. |
| Zero-downtime / health-gated rollout | PARTIAL | See runners. Docker runner: new container + route flip after success, old kept running (leak). Swarm runner would do start-first but is unreachable. `deploymentStrategy` (rolling/blue_green/canary) is a config value consumed only by policy checks (`state-machine:323-327`); canary/blue-green are not implemented. |
| Deployment history / list | REAL | `deployment.list` with filters incl. `nodeId` (`repository:202-290`), global page `apps/web/.../dashboard/deployments/page.tsx` (latest 100, no pagination, filters/sort client-side). |
| Logs | PARTIAL | `getLogs` REAL (`service:813-862`); UI polls every 4s and only the first 500 lines (`deployment-logs-viewer.tsx`), so the tail of long runs is not visible. No live stream use. |
| Preview promote | REAL | `service:304-333` -> `DomainRoutingService.promotePreviewToStable`. Preview TTL cleanup timer exists (`preview-ttl-cleanup.service.ts`, setInterval 10 min). |

### Catalogs / contracts / docs
| Feature | Status | Evidence |
|---|---|---|
| provider-schema (API + package) | PARTIAL | Static catalogs only. Provider catalog lists `github` and `static` (not a real source type) and omits gitlab/upload/custom (`packages/utils/provider-schema/src/catalog/providers.ts`); github provider `buildContext` field is never consumed by the builder; catalog integrity test only checks builders vs `deploymentBuilderKindSchema`. Not derived from `BuilderRegistryService.supportedBuilders()`. |
| Contract/implementation drift | present | `swarm` runner in code but not contract; `delete` 409 documented, not implemented; `streamService`/`streamQuery`/`getLogs` etc. authorised only by `requireAuth()`. |
| docs/providers-runners-unification.md | OUTDATED | Describes the folder move (done) but still lists fake GitLab/Docker-Hub pages; docs/swarm-orchestration/IMPLEMENTATION_TODO.md marks SW-022/SW-025 "landed" though swarm is unselectable and the compose realizer is dead. |
| Tests | PARTIAL | 284 unit tests pass. e2e (`apps/api/src/e2e/deployment-workflows/`) cover project/service/traefik config, upload trigger, plan compile and queue lifecycle only (testcontainers). No e2e for build, run, health gate, rollback revert, cancel, webhook delivery, SSE. No web tests of trigger/rollback payloads (they use `as any`). |

### Duplicate code base
`apps/api-services/services/runtime/src/modules/{deployment,runners,providers}` is a diverged OLDER fork of the monolith modules: no rollback execution fix (`deployment.service.ts` / `workflow` lack `executeRollbackDeployment`, worker lacks the rollback branch), no builder registry/strategies, no trigger registry, no GitHub webhook controller, no provider-schema module. `docs/API-CUTOVER-STATUS.md` says the operator flips ingress to the BFF next; at that moment deployment behaviour regresses.

---------------------------------------------------------------------
## 2. What works end to end (verified in code)
1. Authenticated user with owner/maintainer/deployer role (or platform superAdmin/admin/operator) triggers a deploy for a service with a `dockerfile` builder (explicit `execution.builder`) from a public GitHub repo tip or an uploaded archive: row + log + queue job -> serial worker -> `docker build` -> container run -> health gate -> DB `success` -> ingress refresh -> route flips to newest successful deployment (provided `service.port` is set and the container is reachable by Traefik).
2. Prebuilt image deploy (custom provider) via the docker runner.
3. Deployment list/get/logs (DB-backed), rollback history, preview list/promote, DLQ list/replay (in-memory), retry-policy catalogue (read only).
4. Rollback to a previous successful deployment in the monolith, including health gate and `rollbackCompleted` event (API level only; UI broken).
5. Startup reconciliation of `building` rows; retry with exponential-ish fixed backoff for transient failures.
6. Unit/integration-style coverage of service, controller, worker, lifecycle, runners, registries.

---------------------------------------------------------------------
## 3. Broken / risky (ordered by severity)

Correctness (silent wrong results)
1. nginx fallback: a github/upload deploy without `execution.builder` (the UI's default) and every retry builds nothing, runs `nginx:alpine`, and reports success.
2. Webhooks cannot work today: secret key `github_webhook` has no writer; signature over re-serialised JSON; durable idempotency not wired. Push never deploys even if verified; PR previews are routes without a deployment.
3. Cancel does not cancel; cancelled rows are resurrected to `building`/`success`.
4. Lease reaper strands jobs; `queued`/`deploying` rows are not reconciled after restart; whole queue lost on restart.
5. Rollback UI never works (missing `targetDeploymentId`); `services/runtime` fork rolls back without reverting.
6. Old containers/services/images/workspaces are never removed: unbounded disk and port/CPU leak; delete only drops the row.
7. Default docker runner is likely unreachable via Traefik (bridge network); swarm runner (correct networking, start-first, rollback) cannot be selected.
8. Locally built images are never pushed: even if swarm were enabled, multi-node placement fails with "No such image".

Security
9. Command injection: `GitService.extractZip` shells `unzip -q "${filePath}"` via `execSync` (`git.service.ts:135`) and `filePath` can be the client-supplied `uploadPath` (`upload-source-provider.service.ts:97-109`, contract `crud.ts:55`). Also arbitrary server directory can be used as build context (`artifact-builder.service.ts:106-113`). Tar extraction has no path-traversal guard (`git.service.ts:144-146`).
10. Read/stream endpoints are `requireAuth()` only: any logged-in user can list, read logs, and subscribe to streams of any project's deployments (`controller:37-78,155-174,204-268`). `uploadBundle` has no role/size limit. `createCompiledPlanSnapshot`, `upsertTemplateProvenance`, `compilePlan` open to any user (memory writes).
11. `git clone` takes `--branch <user value>` unvalidated (option injection risk); `unzip` blocks the event loop.
12. Env vars (potential secrets) travel in plaintext through queue job results, `GET queue jobs` (any authenticated user can list/find jobs via `queueFindJobById/queueListJobs`, `controller:429-445`).
13. Custom build commands run arbitrary code in a root alpine build with `curl | bash` for bun.

Reliability / ops
14. Build output never captured; failures show only "build failed" messages.
15. Live SSE is effectively silent during build/deploy; metrics events are fake zeros.
16. Retry loops rebuild from scratch up to 5x for deterministic failures; failure persistence (`void persistDeploymentExecutionFailure`) runs even for retryable failures and races the retry's `building`.
17. Single worker, no concurrency control per service (two deploys of one service can interleave), no queue priority, no per-project quotas, no timeouts for build or deploy beyond lease heartbeats.
18. Health gate defaults: docker health only; no HTTP check unless URL; swarm health = task running; "Readiness health gate passed" log written unconditionally (`workflow:803-813`).
19. In-memory structures in `DeploymentService` (provenance, snapshots, checkpoints, lifecycle) are single-process and unbounded.
20. Code drift: duplicated runtime fork, stale docs claiming landed features.

---------------------------------------------------------------------
## 4. Required for production (ordered)
1. Fix silent success: resolve a default builder server-side (service.builderId / detect Dockerfile / require explicit choice) and fail the deploy when no image can be produced; remove the `nginx:alpine` fallback in both runners; include `executionPlan` in retry payload (persist it on the deployment row).
2. Make the swarm runner the default: add `swarm` to runner enum and contract, stable service name per (service, environment), reap old services, remove old docker containers, keep N previous images for rollback; set healthcheck from service config; verify Traefik reachability on the platform overlay for the docker path or drop that path.
3. Image distribution: push to a registry (platform-managed registry service or configured one) and pull by digest; add registry credentials; prune policy.
4. Webhooks: write `github_webhook` secret (or verify per app against `githubApps.webhookSecret` using `X-GitHub-Hook-Installation-Target-ID`), verify against raw body, call durable `claim()`, add a system/service-account actor, then dispatch push deploys via the trigger registry and real PR preview deployments (per-PR build, per-PR service name, teardown on close).
5. Private repo access: mint installation tokens for clone; GitLab clone + webhooks or hide GitLab.
6. Security hardening: server-owned upload paths only (derive from `uploadId`), remove shell interpolation (use Bun/`tar`/yauzl with traversal checks), size/type limits, role checks and project scoping on list/get/logs/stream/queue endpoints, secrets handling.
7. Durable queue: persist jobs (DB table via outbox), re-emit reaped jobs, reconcile `queued`/`deploying` on boot, honour cancel in the worker (check status before start, abort build via Docker API/AbortSignal, never overwrite terminal state), per-service lock, timeouts, bounded concurrency, queue pruning.
8. Real observability: stream `docker build`/service-update output into `deployment_logs` and emit `logAppended/statusChanged/phaseUpdated` from the workflow; web consumes streams with paging (tail, not first 500).
9. UI: fix rollback (choose target), non-github triggers, source/branch/commit/builder/runner pickers, upload flow, cancel/delete guards, remove dead components (`TriggerDialog`, `ProjectDeploymentsTable`, `ConfirmDialog` under `projects/[projectId]/deployments/_components`).
10. Decide the fate of `apps/api-services/services/runtime`: port the monolith changes (or generate it) before the BFF cutover; add a CI drift check.
11. e2e: build-run-health-route, rollback revert, cancel mid-build, webhook delivery with real signature, restart reconciliation.

---------------------------------------------------------------------
## 5. Recommended enhancements
- Replace the hand-rolled compose/plan/checkpoint/phase-transition surfaces with one executable pipeline (stages persisted as rows; the DAG from `compilePlan` actually drives execution) or delete the dead APIs to stop advertising features.
- Real buildpack support (nixpacks/railpack binary in a builder image or BuildKit frontends) instead of the alpine template; BuildKit cache mounts and registry cache.
- Wire `SwarmComposeRealizerService` for the compose runner or hide compose until done.
- Health gate: HTTP readiness path/port from service config, min-stable window, automatic rollback to previous deployment on gate failure for all runners.
- Retry policies from `BASE_RETRY_POLICIES` actually applied; error-code classification (permanent vs transient) instead of class lists.
- Derive provider/builder catalog from registries (`supportedBuilders()`, provider list) and test parity with trigger enums; add gitlab/upload/custom to the provider catalog.
- Deployment events through the outbox (already written) with a projector that feeds the stream bus, so live and replay share one source.
- Global deployments page: server-side pagination, filter by project/status, cancel/rollback actions, link to logs.

---------------------------------------------------------------------
## 6. Recommended new features
- Deploy-on-push/tag with branch filters, path filters, and GitHub status checks / PR comments (preview URL, deploy result); GitLab/Bitbucket/generic signed webhooks; deploy hooks (URL tokens) for CI.
- Scheduled and manual-approval deployments (`requireApprovalForProduction` already exists in project settings but is not enforced here).
- Canary/blue-green for real (Traefik weighted services), auto-rollback on error-rate.
- Cascade deploys across dependent services using the dependency graph, with topological ordering and partial-failure policy.
- Build logs download/retention, deployment diff (commit range, env changes), deployment notifications (push/email/webhook), audit trail.
- Preview environments with TTL, per-PR DB/env overlays (finish `PreviewEnvOverlayService`), auto-sleep.
- Remote/dedicated builder nodes, build concurrency per node, build queue visibility in UI.
- Image/volume GC policies and disk-pressure alerts.
