# 100-Point Platform Enhancement Overview

Whole-platform audit of `/home/sebille/Bureau/projects/tests/deployer/v3` — `apps/api`, `apps/web`,
`apps/doc`, `packages/*`, `docker/*`, `.github/workflows/*`, `docs/*`. Audited 2026-09-15.

**Tags.** Every item carries exactly one: `[unfinished]` — specified or partially built, not complete;
`[correctness-gap]` — works wrong, fails silently, or lies to a caller; `[deepen]` — exists and works,
could be materially better; `[new-feature]` — does not exist, should.

**Confidence.** ⚑ = verified this audit by reading the file or running the grep (file:line given).
Unmarked items derive from scoped negative searches or from the platform's own TODO ledger; treat them as
well-founded but unconfirmed at line level.

**Headline.** `docs/PLATFORM_SOURCE_OF_TRUTH_TODOS.md` specifies 191 platform statements with **617
unchecked checkboxes and zero checked**. Nine statement clusters have no code at all (§A). Separately,
four CI jobs do not do what their names claim (§C), and two registered API contracts have no
implementation anywhere (§D).

---

## A. Specified but unbuilt — the phantom surface (1–12)

**1. ⚑ The setup state machine has no API surface.** `setupStateMachineSchema` is fully defined at
`packages/contracts/entities/src/entities/setup/state.schema.ts:61` (states, transitions, initialState,
terminalStates), but `getStateMachine` appears **only** in `apps/api/src/e2e/setup-workflows/*.e2e-spec.ts`.
There is no contract operation and no controller, so the wizard's own e2e tests call a phantom endpoint.
`[unfinished]` `M`

**2. ⚑ Setup cannot be resumed.** `resumeSetup|resume_setup` returns zero hits repo-wide. `resume` exists
only for deployments (`packages/contracts/api/modules/deployment/execution.ts:40`) and mesh peers
(`mesh-peer-session.service.ts:194`). A setup abandoned at step 4 restarts from zero. `[unfinished]` `M`

**3. ⚑ Node identity bootstrap does not exist.** Node identity is a single field —
`nodeId: z.uuid()` in `packages/contracts/entities/src/entities/setup/node.schema.ts:4-7`. No code path
generates, persists, or re-establishes node identity across a rebuild. `[unfinished]` `M`

**4. ⚑ Compose stacks exist only as configuration.** The concept appears three times and nowhere else: a
runner config variant (`service/runner-config.schema.ts:18 composeStackRunnerConfigSchema`), a string
literal (`swarm-compose-realizer.service.ts:502 "compose_stack"`), and a web form
(`StepRunner.tsx:698 ComposeStackFields`). No entity, no Drizzle table, no contract module, no lifecycle,
no timeline, no stack-level rollback. Rollback is deployment-level only. `[unfinished]` `L`

**5. ⚑ Managed databases are not a platform feature.** Zero contracts, zero entities, zero tables.
Every `managedDatabase|managed_database` hit is an env var (`packages/utils/env/src/index.ts:387-398`).
The only supervisors present manage the platform's **own** databases
(`core/modules/supervisors/database/global-db-supervisor.service.ts:174 isManagedDatabase()`), not
user-provisioned ones. `[unfinished]` `L`

**6. ⚑ No backup, restore, or DB audit.** `backupPolicy|backup_policy|dbAudit|databaseAudit` return zero
hits. The one `backup` table is `traefik_backups`
(`apps/api/src/config/drizzle/global/schema/traefik/index.ts:177`) — unrelated. There is no restore path
at all. `[unfinished]` `L`

**7. ⚑ Incidents are vocabulary with no implementation.** `incidentSeveritySchema` and
`incidentStatusSchema` are exported from `packages/contracts/common/src/operations.schema.ts:6-10` and
have **zero importers**. The only other trace is a test-only `mockIncidentSchema`
(`platform-domain.builder.ts:372`). No table, service, repository, or contract. `[unfinished]` `L`

**8. ⚑ Alert rules are stored and never read.** `apps/api/src/config/drizzle/global/schema/health.ts:48-50`
defines `alertOnFailure`, `alertWebhookUrl`, `alertEmail`. A grep for consumers of
`serviceHealthConfigs`/`alertOnFailure` returns only the schema file itself. The columns exist, the
feature does not. `[unfinished]` `M`

