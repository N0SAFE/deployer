# Feature parity audit: v1 -> v2 -> v3 (verified against code, 2026-10-25)

Method: read v1/v2 module trees and web page trees, then grepped/read v3 code (`v3/apps/api`, `apps/api-services/*`, `apps/web`, `packages/*`).
Docs are treated as claims. "REAL" = implemented in service/controller AND reachable from contract (and UI where a UI is expected). "PARTIAL" = exists but gap named. "MISSING" = no code path.

Structural facts that frame everything (verified):
- v3 backend exists TWICE: monolith `v3/apps/api` (19 modules + `core/`) and the split `v3/apps/api-services/{bff,services/{fleet,health,identity,project,runtime}}` + `shared`. Ingress still defaults to the monolith (`docs/API-CUTOVER-STATUS.md`). Every fix must land in two trees (e.g. `project.controller.ts` exists in both with the same NotImplementedException).
- Contracts are no longer `packages/contracts/api`. They are `packages/contracts/{bff,common,entities,fleet,health,identity,project,runtime}`. Nearly every v3 planning doc cites the dead path.
- No Organization concept in v3 (Better Auth `organization` plugin absent; `packages/auth/src/server/auth.ts` plugins = admin, apiKey, multiSession, masterToken, loginAs, openAPI, invite, push, passkey, twoFactor, deviceAuthorization, lastLoginMethod). v1/v2 had `organization/select` page and org-level domains.
- Test counts: apps/api 153 spec files, api-services 139, web 61 test files.

---------------------------------------------------------------------------------------------------

## 1. v1 -> v3 parity matrix

Legend: Y = present, P = partial, - = absent. v3: REAL / PARTIAL / MISSING / NEW (beyond v1).

### 1.1 Platform & identity
| Feature | v1 | v2 | v3 status | Evidence |
|---|---|---|---|---|
| Email auth, sessions (Better Auth) | Y | Y | REAL | `packages/auth/src/server/auth.ts`; web `auth/{signin,signup,me,error}` |
| 2FA / passkeys / device auth / multi-session | - | - | NEW, REAL | `useTwoFactor`, `usePasskey`, `useDeviceAuthorization`, `multiSession` in auth.ts; `dashboard/settings/account/page.tsx`, `app/device/page.tsx` |
| Personal API keys | table only | table only | REAL (via Better Auth `apiKey` plugin) | `useApiKey()` in auth.ts; `domains/account/hooks.ts:308-347` (`authClient.apiKey.*`). Legacy `ApiKeyService` + `api_keys` table in `modules/project/` are dead leftovers |
| CLI for the platform | - | - | MISSING | `apps/` = api, api-services, doc, mesh-agent, setup, web. Only nest-commander admin commands (`apps/api/src/cli/commands`: migrate, seed, setup-db, backfill-env-secrets, create-default-admin). Device-auth exists with no client |
| Organizations / org select | Y | Y | MISSING (removed, replaced by platform roles) | no org plugin; `permission` module + `RequirePlatformRole`; root `AGENTS.md` still lists organization module |
| User admin (list/ban/role/create) | P | Y | REAL | `dashboard/settings/users/page.tsx` uses `useAdminListUsers`, `useAdminActions` |
| Project collaborators/roles | Y | Y | REAL | project contract `collaborators/*`; `dashboard/projects/[id]/team/page.tsx`; invites via `useInvite` |
| Setup wizard / first-run | Y | Y | REAL, expanded | `apps/setup`, `modules/setup`, web `/setup`, `post-setup-*` services |
| Rate limiting | - | - | PARTIAL | `core/modules/rate-limit/rate-limit.middleware.ts` exists; no per-identity quotas UI |
| User-facing audit log | - | - | MISSING | no audit service/table; only internal `core-event-log.repository.ts` (event outbox) |
| Web push (subscribe/send) | - | Y | PARTIAL | API + `PushNotificationSettings` on `/auth/me`; but nothing emits a push on deployment/health events (only user-initiated `sendToUser` test) |

