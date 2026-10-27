# Audit: PROJECTS & SERVICES (v3, branch rewrite-v3)

Method: files read directly (no analysis scripts). Paths are relative to `v3/` unless absolute. Status legend: REAL (implemented + wired end to end), PARTIAL, STUB, MISSING.

Abbreviations used for paths:
- `PS` = `apps/api-services/services/project/src/modules`
- `RT` = `apps/api-services/services/runtime/src/modules`
- `FL` = `apps/api-services/services/fleet/src/modules`
- `WEB` = `apps/web/src/app/dashboard/projects`
- `CT` = `packages/contracts/project`

## 0. Architecture facts that shape everything

- The live implementation is `apps/api-services/services/project` (svc-project), reached through the BFF's generated 1:1 delegation (`apps/api-services/bff/src/modules/delegation/generated/project.delegation.ts`, `service.delegation.ts`). The BFF applies NO auth; the service does (`requireAuth()` on every handler).
- A near-identical copy still lives in the frozen monolith `apps/api/src/modules/{project,service}`. It has NOT received the role fixes (`apps/api/.../project.service.ts` still passes `["owner","admin"]`, roles that do not exist in `PROJECT_ROLES`), so it is worse than the service copy. Duplicate code to delete when the cutover is declared.
- Contracts live in `packages/contracts/project` (`index.ts`, `modules/project/*`, `modules/service/*`, `modules/domain/*`); entity schemas in `packages/contracts/entities/src/entities/{project,service,configuration}`.
- Service/project "unit tests" in `apps/api-services/services/project` (139 tests, last logged green in `.turbo/turbo-test.log`) are mock-level; there is NO spec for `ServiceService`, `PreviewTopologyService`, `ProjectNetworkService`, `ServiceNetworkService`, nor any repository. The type-check log in `.turbo/turbo-type-check.log` shows 20 errors (partly in shared) at last run; I did not re-run it.
- `docs/v2-v3-project-pages-comparison.md` is stale: it says the project-level Services tab is missing (it exists: `WEB/[projectId]/services/page.tsx`, 318 lines), says Configuration is one 878-line page (it is now 44 lines, `WEB/[projectId]/configuration/page.tsx`), and claims "Zero mock data". Do not trust it.

## 1. Feature inventory

### 1.1 Project core