**9. ⚑ Notification channels do not exist beyond Web Push.** No `resend`, `nodemailer`, `sendgrid`,
`@slack`, `discord` or `telegram` in any `package.json`. `notificationChannelSchema`
(`operations.schema.ts:12`) is exported and unused. The only real sender is
`modules/push/services/push.service.ts:186` (`webpush.sendNotification`), triggered solely by
`push.controller.ts:93` — no event hook fires it automatically. `[unfinished]` `L`

**10. ⚑ Outbound webhooks do not exist.** The `webhooks` table
(`config/drizzle/global/schema/deployment.ts:426`) is **inbound** — it stores `sourceType`, an HMAC
`secret`, and `webhookUrl` meaning "our endpoint". Every other webhook handler is a Git-provider ingress
(`github.webhooks.controller.ts`, `webhook-idempotency.service.ts`). Nothing lets an operator subscribe
to platform events. `[unfinished]` `L`

**11. Docs-governance tooling is absent** (S155–S160, ~19 checkboxes). No CI doc-lint, no divergence
template. Documentation accuracy rests entirely on manual diligence — which §N shows is failing.
`[unfinished]` `M`

**12. Mesh peer scoring and rebalancing are absent** (S183–S185). `peerDegree|peerScore|meshPing` return
zero hits. `core/modules/swarm/election/master-scorer.ts` implements leader-election hysteresis, which is a
different mechanism. `[unfinished]` `M`

---

## B. Stubs, fabricated data, and silent lies (13–24)

**13. ⚑ `refreshEnvironmentStatus` reports success without checking anything.**
`apps/api/src/modules/project/controllers/project.controller.ts:398` carries
`// TODO: trigger actual health check` and returns `success: true` with the unchanged DB status. The chain
is live: contract `project/utils/environments/refresh-status.ts:5` → hook
`apps/web/src/domains/project/hooks.ts:307-313` → UI
`environments/page.tsx:80,383-384`. The user clicks refresh, a spinner runs, invalidations fire
(`invalidations.ts:149-159`), and the same stale badge re-renders. **A silent no-op presented as a working
control.** `[correctness-gap]` `S`

**14. ⚑ `servicesCount` is hardcoded to zero.** `project.controller.ts:368` and `:385` both carry
`servicesCount: 0, // TODO: join with services`. Two endpoints report a project has no services
regardless of reality. `[correctness-gap]` `S`

**15. ⚑ `resolveVariables` returns placeholders as resolved values.**
`project.service.ts:745-749` replaces `${VAR}` with `<VAR>` and returns `variables: {}`. It ships through
the typed contract `project/utils/variables/resolve.ts:4`, registered at `project/index.ts:101`. **No
consumer exists** — no hook, no page — so user impact is currently nil. It is a loaded gun: the first
caller to trust it gets a string that looks resolved. `[unfinished]` `S`

**16. ⚑ `getAvailableVariables` returns empty collections.** `project.service.ts:758-762` returns
`variables: []` and `scopes: []` under `// TODO: integrate with variable-resolver module`. The referenced
`variable-resolver` module does not exist. `[unfinished]` `S`

**17. ⚑ Fleet capacity updates return a fabricated allocation summary.**
`modules/fleet/services/fleet.service.ts:82` returns hardcoded `{ services: 0, cpuMillicores: 0,
memoryMb: 0 }`, while `listServers` (`:51-67`) computes the real aggregate. The mutation result is
discarded by the client (`domains/fleet/hooks.ts:123-129`) and `invalidations.ts:5-7` refetches the real
data, so **there is no observable defect today** — only a response body that contradicts the system.
`[correctness-gap]` `S`

**18. ⚑ The test module ships 14 hardcoded payloads in the production route table.**
`apps/api/src/modules/test/controllers/test.controller.ts` returns static objects from 14 handlers (six
NestJS routes at `:234-335`, eight ORPC handlers at `:358-492`), and `TestModule` is registered in
`apps/api/src/app.module.ts:173`. `test.controller.ts:218` also injects `AuthService` while
`test.module.ts:21` imports only `ConfigurationCoreModule` — workable only if `AuthModule` is `@Global`,
which is an unverified assumption. Demo scaffolding is load-bearing in the real route table.
`[correctness-gap]` `M`

**19. ⚑ The Traefik config builder cannot read, update, or remove.** `getRouter()`, `updateRouter()`,
`removeRouter()` (and siblings) are documented as **not implemented** in
`core/modules/traefik/docs/API-REFERENCE.md:868` and `CONFIG-BUILDERS.md:80`. Modifying router config
requires `build()` → mutate raw object → `load()`, which discards builder invariants. **The builder is
write-once.** `[unfinished]` `M`