### 1.2 Projects, services, environments
| Feature | v1 | v2 | v3 | Evidence |
|---|---|---|---|---|
| Project CRUD, settings | Y | Y | REAL | `modules/project/controllers/project.controller.ts` (create/update/delete/config get+update general/deployment/security/resource) |
| Service CRUD, parent/child, subtree | Y | Y | REAL | service contract `crud.children/subtree` |
| Service dependency graph | Y | Y | REAL (view) / P (editing UI) | `dependencies.{list,add,remove}`; web `dependencies/page.tsx` (169 lines) |
| Cascade deploy of dependents | Y (v1 brief) | Y | PARTIAL | fleet `service-dag.service.ts`, `fleet-rollout-planner`, `fleet-rollback` exist; no evidence deployment trigger cascades dependents from the product path - treat as unproven |
| Multi-environment (prod/staging/preview/dev) | Y | Y | REAL | `listEnvironments/create/update/delete/cloneEnvironment`, `listServiceEnvironmentLinks`; web `environments/page.tsx` |
| Env vars per service | Y | Y | REAL but PLAINTEXT | UI edits `service.environmentVariables` = `jsonb` on `services` (`packages/nest/schema/src/global/project/deployment.ts:118`); also jsonb on deployments/previews. See section 2 |
| Encrypted `environment_variables` table | - | - | DEAD | `encryptedText("value")` in `.../environment.ts:215`, but the only importer of the table is `backfill-env-secrets.command.ts`. No repo/service reads/writes it |
| `isSecret` semantics | - | - | MISSING | grep `isSecret` in apps/api: only migrations/snapshots; web masks all values with an eye toggle |
| Dynamic/templated variables | schema | schema | MISSING | `isDynamic`, `resolvedValue`, `resolutionStatus` only in schema file |
| Variable templates (project-level) | Y (`variable-templates`) | Y | REAL | `list/get/create/update/deleteVariableTemplate`; `VariableTemplatesCard.tsx` |
| Environment promotion | schema | schema | MISSING | `environmentPromotions` only in schema |
| Service resource limits (cpu/mem) | Y | Y | REAL (stored+UI) | `configuration/general/page.tsx`; runners consume |
| Service health-check config | Y | Y | PARTIAL | `healthCheckPath/Interval/...` in schema; runner uses `healthCheckUrl` at deploy only; no continuous probing |
| Deployment retention / cleanup | Y (`maxDeployments`) | Y (`cleanup` module, zombie reconciler) | MISSING (settings inert) | `deploymentRetention` merged in `service-effective-config.ts` and edited in UI, but nothing enforces it; no image/container prune; no zombie reconciler |
| Notification settings (email/slack) | Y (fields) | Y | MISSING delivery | fields only in `project.service.ts` get/update + `ProjectConfigSections.tsx`; no sender anywhere (no smtp/slack client) |
| Templates / marketplace (one-click apps) | - | - | MISSING | `templateContract` mounted in BFF `app-contract.ts` and web `app-contract.ts` but no controller anywhere implements `template.*` |
| Managed databases (user-facing PG/MySQL/Redis) | - | - | MISSING | only platform's own `database-service-supervisor` |