| Feature | Status | Evidence |
|---|---|---|
| Project create / update / delete | REAL (authz gaps) | `PS/project/controllers/project.controller.ts:36-63`, `services/project.service.ts:75-154`. Delete is owner-only (`domain/project.entity.ts:176`). Create does not seed any environments (see 1.3). Delete only removes DB rows; no teardown of containers/routes/DNS/volumes (no consumer of the outbox events, grep for `project.deleted` outside the project service returns nothing). |
| Project list / findById | REAL but NOT access-scoped | `project.service.ts:63-73`, `project.repository.ts:191-227`: any authenticated user lists and reads every project. `list` supports only id/name/ownerId filters. |
| Project stats (`_count`, latestDeployment) | REAL | `project.repository.ts:399-455` (N+1-ish: 4 queries). |
| Collaborators (list/invite/update/remove) | PARTIAL, privilege-escalation bug | `project.service.ts:160-255`. `projectRules.assertNotOwnerGrant` and `assertRoleIsAssignable` (`domain/project.entity.ts:117,212`) are defined and never called; `inviteCollaboratorSchema.role` is `projectRoleSchema` which includes `owner` (`packages/contracts/entities/.../collaborators.schema.ts:27-29`), so a maintainer can invite/promote anyone to `owner`. Maintainers can also demote/remove other maintainers (`admin` access = owner+maintainer). No acceptance flow (`acceptedAt` stays null, no email/notification). Per-collaborator `permissions` JSON (canDeploy, canViewLogs...) is stored and never enforced (grep of runtime/shared finds no consumer). |
| Project role/access policy | REAL | `domain/project.entity.ts:56-221` (levels read/deploy/manage/admin). `deploy` and `manage` levels are never used by any caller; config writes use `admin`. |
| Project settings tabs (general/environment/deployment/security/resource/notification) | PARTIAL: stored, mostly not enforced | `project.service.ts:470-707`; UI `WEB/[projectId]/configuration/page.tsx`, `_components/configuration/ProjectConfigSections.tsx`. Only `autoDeployEnabled`, `enablePreviewEnvironments`, `deploymentStrategy`, `requireApprovalForProduction`, `enableHttpsRedirect`, `defaultEnvironmentVariables` feed the resolver (`apps/api-services/shared/src/core/modules/configuration/services/configuration-resolver.service.ts:~654,716-760`). NOT consumed anywhere (grep returns nothing in runtime/fleet/shared): `slackWebhookUrl`, `emailRecipients`, all `notifyOn*`, `maxServicesPerProject`, `maxPreviewEnvironments`, `autoCleanupDays`, `defaultCpuLimit/MemoryLimit/StorageLimit`, `enableBasicAuth`/`basicAuthUsername`/`basicAuthPassword`, `ipWhitelist`, `allowedDomains`, `enableRollback`, `deploymentTimeout`, `healthCheckTimeout`, `webhookSecret`. Also `productionEnvironmentVariables`/`stagingEnvironmentVariables`/`developmentEnvironmentVariables` are not read by the resolver (only `default...`). |
| Security config read | RISKY | `project.service.ts:593-613` returns `webhookSecret` and `basicAuthPassword` in clear text to any reader (read access suffices) and they sit un-encrypted in `projects.settings` JSONB (`packages/nest/schema/src/global/project/deployment.ts` projects table). |
| Project network (DNS provider + zone + records) | REAL read, unauthorised | `PS/project/services/project-network.service.ts:61-185`; controller `project.controller.ts:183-195` passes no user, no access check: any authenticated user can read/change any project's DNS provider/zone/base domain. |
| Project webhooks service | STUB (unwired) | `services/webhook.service.ts`, `repositories/webhook.repository.ts` are provided in `project.module.ts` but no controller, no contract, no caller. Role check uses `["owner","admin"]` (nonexistent role). Tests pass only because they mock. |
| API keys service | STUB (unwired) | `services/api-key.service.ts` same situation (no contract/controller; only `packages/auth` has an unrelated api-key plugin). |
| Project event stream | REAL | `project.service.ts:740-902`, `project-event.service.ts`; stream is unscoped (any authed user sees all project events; replay always emits `projectCreated`). |
| `getProjectSettings/updateProjectSettings` (deprecated) | DEAD CODE | `project.service.ts:709-734`, no callers. |

### 1.2 Services core