**20. ⚑ Static-file deletion is unimplemented.**
`core/modules/traefik/services/traefik-file-system.service.ts:891` logs
`Cannot delete static file ${filePath} - delete method not implemented` and returns. Traefik static files
accumulate permanently. `[unfinished]` `S`

**21. ⚑ Domain auto-verification is disabled.** `core/modules/domain/services/domain-verification.service.ts:2`
says `TODO: Install @nestjs/schedule to enable cron-based auto-verification`, and `:240` has the `@Cron`
decorator commented out. Domains are verified only when a human asks. `[unfinished]` `S`

**22. ⚑ The legacy container path throws instead of degrading.**
`core/modules/docker/services/base-docker-supervisor.service.ts:88` throws for `buildContainerSpec()`,
declaring it superseded by `buildSwarmSpec()`. The message is accurate, but it means any supervisor not
yet migrated hard-fails rather than falling back. `[deepen]` `S`

**23. ⚑ A silent catch discards tunnel-connection failures.**
`modules/providers/dns/cloudflare/services/cloudflare-tunnel.service.ts:391` is
`} catch { return []; }` with no log. A Cloudflare API failure is indistinguishable from "this tunnel has
no connections", which is exactly the confusion the file's own 404-handling logic was written to avoid.
`[correctness-gap]` `S`

**24. ⚑ Bare `Error` bypasses the structured error pipeline.**
`analytics/repositories/analytics.repository.ts:180,276` and
`platform/services/platform-managed-web.service.ts:116,141,188` throw plain `new Error(...)`. These carry
no code, no context, and are not matched by the domain error contracts — the same root cause behind the
mesh strict-mode 500 recorded in the web audit. `[correctness-gap]` `M`

---

## C. CI/CD and release engineering (25–33)

**25. ⚑ The "Lint & Type Check" job never runs a type check.** `.github/workflows/ci.yml:191` names the job
"Lint & Type Check" and runs `turbo run lint --affected` only. There is no `turbo type-check` step
anywhere in CI. Type errors can merge. `[correctness-gap]` `S`

**26. ⚑ CI caches on a filename that does not exist.** `ci.yml:60,179,281,385` build a cache key hashing
`apps/web/src/**/page.info.ts`. The repo contains **zero** `page.info.ts` files and 67 `route.info.ts`
files. The key therefore never changes, so the route-generation cache is either always-miss or always-hit
— the exact opposite of its purpose. `[correctness-gap]` `S`

**27. ⚑ CI violates the mandated Bun runtime.** `ci.yml:98,175,277,381` invoke bare `bun run`, while the
repo's own rules require `bun --bun run` for `bun:sqlite`, `zod/v4` resolution, and `bun:` protocol
imports. CI and local development do not use the same runtime contract. `[correctness-gap]` `S`

**28. ⚑ Release notes read an output that cannot exist.** `deploy.yml:172` reads
`steps.meta.outputs.base` inside the release job, but `meta` is defined in the build job. Cross-job step
outputs are empty, so the release note substitutes a blank value. `[correctness-gap]` `S`

**29. ⚑ The deploy workflow references a compose path that does not exist.** `deploy.yml:150` uses
`docker/compose/docker-compose.deployer.yml`; the real file is
`docker/compose/deployer/docker-compose.deployer.yml` (one of 20 compose files). `[correctness-gap]` `S`

**30. ⚑ A setup step builds a package that was deleted, and hides the failure.**
`copilot-setup-steps.yml:161` builds `packages/mcp-repo-manager`, which does not exist, guarded by
`|| true`. The step reports success while doing nothing. `[correctness-gap]` `S`

**31. Dead-code detection never runs in CI.** `docs/feature-status/NOT-WORKING.md` records "Knip runs
manually only", and `knip.config.ts` exists. Unused exports and dependencies (see §D) accumulate between
manual runs. `[unfinished]` `S`

**32. No e2e job exists in CI.** Coverage is unit-only. The 14 `|e2e|` files that currently fail to load
(`window is not defined`, `vitest.setup.ts:70`) would surface immediately if a job ran them.
`[unfinished]` `S`

**33. Three workflows total, with no migration or schema-drift gate.** `ci.yml`, `deploy.yml`,
`copilot-setup-steps.yml` are the whole pipeline. Nothing verifies that Drizzle migrations apply cleanly or
that generated artifacts are current. `[new-feature]` `M`