### 1.3 Deployment engine
| Feature | v1 | v2 | v3 | Evidence |
|---|---|---|---|---|
| Trigger deploy | Y | Y | REAL | `deployment.controller.ts` trigger |
| Deployment queue + workers | Y (Bull+Redis) | Y | REAL, reimplemented | `deployment-queue.worker.service.ts` in-process typed queue, dead-letter list/replay, claim/heartbeat contracts (Bull removed) |
| Deployment logs | Y | Y | REAL | `getLogs` + `deployment-logs-viewer.tsx` |
| Cancel | Y | Y | REAL | `cancel`, `cancelExecution`, `resumeExecution` |
| Retry | P | Y | REAL | `retry`, retry policies |
| Rollback | P | Y | REAL | `rollback`, `getRollbackHistory`, `compileRollbackEdges`; web `deployments/page.tsx` uses `useRollbackDeployment` |
| Deployment state machine / phases | Y | Y | REAL | `validatePhaseTransition`, `applyPhaseTransition` |
| Build strategies | dockerfile, nixpacks | same | REAL, wider | runners: dockerfile, docker-compose, buildpack, nixpacks, railpack, docker, swarm; builders registry |
| Source: GitHub (app/OAuth/PAT/manifest) | Y | Y | REAL | `github-account.controller.ts` (manifestInit/oauthInit/installCallback/createFromPat/listRepos/listBranches/detectRunner) |
| Source: GitHub webhooks (push, PR previews) | Y | Y | REAL | `github.webhooks.controller.ts`, `github-webhook-dispatch`, `webhook-idempotency`, `preview-provisioning`, `preview-ttl-cleanup` |
| Source: GitLab | Y(brief) | P | PARTIAL | account CRUD + checkout provider only; no webhook controller, no MR previews |
| Source: generic Git / custom | Y | Y | REAL | `custom-source-provider.service.ts` |
| Source: ZIP upload | Y | Y | REAL | `upload-source-provider`, `upload-bundle-registry`, `uploadBundle`, web `file-upload-link.ts` |
| Source: Docker image / private registry | - | - | PARTIAL | runtime `docker` runner; registries contract is `list` only; UI page `admin/providers/code/docker-hub` is explicitly "unavailable" |
| Static site hosting (nginx) | Y (`static-file` module) | Y | MISSING | no static runner; GitHub controller comments "A static site has no builder in the deploy path" |
| GitHub deployment rules (branch/glob) | Y (`deployment-rules.controller`) | Y (`rule-matcher`) | PARTIAL | `github-deployment-rule.service.ts` + repo exist; no contract/controller/UI to manage rules |
| Preview environments (per PR/branch, subdomain, TTL) | Y | Y | REAL | preview topology contracts, `previews/page.tsx`, `configuration/preview/page.tsx`, TTL cleaner (10 min interval) |
| Build cache | - | - | MISSING | not found |
| Approval gates / strategies (blue-green, canary) | - | - | MISSING | not found |
| Storage providers (local/nfs/volume/s3) | Y (storage module) | Y | PARTIAL | `deployment/storage/{local,nfs,s3,volume}` as artifact providers; no backup/restore feature |
| Backup/restore (v1 storage backups) | Y (create/list/restore/delete/download) | P | MISSING | no backup feature in v3 apps (grep `backup` hits only traefik config/test harness) |

### 1.4 Networking & edge
| Feature | v1 | v2 | v3 | Evidence |
|---|---|---|---|---|
| Traefik dynamic routing | Y | Y | REAL | `core/modules/traefik` (config builders, sync, file system, variable resolver) |
| Let's Encrypt/ACME | Y | Y | REAL (config) / PARTIAL (visibility) | `TRAEFIK_ACME_RESOLVER`, `certResolver`, `traefik-ingress-config.service.ts`; no per-domain cert status UI; v1 `ssl-certificate.service` (cron renewal tracking) and project `ssl` tab have no v3 equivalent |
| Domain management (project/service level, verify, primary) | Y | Y (+org) | REAL | `domain` controllers (13 procs), `domain-verification.service`, web `domains/page.tsx`, `network/domains` |
| DNS providers | - | - | PARTIAL | Cloudflare only (DNS + tunnel + app); web pages for Route53/Google DNS are "unavailable" stubs |
| Cloudflare tunnel edge, mesh, WireGuard, reachability | - | - | NEW, REAL | `providers/edge/cloudflare-tunnel`, `core/modules/edge`, `reachability`, `apps/mesh-agent`, web `network/{ingress,dns,mesh,domains}` |
| Traefik admin UI (v1 `/dashboard/traefik`) | Y | Y | PARTIAL | `network/ingress` page (83 lines); no router/service/middleware editor |
| Wildcard domains | - | - | MISSING | not found |