| Feature | Status | Evidence |
|---|---|---|
| Service CRUD (create/update/delete/toggleActive) | REAL | `PS/service/controllers/service.controller.ts`, `services/service.service.ts:104-386`. Create/update validated against runtime-config constraints (`providerAllowed`, `runnerAllowed`). No name-uniqueness check per project; no DB unique constraint. `maxServicesPerProject` not enforced. |
| Service list / findById | REAL but NOT access-scoped | `service.service.ts:88-102`: any authenticated user reads all services (incl. env vars, provider config) of all projects. |
| Cross-project injection on create | BUG | `service.repository.ts:276` uses `child.projectId` from the request for sub-services; only the ROOT's project is access-checked (`service.service.ts:108`). A caller can create child rows in any project. `parentId` on create is also not checked for same-project/access. |
| Sub-services (hierarchy, children, subtree, effective-config inheritance) | REAL | `service.repository.ts` (materialized path, auto-linking edges `autoLinkSubServiceDependencies`), `service-effective-config.ts` (+ spec). `children`/`subtree` endpoints exist but the web never calls `useServiceChildren/useServiceSubtree` (hooks unused). |
| Service dependencies (add/remove/list, cycle detection, same-project rule) | REAL data model; no UI; no runtime effect | `service.service.ts:394-528`. `dependencies.list` has no access check. Web has hooks `useAddServiceDependency/useRemoveServiceDependency` that no page uses; project "Dependencies" tab is read-only (`WEB/[projectId]/dependencies/page.tsx`, `_components/ServiceDependencyGraphPanel.tsx`). Deployment passes `dependencyGraph` into the queue payload (`RT/deployment/services/deployment.service.ts:543`) but nothing ever reads it (only producer in repo). So: NO cascade deploy, NO start ordering, NO required-dependency gating (v1/v2 behaviour lost). |
| Service types/providers/runners vocabulary | PARTIAL | `packages/contracts/common/src/provider-runner.schema.ts`: providers github/gitlab/bitbucket/container-registry/artifact-bundle/manual; runners manual/compose/orchestrator/kubernetes/nomad/static/worker-runtime/mock. Runtime only has runners docker, dockerfile, nixpacks, buildpack, railpack, docker-compose, swarm (`RT/runners/*`). There is no mapping from service `builderId` to a runtime runner; Kubernetes, Nomad, worker-runtime, static and mock have no executor. |
| Runner config (startCommand, args, ports, volumeMounts, secretRefs, strategy...) | STUB | Defaults in `PS/service/services/service-config-defaults.ts:116-152`; grep shows `builderConfig`, `providerConfig`, `startCommand`, `volumeMounts`, `secretRefs` are never read by runtime/shared (only compose realizer reads compose `secrets`). Service `port`, `healthCheckPath/Interval/Timeout/Retries` are also unread by the deploy path; `healthCheckPath` is hardcoded `"/health"` (`RT/deployment/services/deployment-execution-workflow.service.ts:491`). |
| Service env vars | PARTIAL | `services.environment_variables` is plain JSONB (`packages/nest/schema/src/global/project/deployment.ts`), editor in `WEB/[projectId]/services/[serviceId]/configuration/environment/page.tsx`. Merge chain mesh < project default < service < user is real (`configuration-resolver.service.ts` ~742-752). The encrypted `environment_variables` table (`packages/nest/schema/.../environment.ts:203`, `encryptedText`) has no v3 consumer (only a monolith CLI `backfill-env-secrets.command.ts`). No secret flag, no masking beyond a client-side password input, values returned in clear by findById. UI text "Prefix `ENV_NAME` for per-env values" describes a feature that does not exist. |
| Service-network (DNS) | REAL read; NO authz | `PS/service/services/service-network.service.ts:82,148,181`. `provisionDnsRecord` creates arbitrary DNS records (type/name/content) in the platform DNS zone for ANY service on behalf of ANY authenticated user: no access check, no hostname-under-zone validation. |
| Preview topology dry-run | PARTIAL (resolver real, nothing consumes it) | `PS/service/services/preview-topology.{resolver,service}.ts` (pure, well-structured). Contract `servicePreviewTopologyContract` is served and delegated, but the web has no endpoint for it (`apps/web/src/domains/service/endpoints.ts` omits it; grep `previewTopology` in web returns nothing). `service.preview` / `implementsContract` are saved by `WEB/.../configuration/preview/page.tsx` (it states "CONFIGURATION ONLY"); no deployment code reads `backendResolution` or `linkedServices` (grep: only the dry-run files). |
| Service stream | REAL, unscoped | `service.service.ts:530-790`. |
| Service overview status | BUG | `WEB/[projectId]/services/[serviceId]/page.tsx:63-71,127` reads `s.status ?? s.state` and `runnerType`; the service entity has none of these (`packages/contracts/entities/src/entities/service/service.schema.ts`), so the status badge always shows "unknown" and the runner badge never renders. |

### 1.3 Environments