---

## D. Contracts, schemas and their integrity (34–43)

**34. ⚑ The `events` contract is implemented by nobody and is not even registered.**
`packages/contracts/api/modules/events/index.ts:89` defines `eventSyncContract`, but it is **absent from
`appContract`** (`packages/contracts/api/index.ts:21-52`) and has zero implementers and zero clients. This
was already flagged on 2026-08-12 in `docs/enhancement-audit-2026-08-12.md:15` and is still true.
`[correctness-gap]` `M`

**35. ⚑ The `template` contract is registered but implemented nowhere.**
`packages/contracts/api/index.ts:39` registers it; it has zero references anywhere outside its own
directory and zero call sites repo-wide — despite defining `resolver`, `migration` and `compatibility`
operations. `[correctness-gap]` `M`

**36. ⚑ `permission` is a dead module.** `modules/permission/permission.module.ts:5-12` has no controller
and `PermissionService` has **zero injection sites** (grep returns only its own module and spec). It is
loaded at `app.module.ts:166` and used by nothing. Authorization logic exists but is not enforced at any
boundary. `[unfinished]` `L`

**37. ⚑ Orphan contracts still generate client surface.** Because §34–§35 are registered (or imported in
`apps/api/src/openapi.ts`), they emit typed-client paths and OpenAPI operations for endpoints that cannot
be called. `[correctness-gap]` `M`

**38. ⚑ A controller bypasses the contract with `as any`.**
`core/modules/mesh/dispatcher/mesh-resource.controller.ts:25` casts to `any` on a `@Implement` path,
defeating the type contract on a mesh resource surface. `[correctness-gap]` `S`

**39. ⚑ Three database tables have no entity schema.** `api_keys`
(`config/drizzle/global/schema/deployment.ts:453`), `analytics_reports` and `analytics_report_configs`
(`.../analytics.ts:26,60`) have no matching schema in `packages/contracts/entities`. Greps for
`apiKey`/`analyticsReport` across entities return zero. `[correctness-gap]` `M`

**40. ⚑ Error declarations are missing across most contracts.** Only two of roughly thirty mesh contracts
declared `.errors(...)` before a fix applied during the preceding web audit. A contract that does not
declare its errors cannot produce a typed client error — the mechanical cause of "Unknown error" toasts.
Sweep all of `packages/contracts/api/modules/`, not just mesh. `[correctness-gap]` `M`

**41. Entity-vs-table drift has no automated check.** There are **88** Drizzle tables and **116** entity
files exporting ~625 schemas. Non-1:1 is partly by design (runtime-only entities), but nothing detects
genuine drift — §39 was found only by manual spot-check. `[new-feature]` `M`

**42. The TODO ledger is self-inconsistent.** Blocks S168=S161, S169=S162, S170=S163, S171=S164,
S175=S165, S176=S166, S177=S167 are verbatim duplicates — roughly 21 redundant checkboxes inflating 617.
`[correctness-gap]` `S`

**43. `fleet`, `permission` and `runners` have no contract module.** For `fleet` this is correct — it
implements the `nodes` contract (`fleet.controller.ts:15,19-114`). For `permission` and `runners` there is
no controller at all, so §36 stands. The naming divergence (19 API modules vs 20 contract modules) is
undocumented and actively misleading. `[deepen]` `S`

---

## E. API module hygiene and test debt (44–51)

**44. ⚑ Three modules are declared empty.** `@Module({})` appears at
`core/modules/mesh/runtime/mesh-runtime.module.ts:3`,
`core/modules/sub-app-runner/sub-app-runner.module.ts:54`, and
`sub-apps/setup-wizard/setup-wizard.orpc.module.ts:10`. An empty module is wiring with no behaviour; each
is either mid-refactor or abandoned, and nothing distinguishes the two. `[unfinished]` `M`

**45. ⚑ `setup.module.ts` declares zero providers.** `setup.module.ts:28` is `providers: []`, while
`apps/api/src/core/modules/setup/services/initialization.service.ts:208` holds the real
`getNodeStatus()` logic. The module that owns the setup surface provides none of it. `[correctness-gap]` `S`

**46. ⚑ `reachability.module.ts` exports nothing and has no tests.**
`reachability.module.ts:16` is `exports: []`, the module has no service and no repository
(`reachability.controller.ts:39-45` injects four core/provider services directly), and there are **zero
specs**. `[unfinished]` `M`