### 1.5 Observability & ops
| Feature | v1 | v2 | v3 | Evidence |
|---|---|---|---|---|
| Analytics (deployment metrics, usage, service health, realtime) | Y | Y | REAL | analytics controller (21 procs); `analytics/page.tsx` (4 queries) |
| Analytics reports (generate/download/config) | - | - | PARTIAL | API real (generateReport etc.); no web UI consuming it |
| Service health | Y (`health-check.service` probes) | Y | PARTIAL | `getServiceHealth` derives from latest deployment status (`analytics.service.ts:179-190`), no active probes |
| Health alerts | schema | schema | MISSING | `alertOnFailure/alertWebhookUrl/alertEmail`, `healthCheckJobs` only in schema |
| Resource monitoring | Y | Y | REAL | `system-metrics` module, container metrics streams, `platform-vitals` |
| Realtime (WebSocket gateway) | Y | Y | REAL (SSE/oRPC iterators) | many `stream*` procedures; mesh relay; web hooks |
| Container/Docker management UI (containers, images, networks, volumes, logs, shell) | P (`containers`) | Y | REAL, much larger | `dashboard/docker/{activity,containers,images,logs,networks,shell,volumes}` ; API 8 domains + security scan |
| Docker stacks / registries / swarm services / secrets / configs UI | - | - | MISSING (API list only for stacks/registries) | no web pages for stacks, registries, events; contracts `stacks/list.ts`, `registries/list.ts` only |
| Log retention / pruning | - | - | MISSING | none |
| Cluster/node management | basic swarm | Y | REAL, expanded | cluster + fleet controllers (admission, allocations, nodes, services, tasks, streams); web `cluster`, `nodes/*` |
| Jobs UI (v1 project `jobs` tab) | Y | Y | MISSING UI | queue/dead-letter contracts exist; no page |
| Activity feed (v1 project `activity` tab) | Y | Y | PARTIAL | `docker/activity` page only; no project-level activity |
| Project monitoring tab | Y | Y | PARTIAL | service-level `monitoring/page.tsx` (163 lines); no project-level |

### 1.6 Developer/runtime meta
| Feature | v1 | v2 | v3 | Evidence |
|---|---|---|---|---|
| Provider schema (dynamic forms) | Y | Y | REAL | `provider-schema` module + `packages/utils/provider-schema` |
| OpenAPI | - | - | NEW | `openapi.ts`, BFF `openapi-docs.controller.ts` |
| Per-service logs (stdout) page | Y | Y | PARTIAL | `services/[serviceId]/logs/page.tsx` renders `projectServiceActivity` (deployment/mesh/replica status events), not container stdout (`_utils/service-activity.ts:51` says wiring pending). Stdout lives in `docker/logs` |
| Web terminal (exec) | - | - | REAL | `docker/shell/page.tsx` + terminal stream contract |

---------------------------------------------------------------------------------------------------

## 2. Stale / false claims in v3 planning docs