| Feature | Status | Evidence |
|---|---|---|
| Environment CRUD, clone, kinds (stable/preview/ephemeral), rules/trigger schema | REAL data layer | `project.service.ts:261-381`, `project.repository.ts:530-640`; UI `WEB/[projectId]/environments/page.tsx` + `_components/environments/*`. `updateEnvironment` accepts an unvalidated `Record<string, unknown>` (`project.service.ts:320-334`, contract only gates body shape). Slug is name-lowercased, no unique constraint on (project, slug) or (project, name); `resolveEnvironmentId` (`RT/deployment/repositories/deployment.repository.ts:386`) picks the first row by name. `type` silently defaults to `development`. |
| Default environments on project creation | MISSING | `createProject` creates none. A new project has zero environments, so the deploy dialog shows "No environments defined", `environment_id` on deployments is null, and the service env-link UI has nothing to toggle. v2 created them. |
| Environment rules enforced at deploy | MISSING | `rules` (autoDeploy, strategy, replicas, trafficPolicy, healthGate, startupMode) are only displayed (`WEB/[projectId]/configuration/environments/[environmentId]/page.tsx`); grep finds no consumer besides the runtime's own health gate. `isActive` ("deployments to it are paused") is not checked by `triggerDeployment`; `service_environments.isEnabled` is not checked either. `overrides` JSON on links is stored and never applied. |
| Environment status | STUB | Created as `pending`; nothing updates `environments.status` (grep: no writer). `getEnvironmentStatus`/`getAll...` fabricate `healthyServicesCount` from that field and `lastChecked: new Date()` (`project.controller.ts:347-383`). `refreshEnvironmentStatus` throws `NotImplementedException` (`project.controller.ts:385-392`) yet the UI Refresh button calls it (`WEB/[projectId]/environments/page.tsx:172`) and just toasts an error. |
| Service x environment link matrix | REAL | `project.service.ts:387-407`, `WEB/_components/environments/ServiceEnvironmentMatrix.tsx`. Not enforced at deploy (above). Service-page "Config" button links with the env NAME as `environmentId` (`.../configuration/environment/page.tsx` `environmentId={env}`), and the target page calls `getEnvironment(projectId, "production")` with a non-UUID: the link is broken. |
| Per-environment variables (v1/v2 had get/update/resolve with secrets) | MISSING | `environment_variables` table unused; project `getEnvironmentConfig` stores `production/staging/development...EnvironmentVariables` that the resolver never reads; no UI for `getEnvironmentConfig/updateEnvironmentConfig` (hook `useProjectEnvironmentConfig` has no page). |
| Variable templates | PARTIAL | `project.service.ts:413-464`, UI `_components/environments/VariableTemplatesCard.tsx`, applied in the service env page. Table is GLOBAL (`project.repository.ts:699-715` has a TODO and `_projectId` is ignored): all projects see and any project admin can edit/delete any template (`get/update/delete` do not check templates belong to the project). Applying a template copies `defaultValue` only. |
| Other unused env tables (`environment_templates`, `environment_promotions`, `environment_access_logs`, `environment_services`) | MISSING (schema only) | `packages/nest/schema/src/global/project/environment.ts`; no module uses them. v2 had promotions/access logs/bulk delete/cleanup of expired previews. |

### 1.4 Preview environments per branch/PR