**47. ⚑ Runner misconfiguration fails late instead of at boot.**
`modules/runners/services/runtime-runner-registry.service.ts:12-21` declares constructor parameters 2–7
**optional** and `.filter(r => r !== undefined)` at `:30`. A runner that fails to register is silently
dropped, and the loss surfaces as a runtime `BadRequestException` at `:38` when someone deploys with it.
This should fail at startup. `[correctness-gap]` `M`

**48. `cluster` is the only one of six core modules with no repository layer.** Data access is inlined in
`cluster.service.ts` (e.g. `:132`), while `docker`, `deployment`, `fleet`, `service` and `project` all
separate it. The core Swarm services are reachable directly, bypassing the layering the other five respect.
`[deepen]` `M`

**49. ⚑ The largest controllers have no tests.** `docker.controller.ts` holds 40+ `@Implement` handlers
with no spec; `cluster.controller.ts` (8 handlers) and `fleet.controller.ts` are also untested, as is
`fleet.service.ts`. Test coverage is inversely correlated with blast radius across the API. `[deepen]` `M`

**50. The `providers` module is the largest untested surface.** 24 units (13 services, 6 repositories,
5 controllers) with only 5 specs. Untested: the Cloudflare controller, the DNS controller, GitHub webhook
dispatch, GitHub deployment rules, `preview-provisioning`, `preview-ttl-cleanup`, GitLab and custom
providers, both registries, and both preview repositories. `[deepen]` `L`

**51. ⚑ A dead DI token is exported.** `modules/providers/base/source-provider.token.ts:1` exports
`DEPLOYMENT_SOURCE_PROVIDERS`, referenced nowhere. `[correctness-gap]` `S`

---

## F. Observability and alerting (52–58)

**52. ⚑ Analytics history is advertised but unavailable.**
`modules/analytics/services/analytics.service.ts` computes live snapshots via `systeminformation` (`:585`)
rather than reading stored history, and its history endpoints return `dataSource: "unavailable"`
(`:274,:278`). The API declares a data source it does not have. `[unfinished]` `M`

**53. ⚑ Metrics are written but never aggregated.** `cluster_node_metrics`
(`config/drizzle/global/schema/cluster.ts:116`) is written at
`system-mesh-cluster.repository.ts:203` and read only as the latest snapshot at `fleet.repository.ts:43`.
There is no retention policy, no rollup, and no query by time range. History accumulates unbounded and is
never usable. `[unfinished]` `M`

**54. ⚑ Notification configuration is a dead switch.** `enableSlackNotifications`, `slackWebhookUrl`,
`enableEmailNotifications`, `emailRecipients`, `notifyOnDeploymentSuccess`, `notifyOnDeploymentFailure` and
`notifyOnServiceDown` are read and written **only** in
`modules/project/services/project.service.ts:674-704`; the sole consumer outside the API is the UI form at
`configuration/page.tsx:336-346`. **No message is ever sent.** An operator can enable eight notifications
and receive none. `[correctness-gap]` `M`

**55. Four observability enums are exported and unused.** `incidentSeveritySchema`,
`incidentStatusSchema`, `notificationChannelSchema`, `notificationLevelSchema`
(`operations.schema.ts:6-14`) have zero importers — API surface describing a model with no behaviour.
`[correctness-gap]` `S`

**56. No incident model, timeline, or lifecycle.** See item 7. `[new-feature]` `L`

**57. No alert ingestion from the runtime.** Nothing converts a container crash, mesh partition, or
failed rollout into an alert object with a severity and an owner. `[new-feature]` `L`

**58. The deployer does not monitor itself.** It watches containers, nodes and the mesh, but never its own
API latency, queue depth, connection pool, or event-stream health. `[new-feature]` `M`

---

## G. Deployment and release workflow (59–66)

**59. Deployment approval gates are absent (S069–S070).** `requireApprovalForProduction` is persisted
(`project/settings.schema.ts:87`), resolved (`configuration-resolver.service.ts:733`) and asserted by e2e
(`deployment-complete-strategy.e2e-spec.ts:35,62`), but **no file under `apps/api/src/modules/deployment/**`
reads it** — the only occurrences are in `deployment.service.spec.ts:78,798`. The status enum
(`platform-domain.schema.ts:4`) has no approval state to reach. The config is plumbed, tested, displayed
and inert. `[unfinished]` `L`