### 2.1 Directly false against code
| Doc | Claim | Reality |
|---|---|---|
| `docs/feature-gap-catalogue.md` S-1 "env var secrets stored in plaintext", marked fixed in code comments | Schema now says `encryptedText`, a backfill command exists, catalogue is "stale" on the table | **Worse than either claim**: the encrypted table `environment_variables` has zero readers/writers outside the backfill. Real user variables are plaintext `jsonb` columns `services.environment_variables`, `deployments.environment_variables`, preview/deployment-override copies (project/runtime/fleet `deployment.ts`). The "fix" protects an unused table. |
| gap catalogue D-1 "no deployment rollback flow" | `grep rollback` returns only schemas | `rollback`, `getRollbackHistory`, `compileRollbackEdges` implemented in controller+service; web uses `useRollbackDeployment` |
| gap catalogue D-6 "no cancel endpoint" | none | `cancel`, `cancelExecution` implemented, UI uses `useCancelDeployment` |
| gap catalogue A-2 "API keys unreachable" | dead service | replaced by Better Auth apiKey plugin, UI in account page; only the legacy dead service remains |
| gap catalogue A-1 "admin users API-only" | all unused | `settings/users` page uses `useAdminListUsers/useAdminActions` |
| gap catalogue N-3 "Mesh has no UI at all" | `find -ipath *mesh*` empty | `dashboard/network/mesh/page.tsx` (146 lines) |
| gap catalogue X-3 "push UI dark" | hooks unused | `PushNotificationSettings` on `/auth/me`; (real gap is no event-triggered sends) |
| gap catalogue W-1 "62 pages / 5 loading / 4 error / 1 not-found" | | now 70 pages; counts otherwise still ~correct (5/4/1) |
| gap catalogue A-3 "apps = api, doc, web" | | apps now api, api-services, doc, mesh-agent, setup, web (still no CLI - claim of absence holds) |
| `docs/feature-status/README.md` / `EXHAUSTIVE-FEATURE-LIST.md` | "Organization CRUD+members+invites WORKING", "Admin Organizations WORKING" | no organization code |
| same | "Docker (all 10 pages)", Docker Stacks / Registry / Events pages WORKING | web has 7 docker dirs; no stacks, registries, events pages |
| same | "Fleet - no controller needed (internal)" | `fleet.controller.ts` has 15+ procedures incl. admission/allocations |
| same | "Project config / Service pages: null-data UI shells" | pages are 160-370 lines of real hooks; general/network/provider/environment/preview configs are wired |
| same | "Test coverage: API 108 specs, web 10" | 153 / 61 (+139 in api-services) |
| `docs/feature-status/README.md` "Traefik PARTIAL (7 tests)", `Mesh 15 tests` | | traefik module far larger; mesh has controller/service/mesh-agent |
| `docs/enhancement-overview-100.md`, `...platform-100.md`, `implementation-plan-200.md`, `enhancement-audit-2026-08-12.md` | every file reference to `packages/contracts/api/modules/...` | path does not exist; contracts re-split into 8 packages. Items about `enabledEnvironments`, service logs ("KNOWN GAP") partially still valid but line refs useless |
| `enhancement-audit-2026-08-12.md` | `eventSyncContract` orphan; "only 3 `.errors()` sites, all mesh" | catalogue (2026-09-17) already found `.errors` universal; events contract moved to `contracts/fleet/modules/events`; the August doc is superseded and contradicts the catalogue |
| `implementation-plan-200.md` | "CI never runs type-check", "617 unchecked boxes" | not re-verified here; premise stale given cutover doc reports 0 production type errors |
| `dead-code-audit-report.md` | lists `apps/api/src/system/modules/fleet`, `core/gateway`, `contracts/mesh`, `state-machine`, `sub-app-runner` as dead | most are already deleted (system/ holds only README/AGENTS; gateway dir gone); doc itself says cleanup done but the body still lists them |
| Root `AGENTS.md` "V3 Module Inventory: health/user/organization partial/test; everything else not ported" and "Stack: ORPC 1.13, Bull queues, Redis" | | 19 api modules + 5 services + BFF; Bull removed; deployment queue is in-process; Redis only a platform supervisor |
| Root `AGENTS.md` feature roadmap list (project, service, deployment, github, traefik, domain, analytics, jobs, push, cleanup ...) as "not yet in v3" | | all but storage-backup, static-file, ci-cd pipelines, cleanup are present |
| `v1/memory-bank/progress.md` | contains v3-era entries (mesh, docker, setup 2026) - memory bank was overwritten with v3 notes; it no longer documents v1 | v1 truth is `v1/MIGRATION-FEATURE-INVENTORY.md` |
| `docs/v2-v3-project-pages-comparison.md` | header `$(date +%Y-%m-%d)` literal; says project services tab / dependency CRUD missing in v3 | `services/page.tsx`, `dependencies/page.tsx`, `environments/page.tsx` exist now |