| Feature | Status | Evidence |
|---|---|---|
| GitHub PR webhook receive + signature + idempotency | REAL | `FL/providers/code/github/controllers/github.webhooks.controller.ts`, middleware `github-webhook-auth.middleware.ts`. |
| PR to service resolution | BROKEN | `github.webhooks.controller.ts:138-140`: `serviceId = payload.repository?.full_name ?? "unknown"` (TODO T032). The service lookup (`domainRoutingService.resolveServiceUrls`) therefore never matches; preview provisioning returns `no_domain_mapping`. `projectId` is never passed, so `github_deployment_rules` are never evaluated (`github-webhook-dispatch.service.ts:68-81`). |
| Preview lifecycle (events, DNS, Traefik route, TTL cleanup row) | PARTIAL | `preview-provisioning.service.ts`, `preview-ttl-cleanup.service.ts`: real DNS (Cloudflare only) + route calls, but fire-and-forget (`void ...catch(warn)`), and it NEVER builds or deploys the PR branch. `recordPreviewRow` only attaches to the latest existing deployment of the service. So the "preview" URL points at whatever is already running. Cleanup uses `previewName = pr-${n}` while creation used a naming-service name, so names can diverge. Cleanup TTL hardcoded 168h (`github-webhook-dispatch.service.ts:174`). |
| `push` webhook / auto-deploy on push, `autoSyncEnabled`, `webhookEnabled` | MISSING | Controller logs "unhandled_event" for push (`github.webhooks.controller.ts:~70`); grep finds no consumer of `autoSyncEnabled`/`webhookEnabled`. Auto-deploy is therefore not wired at all (the resolved `autoDeployEnabled` is never consumed). |
| GitLab / Bitbucket webhooks | MISSING | Only GitHub. |
| Preview env overlay (`PreviewEnvOverlayService`) | STUB (unwired) | provided/exported in `RT/deployment/deployment.module.ts:26,79,92` but injected nowhere. |
| Preview-aware dependency resolution (linked previews, mocks) | PARTIAL (dry-run only) | see 1.2. Mock runner type `mock` has no executor. |
| Preview list/promote | REAL read model | `RT/deployment/services/deployment.service.ts:261-330`, UI `WEB/[projectId]/services/[serviceId]/previews/page.tsx`. |
| Environment `trigger` (kind preview/ephemeral PR/branch/webhook/schedule) | STUB | schema and CRUD only; nothing reads `environments.trigger`. `enablePreviewEnvironments` only gates `triggerDeployment(environment="preview")`. |

### 1.5 Git sources, build, deploy

| Feature | Status | Evidence |
|---|---|---|
| GitHub source (public repos) | REAL | `apps/api-services/services/runtime/src/modules/providers/code/github/...`, `RT/deployment/builders/deployment-artifact-builder.service.ts:96-103` + `shared/.../git.service.ts:33` (`git clone --depth 1 --branch`). |
| GitHub private repos / GitHub App installation tokens | MISSING | `git.service.ts` has no token/credential handling; `validateRepository` is an unauthenticated `git ls-remote` (`git.service.ts:122`); `providerAppId` picked in the wizard is only used for the repo picker, never for checkout. Shallow clone then `checkout(commit)` also fails for non-HEAD commits. |
| GitLab source | PARTIAL/BROKEN | provider resolves checkout (`RT/providers/code/gitlab/...`) but the builder only accepts `github` and `upload` (`deployment-artifact-builder.service.ts:~118`, throws "not supported"). |
| Bitbucket, artifact-bundle, container-registry, manual | BROKEN from UI | UI sends only github sources (`WEB/[projectId]/deployments/page.tsx:102-112`, `as any`), and `custom` requires `customData.containerImage` (`RT/providers/code/custom/services/custom-source-provider.service.ts:80`) which the UI never supplies. The helper `WEB/_utils/trigger-source.ts` (claims "the server resolves the source from the service itself") and `deployments/_components/trigger-dialog.tsx` are not used by any page (only by a test). Nothing on the server resolves a service's saved `providerConfig`. |
| Zip upload source | PARTIAL | API `deploymentContract.uploadBundle` + `upload-source-provider.service.ts` exist; NO web UI to upload (grep `upload` in web/domains/deployment and projects: only copy text). |
| Build: Dockerfile | REAL | `deployment-artifact-builder.service.ts:138-157,292-300`. |
| Build: docker-compose | REAL | same file, `buildCompose`. |
| Build: nixpacks / buildpack / railpack | STUB | the UI offers them (`WEB/_components/steps/runner-presets.ts` BUILD_METHOD_META with auto/dockerfile/nixpacks/buildpack/railpack/external) but the code just does `docker build` (`deployment-artifact-builder.service.ts:325` "remain containerized via docker image build"); the runners are thin aliases that delegate to the docker runner (`RT/runners/nixpacks/nixpacks-runtime-runner.service.ts`). No Dockerfile means failure. The monolith documents it plainly (`apps/api/.../buildpack-family-builder.strategy.ts` "this platform runs no nixpacks toolchain"). |
| Build auto-detect ("auto") | MISSING at deploy | repo detection hints exist for the wizard (`FL/providers/code/github/controllers/github-account.controller.ts:~590-700`), but the deploy path does not pick a builder: when `execution.builder` is null (the UI never sends it) a GitHub deploy resolves no builder and returns `fallbackContainerImage` (null), so there is nothing to run. |
| Service saved config used at deploy | MISSING | see runner config row: deployments take source/execution from the trigger request, not from the service's `providerConfig`/`builderConfig`/`port`/health fields. |
| `authSecretRef` (Vault / AWS / GCP / Azure options) | STUB | options listed in `WEB/_components/steps/StepProvider.tsx`, value stored; grep finds no consumer anywhere. |
| Volumes / storage | PARTIAL | storage providers (local, volume, nfs, s3) resolve a binding (`RT/deployment/storage/*`); docker runner mounts local/volume/nfs (`runners/docker/docker-runtime-runner.service.ts:230-276`); swarm runner supports volume only (`swarm-runtime-runner.service.ts:451-470`); s3 is metadata only (never mounted). Configuration comes only from `service.metadata.storage` or the trigger request's `customData`; there is no contract field, no UI and no volume lifecycle; runner-config `volumeMounts: string[]` is dead. |
| Cron / scheduled jobs per service | MISSING | no scheduled-job entity or UI in v3 (`Jobs` tab in v2 was a deployment queue view; not ported). |
| Templates / one-click apps | MISSING | the `template` contract router (`packages/contracts/bff/modules/template/*`, composed in `apps/api-services/bff/src/orpc/app-contract.ts:58`) has no `@Implement` anywhere (grep), so every call fails. "Variable templates" are the only template feature. |
| Domain/TLS per service | out of area | `modules/domain` (project-domain, service-domain) exist with controllers + specs; deployment syncs routes and provisions TLS (`deployment-execution-workflow.service.ts:487-535`), errors only logged as warnings. |