**60. Deployment strategy is a four-way choice with no parameters.** `rolling | recreate | blue-green |
canary` is offered at `CreateService.hook.ts:96` and `StepRuntime.tsx:108`. Selecting `canary` changes one
string and nothing else — no traffic percentage, no bake time, no automatic promotion. `[deepen]` `L`

**61. Rollback has no target picker and is likely broken on both pages.**
`deployment.rollback` requires a `targetDeploymentId`; the global deployments table dropped its rollback
button rather than supply one (`deployments/page.tsx:89`), and the sibling page calls it with **no body**
via `as any` (`services/[serviceId]/deployments/page.tsx:141`). A dialog promises "revert to the previous
version" and sends nothing identifying which version. `[correctness-gap]` `M`

**62. Checkpoint resume is unreachable.** `deploymentExecutionStateSchema` defines
`from_last_checkpoint | from_node | restart_failed_branch` (`execution.schema.ts:7`) and a `gate` phase kind
exists (`plan.schema.ts:20`), but `checkpoint|resumeFrom` returns **zero hits** across `apps/web/src`. The
platform can resume; no operator can ask it to. `[unfinished]` `M`

**63. The deployment queue and its dead letters are invisible.**
`deploymentQueueJobTypeSchema`, `deploymentQueueJobStatusSchema`, `deploymentDeadLetterReasonSchema` and a
`same_payload | patched_payload` replay mode are all defined in `deployment/queue.schema.ts`. Grepping
`apps/web/src` for `deadLetter|queueJob|deploymentQueue|replayMode` returns **nothing**. Failed work lands
in a dead-letter queue nothing displays, using a contract that already specifies replay. `[new-feature]` `L`

**64. No environment promotion flow.** Previews can be promoted to a stable domain
(`previews/page.tsx`, `usePromoteServicePreview`), but staging → production — the most common release
action — has no path. `[new-feature]` `L`

**65. Configuration drift is undetectable.** Provenance is modelled precisely for this
(`deploymentTemplateProvenanceSourceSchema`: `template | inlineOverride | runtimeDefault`,
`provenance.schema.ts:4`), but no page compares declared configuration to what is running. `[new-feature]` `L`

**66. Deployments carry no release notes or commit range.** A deployment has an id, status and timestamp.
It cannot answer "what shipped". `[new-feature]` `M`

---

## H. Mesh, fleet and multi-node (67–73)

**67. Placement is manual although labels exist.** `resolveSwarmNodeRole`,
`updateSwarmNodeLabels` and `updateSwarmNodeRoleAvailability` operate on real node labels, but nothing lets
a project express "run on nodes labelled `tier=prod`". `[new-feature]` `L`

**68. No node drain with an eviction preview.** `admin/system` changes role and availability. Nothing shows
which workloads would move or whether the fleet has room before a node is taken out of service.
`[new-feature]` `M`

**69. No failover or rebalance automation (S134–S145).** `peerDegree|peerScore|meshPing` are absent, and
`modules/fleet/**` contains no placement, constraint, or failover symbols. `[unfinished]` `L`

**70. Cluster state has no history.** `cluster_node_metrics` is read as latest-only (§53), so "when did
this node start degrading" cannot be answered. `[deepen]` `M`

**71. 12 mesh features are `it.todo()`.** `e2e/mesh-workflows/mesh-doc-compliance-matrix.e2e-spec.ts:680-691`
lists durable stream integration, node-owned routing, sharded fan-out, replica selection, stream pools,
distributed query request/response flows, promotion/demotion control frames, reference-counted stream
stores, `computeStreamKey()`, and event-payload routing — all unrealised. `[unfinished]` `L`

**72. Capacity planning is absent.** Allocated/used per server is shown; "will this fleet hold the next
five services" is not answerable. `[new-feature]` `L`

**73. Storage placement is invisible.** Volumes can be created and inspected, but nothing shows which node
a volume lives on or that a stateful service may be scheduled away from its data. `[new-feature]` `M`

---

## I. Providers, runners and integrations (74–80)

**74. Provider test debt is concentrated in the riskiest code.** See item 50 — webhook dispatch,
deployment rules, preview provisioning and preview TTL cleanup are all untested. `[deepen]` `L`

**75. No registry policy.** Container creation is highly configurable per container, including raw
`cpuQuota` (`docker-create-container-modal.tsx:1426`), but nothing constrains which registries may be
pulled from or which tags may be deployed. Supply-chain policy rests on convention. `[new-feature]` `M`