### 2.2 Still true (confirmed in code)
- Dynamic vars, `environment_promotions`, `health_check_jobs`, health alert columns: schema-only.
- Notification settings: no sender; push has no event hookup.
- `refreshEnvironmentStatus` throws `NotImplementedException` (both `project.controller.ts` copies, line 388).
- `template` contract: mounted, zero implementations.
- No audit log, no log retention, no CLI, no analytics-report UI, no fleet-admission UI (`useMyFleetAdmission*` unused in app).
- Route states (5 loading / 4 error / 1 not-found over 70 pages).

---------------------------------------------------------------------------------------------------

## 3. Competitive gap list (vs Coolify / Dokploy / Dockhand), ranked

Benchmarks: Dokploy README (apps, databases, backups, compose, multi-node, templates, Traefik, monitoring, CLI/API, notifications, multi-server); Coolify models (ScheduledTask, ScheduledDatabaseBackup, S3Storage, Notification settings x6, SslCertificate, Standalone{Postgresql,Mysql,Mariadb,Mongodb,Redis,...}, PrivateKey, SharedEnvironmentVariable, Tag, Team, GithubApp/GitlabApp, DockerCleanupExecution, Cloud provider tokens); Dockhand (auth/RBAC, audit log (enterprise), terminal, compose stacks editor, git stacks, vulnerability scan, auto-update, notifications).

| Rank | Gap | v3 state | Why table-stakes |
|---|---|---|---|
| 1 | Secrets protection (encrypt real env store, honor `isSecret`, mask in logs/UI/API) | plaintext jsonb | All three competitors encrypt/hide secrets; this is a security defect, not a gap |
| 2 | Notifications on deploy success/failure/service down (email/Slack/Discord/Telegram/webhook) + outbound webhooks | settings only, no sender | Dokploy/Coolify headline feature; the UI already collects the config |
| 3 | One-click templates + managed databases (PG/MySQL/MariaDB/Mongo/Redis) | template contract unimplemented; no DB provisioning | Dokploy/Coolify onboarding story; v3 can only deploy user code/images |
| 4 | Backups (DB + volume, S3 destinations, schedule, restore) | none (v1 had storage backups) | Dokploy/Coolify core; S3 provider exists as artifact store only |
| 5 | Scheduled tasks / cron jobs per service | none | Coolify ScheduledTask, Dokploy schedules |
| 6 | Private registries (credentials, pull secrets) and Docker-image deploys | list only; UI says "no place to store credentials" | Needed for any non-public image |
| 7 | Cleanup/retention (old deployments, images, containers, build cache, logs, zombie reconciliation) | settings inert; v1/v2 had zombie cleanup | Coolify DockerCleanupExecution; disk fills on a VPS |
| 8 | GitLab webhooks + MR previews; Gitea/Bitbucket; auto-deploy rules UI | GitLab checkout only; rules have no UI | Parity with GitHub path; Coolify/Dokploy support all three |
| 9 | Static site / SPA hosting without a Dockerfile | missing (v1 had it) | Vercel/Netlify-style baseline, explicitly in the v1 brief |
| 10 | Audit log and per-user activity | none | Dockhand (enterprise), Coolify teams; ops/compliance |
| 11 | CLI + token auth | device-auth + API keys exist, no CLI | Dokploy CLI/API; backend already done, last mile missing |
| 12 | Teams / organizations / multi-tenant boundary | removed; flat platform roles | Coolify Teams; reconsider only if multi-user is a goal (operator is mesh-first/solo, see memory) |
| 13 | Health checks + alerting with real probes, uptime history | derived from deployments; alerts schema-only | Dokploy monitoring, Coolify health checks |
| 14 | Compose stack editor/stacks UI, registries UI, swarm services/secrets/configs UI | API partial, no pages | Dockhand core; Dokploy compose native |
| 15 | Wildcard domains + per-domain cert status | missing | Coolify SslCertificate model |
| 16 | Environment promotion, shared (cross-project) variables, dynamic variable references | schema only | Coolify SharedEnvironmentVariable |
| 17 | Build cache, build concurrency limits, historical build logs | missing | Perf and debuggability |
| 18 | Remote servers over SSH (agentless) | mesh-agent model instead | Coolify/Dokploy default; v3 intentionally different (mesh first), so low priority |
| 19 | Vulnerability scanning surfaced in deploy flow | scan exists for images (security tab) | Dockhand parity item, v3 already ahead of Coolify/Dokploy |
| 20 | i18n, command-palette actions, global search | missing | polish |