### 1.6 Web UI (projects/services)

| Page | Status | Notes |
|---|---|---|
| `/dashboard/projects` list/create/edit/delete | REAL | `WEB/page.tsx`. Fetches `limit:100` projects, services and deployments with no pagination: silent truncation past 100. |
| `/dashboard/services` global list | REAL | `apps/web/src/app/dashboard/services/page.tsx`. |
| Project overview/services/team/domains/environments/deployments | REAL (see bugs) | Project pages fetch ALL services (`limit:100`, no `projectId` filter) and filter client-side (`WEB/[projectId]/_hooks/use-project-detail.ts:23-30`, `services/page.tsx:41`, `page.tsx:36`): wrong once the platform exceeds 100 services, and every user downloads every service. Dependencies fetched N+1 per service (known issue in code). |
| Project configuration (general/deployment/security/resources/notifications/contracts) | REAL forms, mostly unenforced settings | see 1.1. |
| Dependencies tab | PARTIAL | graph read-only; no add/remove UI. |
| Service config: general/provider/network/environment/preview | REAL forms | no "build" sub-tab (v2 had one; `builderConfig`/runner editing is not exposed after creation). |
| Create-service wizard (`_components/CreateServiceWizard.tsx`, steps) | REAL (large) | produces provider/runner configs, sub-services tree; but those configs are not honoured at deploy (see 1.5). |
| Project-level SSL / Jobs / Monitoring / Activity / Orchestration tabs (v2) | MISSING | the activity contract exists in analytics but no tab. |
| Dev-session planner (`apps/web/src/domains/project/development-session.ts`) | STUB (UI-less) | only referenced by its own test; local state, no API. |

## 2. What works end to end