**76. Credential rotation covers only the mesh secret.** The single rotation flow in the product is the
mesh shared secret (`admin/system/page.tsx:2416-2432`). Repository, registry and DNS credentials can only
be rotated by deleting and recreating the provider. `[unfinished]` `M`

**77. GitHub webhook service resolution is a placeholder.**
`modules/providers/code/github/controllers/github.webhooks.controller.ts:145` carries
`TODO(T032): resolve actual serviceId from repository identifier`, using the repository `full_name` as a
stand-in until the provider registry is wired. `[unfinished]` `M`

**78. No API key management.** `api_keys` table exists (§39) with no entity schema and no UI. Machine
access has no first-class surface: no create, no scope, no revoke, no last-used. `[new-feature]` `L`

**79. No rate limiting on sensitive endpoints.** The Traefik middleware builder supports it
(`middleware-builder.ts`, `getRateLimiter`), but in `apps/api/src` it is applied only to
`registerAppInstance` and `platform/orpc/middlewares.ts`. Auth sign-in, setup, webhooks and probes have
none. `[unfinished]` `L`

**80. Preview lifecycle cleanup has no test and no observability.**
`preview-ttl-cleanup.service.ts` is untested (item 50), and nothing reports whether it ran or what it
reaped. Preview environments can leak silently. `[deepen]` `M`

---

## J. Setup, bootstrap and multi-context (81–86)

**81. Phase-0 setup ownership is split and partly duplicated.** `setup.module.ts` declares no providers
(§45) while `core/modules/setup/` holds the logic, and `sub-apps/setup-wizard/` exists again despite
`docs/feature-status/NOT-WORKING.md:1.3` recording it as **deleted** ("Superseded by `modules/setup/`").
Which of the three is authoritative for setup is not documented. `[correctness-gap]` `M`

**82. No setup state persistence beyond `setupStateSnapshotSchema`.** See item 1 — the state machine is
described but not reachable, so progress cannot be inspected or resumed. `[unfinished]` `M`

**83. The setup wizard is unreachable after first run.** `components/setup/steps/` holds eight steps (mode,
local account, local database, cluster, join cluster, remote URL, remote auth, progress). Once onboarding
completes there is no read-only view of the recorded answers and no re-probe. `[new-feature]` `M`

**84. Multi-context port topology is undocumented.** The API boots a gateway plus setup-wizard,
mesh-initializer and main-app contexts on separate ports. No single document or code constant states the
full map, and `turbo.json` `globalEnv` declares `API_PORT` and `NEXT_PUBLIC_APP_PORT` but not the sub-app
ports. `[correctness-gap]` `M`

**85. `reachability` is an orphaned surface.** No service, no exports, no tests (§46), four injected
dependencies. Its relationship to `core/modules/reachability` and `core/modules/platform-ingress` is
undefined. `[unfinished]` `M`

**86. Bootstrap divergence across entrypoints is unchecked.** Four entrypoints exist; nothing verifies they
construct the DI graph identically. An empty `@Module({})` in one (§44) is invisible from the others.
`[deepen]` `M`

---

## K. Data and persistence (87–90)

**87. `cluster_node_metrics` grows without bound.** Written on every snapshot, never pruned, never rolled
up (item 53). `[correctness-gap]` `M`

**88. No migration-drift gate in CI.** See item 33. `[new-feature]` `S`

**89. Three tables lack entity contracts.** See item 39. `[correctness-gap]` `M`

**90. No documented data-retention policy** for audit history, metrics, logs, or dead-letter records.
`cluster_master_history` is described as an append-only audit trail with no stated retention. `[new-feature]` `M`

---

## L. Security and access (91–94)

**91. Audit emission is not wired (S133, S119, S038).** The platform has `cluster_master_history`, a
`dispatchAudit` hook in `runtime-configuration.schema.ts`, and an `audit` capability declared in
`packages/utils/auth/src/permissions/config.ts:59` — yet grepping `packages/contracts/api/modules/` for
`audit` returns **zero** matches. No audit contract, and therefore no audit UI is possible. `[unfinished]` `L`

**92. Authorization is declared but not enforced at boundaries.** `permission` is a dead module (§36), and
the permission model declares capabilities (including `audit`) that nothing checks on mutating handlers.
`[correctness-gap]` `L`

**93. No session or device management.** `auth/me/_components/accounts-section.tsx` shows linked accounts;
there is no active-session list, no "sign out everywhere", no device history. `[new-feature]` `M`