Where v3 is ahead of all three: mesh/WireGuard + Cloudflare tunnel ingress, fleet admission/allocations, typed contract-first API with BFF, passkeys/2FA/device-auth/agent-auth, queue with dead-letter/resume checkpoints and deployment plan snapshots, preview topology.

---------------------------------------------------------------------------------------------------

## 4. Recommended features to port/build first

Order is chosen for (value x reuse of already-built backend) and to retire false claims.

1. **Encrypt the real env store (service/deployment/preview `environment_variables` jsonb).** Either route the UI through the encrypted `environment_variables` table or apply an encrypted-json codec to the jsonb columns; make `isSecret` drive masking; then delete the unused-table illusion. Do it once in `packages/nest/schema`, apply to both backend trees. Update the catalogue.
2. **Notification delivery.** Subscribe to existing deployment lifecycle + health events (`deployment-event.service`, `deployment-queue-event`), send via a small provider registry (webhook, Slack, Discord, Telegram, SMTP, web push). Settings fields, push infrastructure and event bus already exist. Add outbound-webhook retry/backoff.
3. **Retention/cleanup worker.** Enforce `deploymentRetention` (data and the UI already exist), prune dangling images/containers/old artifacts, reinstate v2 zombie reconciliation as a supervisor. Cheap and prevents VPS disk exhaustion.
4. **Implement `template` contract + a built-in catalogue (databases first).** Contract, entity schemas and compatibility/migration schemas exist in `packages/contracts/bff/modules/template`; add controller + 10-15 templates (Postgres, MySQL, Redis, Mongo, Plausible, etc.) deploying via the existing compose runner.
5. **Backups.** Scheduled DB dump / volume tar to S3 using the existing `s3-storage-provider`; restore flow. Pair with a small scheduler (cron service) which also unlocks scheduled tasks.
6. **Registry credentials + Docker-image deploys.** Add an encrypted credential table (pattern: dns/github providers), registries CRUD contract, swap the "unavailable" admin page for real UI, pass `authconfig` on pull.
7. **GitLab webhooks + MR previews; deployment-rule CRUD + UI.** Reuse GitHub dispatch/idempotency/preview-provisioning abstractions; add `deploymentRule` contract.
8. **CLI.** API keys and device-auth are done; ship a thin `apps/cli` over the BFF contract (deploy, logs, status, env set).
9. **Active health probes + alerts** (wire `healthCheckJobs` or delete it), project-level monitoring/activity tabs, service stdout logs page (compose `useDockerContainerLogsSnapshot` + `useDeploymentLogs`).
10. **Static-site runner** (nginx or Caddy sidecar) to restore v1 parity.
11. **Audit log** (append-only table fed from the existing event bus + auth hooks).
12. **Decide and prune**: remove dead pieces (legacy `ApiKeyService`/`api_keys`, `environment_promotions`, `health_check_jobs`, dynamic-variable columns) or schedule them; finish the api-services cutover so every fix above lands once.

Documentation housekeeping to do alongside: rewrite root `AGENTS.md` module inventory, retire `docs/feature-status/*` and the two overview-100 docs in favor of a single re-verified catalogue with current paths, and correct the S-1 entry per section 2.1.