- Create a project, edit it, delete it; invite/remove collaborators by email (owner/maintainer) with role-level checks on writes.
- Create a service (including a nested sub-service tree with auto-linked dependency edges and effective-config inheritance), edit it, toggle active, delete it. Runtime-config constraints validated.
- Add/remove service dependencies via API with same-project and cycle checks (but no UI to do it after creation).
- Environment CRUD/clone and the service x environment link matrix (UI + API).
- Project default env vars -> service env vars -> user overrides merge in the resolved runtime config; service env vars are injected into the container.
- Deploying a public GitHub repo that contains a Dockerfile (when the caller supplies source+builder; the project UI supplies only source), or a prebuilt image through the docker/swarm runner, with route sync and best-effort TLS.
- Variable templates CRUD (global).
- Project and service event streams (unscoped).

## 3. Broken / risky (ordered by severity)

1. Authorization holes (all in `PS`): project list/findById and service list/findById/dependencies/streams are open to every authenticated user; `getNetwork/updateNetwork` (project and service) and especially `provisionDnsRecord` (`service-network.service.ts:181`) let any logged-in user write arbitrary DNS records into the platform zone; sub-service creation can target any project (`service.repository.ts:276`); template get/update/delete not project-scoped.
2. Privilege escalation: owner role grantable by a maintainer (`assertNotOwnerGrant` never called); `webhook.service.ts`/`api-key.service.ts` still gate on nonexistent `"admin"`.
3. Secrets: basic-auth password, webhook secret, service env vars stored and returned in clear; encrypted `environment_variables` table unused; `authSecretRef` fake.
4. Deploy ignores the service's own configuration (source, builder, ports, commands, health, volumes, secrets) and the UI can only deploy GitHub sources without a builder -> likely no artifact; container-registry/manual/artifact-bundle/GitLab/Bitbucket services created in the wizard cannot be deployed from the UI.
5. Dependency graph and environment rules are decorative at deploy time (no cascade, no ordering, no env gating, env `isActive`/link `isEnabled`/overrides ignored).
6. Previews: PR webhook cannot resolve a service (placeholder `full_name`), never builds the PR, no push handling, no GitLab; deployment rules never evaluated; cleanup/create name mismatch.
7. No resource teardown on service/project delete (containers, swarm services, Traefik routes, DNS records, volumes, previews remain).
8. New projects have no environments; environment status never changes; refresh endpoint throws; "Config" link in service env page is broken (name instead of UUID).
9. Project settings that look like features (notifications, resource defaults/quotas, basic auth, IP allowlist, rollback, timeouts, preview/cleanup limits) do nothing.
10. Service overview always shows "unknown" status (phantom fields).
11. Duplicate implementations (monolith vs svc-project) with diverged role logic; `docs/v2-v3-project-pages-comparison.md` misleading.
12. Test coverage gaps: no ServiceService/preview-topology/network/repository specs in svc-project; type-check logs show errors.

## 4. Required for production (concrete, ordered)