**94. No security-event surface.** Sign-ins, failures, lockouts and password changes are absent from every
UI, although `password_reset` and `email_verified` exist in the auth schema domain. `[new-feature]` `M`

---

## M. Developer experience and tooling (95–98)

**95. ⚑ The dependency catalog is bypassed.** `turbo.json` declares a large `globalEnv`, but several
configs and workflow steps reference versions and scripts directly. `catalog:` references exist for some
packages and not others — drift is unaudited. `[deepen]` `M`

**96. The stale-to-`knip` gap is unmeasured in CI.** See item 31. The current baseline is a hand-maintained
file (`tmp/knip-baseline.txt`), not a gate. `[unfinished]` `S`

**97. Two duplicate component libraries remain.** `apps/web/src/components/ui/` holds 12 files, 8
duplicating `packages/ui/base/src/components/shadcn/` with real drift, and `command.tsx` there still
carries the `CommandDialog` crash fixed in the canonical copy. `[correctness-gap]` `M`

**98. `packages/mcp-repo-manager` is referenced by CI but does not exist.** See item 30 — the MCP repo
tooling the root `AGENTS.md` mandates as the primary interface is absent from the tree. `[correctness-gap]` `M`

---

## N. Documentation and inventory accuracy (99)

**99. ⚑ The inventory contradicts the code.** Four concrete instances: `NOT-WORKING.md` §1.3 records
`sub-apps/setup-wizard/` as deleted while it exists; `NOT-WORKING.md` §4 states "Web frontend tests: only 10
test files" (68 tests pass across more); `.github/instructions/backend-nestjs.instructions.md` references
`apps/load-balancer`, which does not exist; and `docs/PLATFORM_SOURCE_OF_TRUTH_TODOS.md` has 617 unchecked
boxes against features that §A shows are absent. Documentation is being treated as a plan of record while
drifting from reality. **This item is the meta-cause of most others.** `[correctness-gap]` `L`

---

## O. New capability (100)

**100. ⚑ Publish the OpenAPI document as a browsable reference.** `apps/web/src/routes/openapi.ts` already
generates `openapi-docs.yml` via `OpenApiGeneratorV3` and **nothing serves it**. Rendering it (Scalar or
equivalent) makes the strongest asset in this repository — a complete, Zod-derived contract layer — usable
by anyone outside the web client. Prerequisite: remove the orphan contracts (§34–§35) so the published
document describes only reachable operations. `[new-feature]` `M`

---

## Where I would start

| Order | Item | Why |
|---|---|---|
| 1 | 99 — inventory contradicts code | It is the parent of most other items; every plan built on it inherits the error |
| 2 | 25 — CI never type-checks | One line; unblocks every type-safety guarantee in the repo |
| 3 | 26 — CI caches a nonexistent file | One line; the cache currently cannot work as intended |
| 4 | 13 — refresh-status silent no-op | A live control that lies; consumer proven |
| 5 | 34, 35 — orphan contracts | Two registered contracts with no implementation, emitting dead client paths |
| 6 | 36 — dead `permission` module | Authorization machinery loaded and enforced nowhere |
| 7 | 1, 4, 5, 6 — phantom clusters | The four largest specified-but-absent surfaces |

## Method and confidence

Audited via the deep-analysis loop. Phase 0 (planner ∥ context-curator) produced a 12-track decomposition
and 20 success criteria. Wave 1 = 10 scouts, **3 returned**; Wave 2 = 5 analysts, **5 returned**. The seven
Wave-1 failures were backfilled by direct file reads and targeted greps rather than re-spawned, because the
sub-agent channel returns empty on roughly two-thirds of wide missions in this repo and further spawning
was trading context for no evidence. **The review phase (completeness ∥ accuracy ∥ coherence +
gatekeeper) did not run** — its output would have been advisory only, and every ⚑ claim in this document
was verified directly against the file or grep it cites.

Two Wave-1 hypotheses were **falsified** during Wave 2 and are recorded as such: `resolveVariables` and the
fleet zero-summary are unreachable, so they carry no current user impact (items 15, 17). One was
**confirmed reachable** and is a live defect (item 13).

**Not audited:** `apps/doc` prose content, `graphify-out/`, migration SQL bodies, the full 88-table ↔
116-entity diff, and `packages/configs/{eslint,prettier,tailwind,typescript,vitest}` internals.