1. Close authz: introduce `ProjectAccessService`-style checks (read level) on every list/get/stream/network/dependency procedure; scope `project.list`/`service.list` and streams to projects the user owns or collaborates on (platform admins excepted); require `deploy`/`admin` level for network updates; remove or strictly validate `provisionDnsRecord` (hostname must be within the project's zone, record type allowlist); force `child.projectId = parent.projectId` and verify `parentId` ownership; scope templates to a project.
2. Fix role escalation: call `assertNotOwnerGrant` on invite/update, add a "cannot modify equal/higher role" rule; fix `"admin"` role strings in webhook/api-key services (or delete them if unused).
3. Make deployment resolve everything from the service: source from `providerConfig` (repo, branch, rootPath, buildContext, dockerfilePath, image), builder from `builderId`/`builderConfig` (with a real auto-detect), runtime config (port, health path/interval/timeout/retries, start command, args, ports, resources, volumes) wired into the runner; stop hardcoding `/health`. Remove the web's inline source building.
4. Authenticated git: use GitHub App installation tokens / PAT / GitLab tokens for `ls-remote` and clone (and full-depth or fetch-by-sha for commit pins); add GitLab to the builder; decide what to do with Bitbucket.
5. Secrets: store env vars through the encrypted table (with `isSecret`, masking on read, write-only update), encrypt `basicAuthPassword`/`webhookSecret`, implement or remove `authSecretRef`/`secretRefs`.
6. Seed default environments (production/staging/preview/development) on project creation; enforce env `isActive`, link `isEnabled`, `rules` and `overrides` in `triggerDeployment`; implement per-env variables (`environmentVariables` table + UI + resolver layer) and fix the `environmentId={env}` link.
7. Previews: resolve repo->service(s) (store repo full_name on provider config, index it), pass `projectId`, evaluate deployment rules, actually trigger a `preview` deployment of the PR ref, handle `push` for auto-deploy (honouring `autoDeployEnabled`/`autoSyncEnabled`/branch filters), share naming between create and cleanup, make TTL configurable (`autoCleanupDays`, `maxPreviewEnvironments`), await/queue instead of fire-and-forget, run overlay service.
8. Dependency graph at deploy: ordered/cascading deploys for required dependencies (`dependencyGraph` is already in the payload), plus failure gating; add dependency add/remove UI.
9. Teardown on delete: emit and consume `service.deleted`/`project.deleted` (stop swarm service/containers, remove routes, DNS, previews, optionally volumes), with a confirmation that states what is destroyed.
10. Enforce or delete the dead project settings (notifications, quotas/limits, basic auth, IP allowlist, rollback, timeouts); until then hide them in the UI so it stops promising behaviour.
11. Fix the web: server-side `projectId` filter on all project pages; proper pagination; use real service status from deployments/containers instead of phantom fields; wire or remove "Refresh status"; delete dead components (`trigger-dialog.tsx`, `trigger-source.ts`, `development-session.ts`).
12. Tests: add ServiceService, preview-topology, network services, repositories (against a real/test DB) and authz negative tests (non-member read/write of every procedure). Re-run `bun run check` and clear the type errors.
13. Delete the monolith copies of project/service once cutover is complete and update `docs/v2-v3-project-pages-comparison.md`.

## 5. Recommended enhancements

- Replace JSONB `settings` blob with typed columns (or versioned schema) and validate patches with the contract schemas; today `merged = {...current, ...patch}` accepts anything the contract lets through.
- Enforce unique (project, service name), (project, env slug); add FKs/unique constraints that exist only in raw SQL (`service_environments_unique` is in migration 0020 but not in the Drizzle schema).
- Collaborator invitation flow (pending/accepted, email), project ownership transfer, audit log of project/service changes (an `environment_access_logs` table already exists).
- Aggregate project detail endpoint (services + deps + latest deployments) in the BFF screen layer instead of N+1 client queries.
- Real environment health: compute status from running replicas/health checks and drive `environments.status`.
- Project quotas: enforce `maxServicesPerProject` and default resource limits in `createService`.
- Make `updateEnvironment` take a typed patch and validate `rules`/`trigger` with the entity schemas.
- Validate DNS record names/hostnames against zone ownership in both project and service network services.

## 6. Recommended new features

- One-click/app templates (databases, common stacks, compose recipes) with a real implementation behind the `template` contract (or remove that contract).
- Per-service scheduled jobs/cron and one-off tasks; project Jobs/Activity/Monitoring/SSL tabs (v2 parity).
- Env var groups/shared secrets, import/export `.env`, reference syntax between services (`${{db.URL}}`), diff/history and rollback of config.
- Preview environments with PR comments (status check + URL), per-PR env overlays, automatic seed/mocks, cost/TTL controls, a preview list per project.
- Real buildpacks (Nixpacks/Railpack/CNB binaries) with caching and build logs, plus remote build workers.
- Monorepo support (root path filters, watch paths) and deployment rules UI (the `github_deployment_rules` backend exists without UI).
- Volume management UI (create/attach/backup/restore), S3/NFS mounts across swarm nodes.
- Rollout gates tied to environment rules (approvals for production, canary/blue-green executed by the runtime), notifications (Slack/email/webhooks) honouring the stored settings.
- Project-level API keys and outbound webhooks (the services exist unwired).
