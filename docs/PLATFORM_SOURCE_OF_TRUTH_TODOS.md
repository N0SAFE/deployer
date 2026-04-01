# Platform Source of Truth — Implementation TODOs

> Version: 2026-03-27  
> Canonical source statements: `v3/docs/PLATFORM_SOURCE_OF_TRUTH.md`  
> Rule: each statement has its own todo list. A statement is complete only when all todos under that statement are done.

---

## How to use this file

- Each statement ID (`S001` ... `S177`) maps directly to one statement in `PLATFORM_SOURCE_OF_TRUTH.md`.
- For each statement:
  - complete implementation tasks,
  - validate with tests/checks,
  - update related docs/contracts/mocks when applicable.
- When the source statement changes, update the matching `Sxxx` block immediately.

---

## Implementation tracks (execute before deep feature coding)

These tracks split delivery into backend and frontend lanes so API and Web can progress in parallel while staying aligned to `S001...S177`.

### API track (contracts, services, controllers, orchestration)

- [ ] Finalize canonical API domain boundaries and module ownership map for statements `S007...S177`.
- [ ] Lock contract-first sequence for each domain: `contracts -> api module -> tests -> web hooks`.
- [ ] Implement and/or harden project/service/environment invariants (`S007...S022`, `S161...S177`) in contracts + scenario validators.
- [ ] Implement tenancy + RBAC backend enforcement (`S023...S029`, `S129...S133`) at API boundaries.
- [ ] Implement setup/bootstrap backend state machine and endpoints (`S030...S036`).
- [ ] Implement project/service lifecycle APIs with per-environment runtime capabilities (`S037...S045`).
- [ ] Implement environment policy APIs including preview/development activation controls (`S046...S054`).
- [ ] Implement source/provider/build pipeline APIs (`S055...S061`).
- [ ] Implement deployment lifecycle, rollback, approval gates, and strategy APIs (`S062...S071`).
- [ ] Implement dependency graph and orchestration APIs (`S072...S080`).
- [ ] Implement development-mode backend contracts/session lifecycle (token, provisioning, cleanup) (`S081...S091`).
- [ ] Implement networking/domain/ingress backend integrations (`S092...S099`, `S151`).
- [ ] Implement runtime operator APIs (containers/logs/exec/files/images/networks/volumes) (`S100...S107`).
- [ ] Implement compose stack APIs and lifecycle (`S108...S113`, `S147`).
- [ ] Implement managed database APIs and backup/restore/audit capabilities (`S114...S119`, `S146`, `S150`).
- [ ] Implement observability/alerts/notifications backend surfaces (`S120...S126`, `S149`, `S154`).
- [ ] Implement security hardening and auditability controls (`S127...S139`).
- [ ] Implement multi-node/fleet placement and orchestration APIs (`S134...S145`, `S148`).
- [ ] Ensure API/CLI parity and automation stability checks (`S142`, `S152`).
- [ ] Add/expand service + controller + integration test coverage for each implemented statement cluster.

### Web/UI track (dashboard, forms, flows, visual orchestration)

- [ ] Define web information architecture for statements requiring operator UX (`S002`, `S006`, `S037...S160`).
- [ ] Build tenant-aware navigation and permission-aware page gating using role and grant model (`S023...S029`).
- [ ] Build setup/bootstrap wizard UX mapped to setup state machine (`S030...S036`).
- [ ] Build project/service CRUD screens and advanced configuration editors (`S037...S045`).
- [ ] Build environment management UX:
  - [ ] base `production`,
  - [ ] explicit `preview` / `development` enablement,
  - [ ] custom environments with independent policies (`S046...S054`).
- [ ] Build source/build/provider configuration surfaces with webhook/status visibility (`S055...S061`).
- [ ] Build deployment timeline, logs, retry/rollback, approvals, and strategy controls (`S062...S071`).
- [ ] Build dependency graph editor with per-environment policy controls (`S072...S080`).
- [ ] Build development-mode UX (session start/stop/status, execution location, dependency behavior) (`S081...S091`, `S167`, `S177`).
- [ ] Build domains/ingress/network configuration views and route health visibility (`S092...S099`, `S151`).
- [ ] Build runtime operations console (logs, inspect, exec, files, image/network/volume actions) with safe UX guards (`S100...S107`).
- [ ] Build compose stack management screens and operation timelines (`S108...S113`, `S147`).
- [ ] Build managed database operation UX (provisioning, backups, restore, audit timeline) (`S114...S119`, `S146`, `S150`).
- [ ] Build observability dashboards (deploy/runtime health, incidents, fleet metrics) (`S120...S126`, `S149`, `S154`).
- [ ] Build node/fleet management screens (inventory, health, placement, failover actions) (`S134...S145`, `S148`).
- [ ] Build docs-linked governance UX tasks for statement traceability and divergence visibility (`S155...S160`).
- [ ] Add component and page-level tests for critical operator flows and permission boundaries.

### Cross-track sync (mandatory)

- [ ] For each completed API cluster, wire matching Web hooks/domain adapters before marking statement group done.
- [ ] Keep contract changes and UI form/schema changes in the same PR when affecting shared statement scope.
- [ ] Update statement-level checklists (`S001...S177`) as soon as API/Web subtasks are completed.
- [ ] Block feature closure if either API or Web lane is missing required acceptance evidence.

---

## Per-statement implementation todo lists

### S001
- [ ] Define self-hosted PaaS scope in `v3/apps/doc/content/docs/architecture/platform-source-of-truth.mdx` with explicit in-scope capabilities.
- [ ] Ensure product entities (`organization`, `project`, `service`, `environment`) are represented in contracts and fixture models.
- [ ] Add acceptance notes showing that deployment and runtime workflows execute without managed cloud dependency.

### S002
- [ ] Document the cloud-like DX principles (fast deploy, logs, rollback, previews) in architecture/product docs.
- [ ] Add UX checklist items in web backlog/docs to validate equivalent cloud-style workflow in dashboard.
- [ ] Link implementation evidence from UI screens and API flows that preserve user infra/data control.

### S003
- [ ] Specify export/portability requirements for deployment/runtime artifacts in docs and API design notes.
- [ ] Add backlog task to support artifact/state portability outside control plane lock-in paths.
- [ ] Add validation scenario proving services remain operable with externally managed runtime artifacts.

### S004
- [ ] Define single-node and multi-node topology support in platform architecture docs.
- [ ] Add implementation tasks for node registration, node metadata, and scheduler placement awareness.
- [ ] Add test matrix entries for single-node and multi-node deployment lifecycle flows.

### S005
- [ ] Split requirements into OSS self-hosted baseline vs optional managed/cloud operational layer.
- [ ] Add feature flags/config boundaries for managed-only features so OSS mode remains fully usable.
- [ ] Document deployment/packaging strategy for both distributions and expected parity level.

### S006
- [ ] Add positioning statement in docs aligning UX target to Vercel/Render/Heroku-style workflows.
- [ ] Define measurable parity criteria (build logs, domains, previews, rollback, env controls).
- [ ] Add release checklist to track parity criteria completion per milestone.

### S007
- [ ] Ensure organization aggregate includes project collection in contracts/entities.
- [ ] Add service-layer guardrails enforcing project creation under valid organization context.
- [ ] Add tests validating organization-level project listing and isolation behavior.

### S008
- [ ] Ensure project aggregate includes service collection in contracts/entities and fixture builder.
- [ ] Add schema validation that prevents orphan services without project ownership.
- [ ] Add tests for project-scoped service CRUD visibility.

### S009
- [ ] Ensure project aggregate includes environment collection in contracts/entities.
- [ ] Add schema validation that environment identifiers are unique per project.
- [ ] Add tests for project-level environment CRUD and retrieval.

### S010
- [ ] Enforce mandatory `production` base environment in project creation and scenario builders.
- [ ] Add API/service validation rejecting project state without `production`.
- [ ] Add tests covering create/update validation for base environment invariance.

### S011
- [ ] Define custom environment creation model (`name`, `intent`, `policy`, `runtime`) in contracts.
- [ ] Add validation rules that non-reserved names are treated as custom environments.
- [ ] Add tests ensuring custom environments are project-scoped and independently configurable.

### S012
- [ ] Reserve `preview` as protected environment key in contracts and UI creation flows.
- [ ] Add explicit enablement flag for `preview` at project level.
- [ ] Add tests ensuring `preview` cannot be configured/used before explicit enablement.

### S013
- [ ] Reserve `development` as protected environment key in contracts and UI creation flows.
- [ ] Add explicit enablement flag for `development` at project level.
- [ ] Add tests ensuring `development` cannot be configured/used before explicit enablement.

### S014
- [ ] Extend environment creation form/schema with intent fields (behavior, dependency policy, runtime policy).
- [ ] Persist intent metadata in project environment model and expose it in API responses.
- [ ] Add tests verifying intent-driven fields round-trip across create/read/update flows.

### S015
- [ ] Add per-custom-environment lifecycle controls (enable/disable, rollout policy, cleanup policy).
- [ ] Ensure disabling an environment preserves configuration payload.
- [ ] Add tests for disable/enable cycles without data loss.

### S016
- [ ] Enforce one-to-one service→project ownership at schema and repository layers.
- [ ] Add guards preventing service reassignment across projects without explicit migration flow.
- [ ] Add tests covering rejected cross-project ownership mutations.

### S017
- [ ] Ensure service runtime environment map is derived from parent project environment set.
- [ ] Add validation rejecting service runtime entries for undefined project environments.
- [ ] Add tests validating inheritance behavior after project environment updates.

### S018
- [ ] Add validation that pinned service environment exists in current project environment set.
- [ ] Return clear typed API error when pinned environment is invalid.
- [ ] Add tests for valid/invalid pinned environment transitions.

### S019
- [ ] Validate dependency edges so source and target service IDs resolve within same project scenario.
- [ ] Reject cross-project dependency edges unless explicitly supported by a future contract.
- [ ] Add tests for dependency graph integrity under add/update/remove operations.

### S020
- [ ] Validate `enabledIn` values against project-defined environment names.
- [ ] Add migration-safe fixture checks ensuring dependency activation never references unknown environments.
- [ ] Add tests for dependency activation behavior across environment add/remove changes.

### S021
- [ ] Validate provider and runner records against both `projectId` and `serviceId` ownership constraints.
- [ ] Add schema/service checks rejecting mismatched provider/runner linkage.
- [ ] Add tests for valid linkage and cross-project/service mismatch rejection.

### S022
- [ ] Model project-level environment policy as the default parent for service runtime behavior.
- [ ] Implement explicit per-service override merge logic with deterministic precedence.
- [ ] Add tests proving inherited defaults and override behavior per environment.

### S023
- [ ] Define platform super-admin role and scope boundaries in auth model and docs.
- [ ] Add authorization checks for platform-wide operations requiring super-admin scope.
- [ ] Add tests for super-admin allowed paths and non-super-admin denial paths.

### S024
- [ ] Enforce organization-level isolation in read/write queries and service boundaries.
- [ ] Add tenant scoping middleware/guards at API entry points.
- [ ] Add tests ensuring users cannot access resources from other organizations.

### S025
- [ ] Enforce project-level isolation under organization scope in repositories and services.
- [ ] Prevent cross-project resource lookup without explicit authorized relation.
- [ ] Add tests for project boundary enforcement across all project-scoped endpoints.

### S026
- [ ] Extend permission model with service-level actions (read, deploy, update config, operate runtime).
- [ ] Wire service-level checks into API handlers for service-sensitive operations.
- [ ] Add tests validating permission evaluation per service action.

### S027
- [ ] Define baseline roles Owner/Admin/Developer/Viewer in central auth/contracts package.
- [ ] Map role permissions to platform, organization, project, and service capabilities.
- [ ] Add tests confirming baseline role matrices behave as documented.

### S028
- [ ] Add fine-grained permission grants model (resource + action + scope) for enterprise governance.
- [ ] Implement conflict-resolution rules between role defaults and explicit grants.
- [ ] Add tests for grant precedence, inheritance, and revocation behavior.

### S029
- [ ] Ensure auth checks execute at API boundary middleware/handlers, not only in UI components.
- [ ] Audit mutation/read endpoints for missing guard usage and remediate gaps.
- [ ] Add integration tests proving forbidden access is blocked even with forged UI requests.

### S030
- [ ] Implement first-run setup step for validating and persisting database connectivity.
- [ ] Expose setup validation errors with actionable diagnostics.
- [ ] Add tests for successful setup and invalid DB configuration failures.

### S031
- [ ] Implement first admin bootstrap flow with secure credential/session creation.
- [ ] Ensure bootstrap can only create initial admin when platform is uninitialized.
- [ ] Add tests for idempotency and prevention of duplicate first-admin bootstrap.

### S032
- [ ] Add setup step to create/assign initial organization context during bootstrap.
- [ ] Persist organization linkage to bootstrap admin identity.
- [ ] Add tests covering successful initial org creation and duplicate initialization protection.

### S033
- [ ] Define setup lifecycle as explicit state machine (`uninitialized`, `db-ready`, `admin-ready`, `org-ready`, `complete`).
- [ ] Implement state transition guards and failure recovery transitions.
- [ ] Add tests validating legal and illegal transitions.

### S034
- [ ] Expose setup state read endpoint for UI and automation clients.
- [ ] Ensure endpoint is safe before full auth initialization (limited data only).
- [ ] Add tests for state endpoint accuracy across all setup phases.

### S035
- [ ] Persist partial setup progress so interrupted setup can resume.
- [ ] Implement resume workflow that continues from last valid completed step.
- [ ] Add tests simulating interruption/restart during each setup phase.

### S036
- [ ] Define node identity model (node ID, labels, capabilities, bootstrap metadata).
- [ ] Persist node bootstrap metadata and link it to setup completion state.
- [ ] Add tests ensuring node identity persists and loads correctly after restart.

### S037
- [ ] Implement project CRUD service/controller/contracts with tenant isolation guards.
- [ ] Add request/response validation schemas for all project operations.
- [ ] Add tests for happy-path and forbidden/not-found CRUD scenarios.

### S038
- [ ] Implement collaborator invite/add/remove/role-change workflows for projects.
- [ ] Add audit trail entries for collaborator permission and membership changes.
- [ ] Add tests covering invite lifecycle and role transition constraints.

### S039
- [ ] Implement service CRUD contracts and APIs scoped to project ownership.
- [ ] Ensure delete operations handle dependent resources consistently (soft/hard policy).
- [ ] Add tests for lifecycle operations and conflict/not-found behaviors.

### S040
- [ ] Model workload type enum (`web`, `worker`, `cron`, `one-shot`) in contracts and DB schema.
- [ ] Add workload-specific validation rules where configuration differs by workload type.
- [ ] Add tests for workload creation/update validation matrix.

### S041
- [ ] Define service configuration sections (`provider`, `build`, `runner`, `health`) in contract schemas.
- [ ] Implement UI/API editing and persistence for each section with typed validation.
- [ ] Add tests verifying section-level updates do not corrupt unrelated sections.

### S042
- [ ] Implement runtime scaling model with `minReplicas`, `maxReplicas`, and autoscaling policy fields.
- [ ] Validate replica bounds and autoscaling thresholds.
- [ ] Add tests for scaling configuration correctness and invalid bound rejection.

### S043
- [ ] Add per-environment runtime override support for service execution parameters.
- [ ] Implement merge precedence between project defaults and service environment overrides.
- [ ] Add tests for per-environment override resolution.

### S044
- [ ] Track runtime status by environment in service state model.
- [ ] Expose environment-scoped status in API and dashboard views.
- [ ] Add tests for status coverage completeness when environments are enabled/disabled.

### S045
- [ ] Implement project-level default configuration templates applied on service creation.
- [ ] Allow service-level overrides while preserving traceable link to inherited defaults.
- [ ] Add tests validating default inheritance and override persistence.

### S046
- [ ] Add per-environment health gate config fields to contracts/entities used by project environment policy.
- [ ] Wire health gate policy into deployment progression checks in API service logic.
- [ ] Add tests for strict/warn/ignore-like health gate outcomes during rollout.

### S047
- [ ] Add startup mode per environment (cold start, warm start, pre-provisioned) in environment schema.
- [ ] Map startup mode into runtime runner preparation behavior.
- [ ] Add tests validating startup mode effects on deployment execution ordering.

### S048
- [ ] Add per-environment replica bound fields (`minReplicas`, `maxReplicas`) at project environment level.
- [ ] Enforce bound validation and merge with service-level override rules.
- [ ] Add tests for valid bound ranges and invalid range rejection.

### S049
- [ ] Add per-environment traffic policy configuration (direct, weighted, gated) to project policies.
- [ ] Integrate traffic policy into route/update steps in deployment workflow.
- [ ] Add tests validating route behavior under each traffic policy mode.

### S050
- [ ] Add environment-scoped variable sets to project environment model and API payloads.
- [ ] Implement merge order between environment variables and service runtime overrides.
- [ ] Add tests covering variable resolution precedence by environment.

### S051
- [ ] Add project-level default variable set in contracts/entities (`defaultVariables` style block).
- [ ] Ensure default variables are inherited by all project environments unless overridden.
- [ ] Add tests for default variable inheritance and override fallback.

### S052
- [ ] Ensure project bootstrap flow always initializes `production` environment records.
- [ ] Prevent bootstrap path from selecting non-production default environment.
- [ ] Add tests proving new project bootstrap always includes `production` as default.

### S053
- [ ] Add explicit `previewEnabled` project setting and guard checks in preview-dependent APIs.
- [ ] Hide/disable preview controls in web UI when `previewEnabled=false`.
- [ ] Add tests for preview operations failing when preview is not enabled.

### S054
- [ ] Add explicit `developmentEnabled` project setting and guard checks in dev-mode APIs.
- [ ] Ensure development controls are unavailable until project-level enablement is true.
- [ ] Add tests for dev session APIs rejecting requests when development is disabled.

### S055
- [ ] Implement Git-based source provider contracts/services (GitHub/GitLab/Git URL clone paths).
- [ ] Add source checkout abstraction in provider registry for git providers.
- [ ] Add tests for branch/tag/commit checkout behavior with provider adapters.

### S056
- [ ] Implement artifact/image source provider support (registry image, uploaded artifact bundle).
- [ ] Add typed source discriminators so runtime resolves git vs artifact/image paths deterministically.
- [ ] Add tests for artifact/image trigger flows and invalid source payload rejection.

### S057
- [ ] Ensure dockerfile runner path is first-class in runner contracts and execution workflow.
- [ ] Implement dockerfile build execution from source checkout context.
- [ ] Add tests proving dockerfile build path succeeds and records build metadata.

### S058
- [ ] Add autodetect build strategy contract (Nixpacks-style) with explicit fallback rules.
- [ ] Implement buildpack/autodetect runner resolution in compile/prepare phase.
- [ ] Add tests for autodetect success, explicit override, and unsupported detection failure.

### S059
- [ ] Ensure pre-built image deploy path skips build and validates image reference integrity.
- [ ] Add image pull and runtime start pipeline for image-only deployments.
- [ ] Add tests for image deploy happy path and missing image tag failure.

### S060
- [ ] Add build configuration schema fields: root path, build context, branch/tag selector, secret refs.
- [ ] Propagate build config through trigger → queue → execution workflow payloads.
- [ ] Add tests for build config propagation and invalid secret reference handling.

### S061
- [ ] Implement webhook auto-sync handling for provider integrations in `github`/provider modules.
- [ ] Add idempotent webhook processing with signature validation and replay window guards.
- [ ] Add tests for duplicate delivery handling and unauthorized webhook rejection.

### S062
- [ ] Enforce deployment lifecycle enum with states `queued/building/deploying/success/failed/cancelled`.
- [ ] Add strict transition validation in deployment service lifecycle methods.
- [ ] Add tests covering allowed transitions and invalid transition rejection.

### S063
- [ ] Persist deployment lifecycle state changes in DB with timestamps.
- [ ] Expose query endpoints for deployment list/detail history with pagination.
- [ ] Add tests validating persistence and retrieval consistency.

### S064
- [ ] Standardize structured deployment log schema (`phase`, `step`, `message`, `metadata`, `timestamp`).
- [ ] Ensure runtime workflow emits logs at each significant deployment phase step.
- [ ] Add tests for log insertion format and ordering guarantees.

### S065
- [ ] Implement deployment cancellation API with state guards for cancellable phases.
- [ ] Propagate cancellation signal to queue worker/runtime workflow safely.
- [ ] Add tests for successful cancellation and non-cancellable state rejection.

### S066
- [ ] Implement deployment retry action that reuses validated source/build context.
- [ ] Track retry metadata (`retryOf`, attempt count) on deployment records.
- [ ] Add tests for retry flow and retry eligibility checks.

### S067
- [ ] Implement rollback action selecting previous successful deployment for same service/environment.
- [ ] Re-run route and health verification as part of rollback workflow.
- [ ] Add tests for rollback success and no-previous-successful-deployment errors.

### S068
- [ ] Enforce health check gating before marking deployment as successful.
- [ ] Add configurable health timeout/retry policy at environment/service levels.
- [ ] Add tests for healthy progression and unhealthy deployment fail-fast behavior.

### S069
- [ ] Add environment-specific deployment policy model (strategy, gate, approval, retries).
- [ ] Resolve deployment policy by target environment during compile/execute phases.
- [ ] Add tests for environment policy resolution correctness.

### S070
- [ ] Add manual approval gate state and reviewer action endpoints for protected environments.
- [ ] Block execution progression until approval is granted or explicitly denied.
- [ ] Add tests for approval-required workflow and unauthorized approval attempts.

### S071
- [ ] Implement deploy strategy model supporting canary/rolling/blue-green/manual classes.
- [ ] Map strategy classes to orchestrator step templates and health progression rules.
- [ ] Add tests per strategy class for rollout and failure handling behavior.

### S072
- [ ] Represent service dependencies as directed graph data in contracts/entities.
- [ ] Build graph resolver utility for project runtime planning.
- [ ] Add tests for DAG construction and node/edge integrity.

### S073
- [ ] Add dependency mode enum (`required`, `optional`, `disabled`) in dependency contracts.
- [ ] Implement runtime behavior differences per mode in orchestration logic.
- [ ] Add tests covering failure/skip semantics by dependency mode.

### S074
- [ ] Add dependency health gate policy (`strict`, `warn`, `ignore`) in dependency config.
- [ ] Apply health policy during dependency readiness evaluation.
- [ ] Add tests for strict blocking vs warning continuation vs ignore behavior.

### S075
- [ ] Add startup ordering policy (`before`, `parallel`, `after`) to dependency edges.
- [ ] Integrate ordering policy into compiled execution DAG generation.
- [ ] Add tests validating resulting execution order for each policy.

### S076
- [ ] Add attachment mode config for dependencies (single-target vs filtered multi-target selection).
- [ ] Implement target selection resolver with deterministic filter evaluation.
- [ ] Add tests for attachment selection correctness and invalid filter handling.

### S077
- [ ] Support dependency policy overrides per environment in project/service dependency configs.
- [ ] Merge environment-specific dependency policy with project defaults.
- [ ] Add tests for per-environment dependency policy resolution.

### S078
- [ ] Add retries, timeout, and target-selection parameters to dependency policy schema.
- [ ] Apply these parameters in dependency orchestration executor.
- [ ] Add tests for timeout/retry behavior and deterministic target selection.

### S079
- [ ] Add advanced dependency controls: circuit breaker, failure mode, telemetry hooks.
- [ ] Implement telemetry events for dependency failure and circuit state transitions.
- [ ] Add tests for circuit open/half-open/closed behavior.

### S080
- [ ] Implement UI graph control actions (enable/disable edge, preset apply, policy context actions).
- [ ] Back graph controls with typed mutation endpoints and optimistic updates.
- [ ] Add UI and API tests validating graph policy action correctness.

### S081
- [ ] Mark development mode as future-gated capability in roadmap/inventory docs and feature flags.
- [ ] Add feature toggle that blocks unfinished development mode APIs in production path.
- [ ] Add tests ensuring gated endpoints remain inaccessible when disabled.

### S082
- [ ] Implement token issuance endpoint for development sessions with authenticated user requirement.
- [ ] Bind token issuance to explicit project/service authorization checks.
- [ ] Add tests for token issuance success and unauthorized denial.

### S083
- [ ] Add short TTL and revocation model for development session tokens.
- [ ] Persist token revocation state and enforce revocation at session start/heartbeat.
- [ ] Add tests for expiry enforcement and immediate revocation behavior.

### S084
- [ ] Embed `projectId`, `serviceId`, and subject identity claims into development session tokens.
- [ ] Validate scoped claims at every dev-mode API boundary.
- [ ] Add tests for scope mismatch rejection and valid scope acceptance.

### S085
- [ ] Define local-machine wrapper integration contract for initiating development sessions.
- [ ] Implement API handshake used by wrapper to request cloud execution resources.
- [ ] Add integration tests for wrapper handshake and malformed payload rejection.

### S086
- [ ] Implement cloud-hosted container execution path for development sessions.
- [ ] Ensure dev execution preserves local UX conventions (port forwarding, feedback loop semantics).
- [ ] Add tests validating local-to-cloud session startup behavior.

### S087
- [ ] Resolve and start required dependency services automatically during dev session provisioning.
- [ ] Respect dependency mode/gate policies while resolving session dependency graph.
- [ ] Add tests for automatic dependency startup and failure behavior.

### S088
- [ ] Add per-service execution location policy (`local`, `cloud`, `dependency-managed`) in dev config.
- [ ] Implement scheduler logic that applies execution-location policy per service during session plan creation.
- [ ] Add tests for mixed execution-location session plans.

### S089
- [ ] Add explicit per-service dependency behavior rules for dev sessions (force local, force remote, inherit).
- [ ] Apply rules during dependency resolution and runtime linking.
- [ ] Add tests verifying precedence and conflict handling of dependency behavior rules.

### S090
- [ ] Implement deterministic development session teardown (stop containers, release routes, revoke tokens).
- [ ] Add TTL-triggered and explicit-stop cleanup handlers.
- [ ] Add tests for complete cleanup and orphan-resource prevention.

### S091
- [ ] Define development session lifecycle state machine (`requested`, `provisioning`, `running`, `degraded`, `stopping`, `stopped`).
- [ ] Expose lifecycle state transitions in API and realtime stream endpoints.
- [ ] Add tests for valid state transitions and degraded-state recovery behavior.

### S092
- [ ] Implement Traefik-based ingress as canonical routing adapter in runtime route services.
- [ ] Ensure deploy workflows call Traefik sync + verification before success completion.
- [ ] Add tests for route apply success/failure and retry fallback behavior.

### S093
- [ ] Add domain attachment model for HTTP workloads in service/runtime config.
- [ ] Implement attach/detach domain endpoints with ownership and uniqueness checks.
- [ ] Add tests for domain attach validation and conflict handling.

### S094
- [ ] Support multiple custom domains per service in schema and routing pipeline.
- [ ] Ensure all attached domains are synced to Traefik config and route health checks.
- [ ] Add tests for multi-domain attach/update/remove flows.

### S095
- [ ] Implement managed TLS automation flow for managed domains.
- [ ] Persist certificate issuance/renewal status in domain metadata.
- [ ] Add tests for certificate provisioning and renewal failure paths.

### S096
- [ ] Add custom certificate upload/reference path for advanced domain configurations.
- [ ] Integrate custom cert references into route sync without breaking managed cert automation.
- [ ] Add tests for custom certificate validation and route binding behavior.

### S097
- [ ] Implement deterministic preview subdomain naming strategy service.
- [ ] Apply naming strategy in preview create/update workflow and DNS/route generation.
- [ ] Add tests ensuring stable naming across repeated preview updates.

### S098
- [ ] Define project-private network boundary model for internal service communication.
- [ ] Enforce private network attachment policy in runtime runner networking setup.
- [ ] Add tests for internal-only service accessibility and boundary isolation.

### S099
- [ ] Implement control-plane level service discovery abstraction for cross-node communication.
- [ ] Ensure routing/discovery updates are synchronized with node topology changes.
- [ ] Add tests for cross-node service resolution under node add/remove events.

### S100
- [ ] Implement direct runtime container lifecycle operations (create/start/stop/restart/remove) in operator APIs.
- [ ] Enforce permission checks for each operation and audit logging.
- [ ] Add tests for lifecycle operation success and forbidden access.

### S101
- [ ] Implement logs streaming and historical logs retrieval endpoints for runtime containers.
- [ ] Provide pagination/tail filters for non-stream log queries.
- [ ] Add tests for stream continuity and historical retrieval accuracy.

### S102
- [ ] Expose container inspect metadata and runtime metrics via operator APIs.
- [ ] Normalize inspect/metrics payloads for dashboard consumption.
- [ ] Add tests validating inspect fields and metric stream payload shape.

### S103
- [ ] Implement image operations (pull/tag/remove/prune) with policy guards.
- [ ] Add safety checks for destructive image prune/remove operations.
- [ ] Add tests for image operation success/failure and guard enforcement.

### S104
- [ ] Implement baseline volume and network management APIs (list/create/remove/connect/disconnect).
- [ ] Enforce project/node scope controls on network and volume operations.
- [ ] Add tests for network/volume lifecycle operations and invalid scope rejection.

### S105
- [ ] Implement interactive exec terminal API path for operators with streaming transport.
- [ ] Add command/session constraints and idle timeout handling for exec sessions.
- [ ] Add tests for exec session start/stop and permission enforcement.

### S106
- [ ] Implement runtime file transfer APIs (upload/download/copy) for containers.
- [ ] Add file size/type guardrails and path safety validation.
- [ ] Add tests for file transfer success and unsafe path rejection.

### S107
- [ ] Attach RBAC permission gates to all runtime operation endpoints.
- [ ] Centralize runtime operation authorization matrix by action and scope.
- [ ] Add tests for each runtime operation under allowed/forbidden role combinations.

### S108
- [ ] Implement compose stack deployment model and API contract for stack resources.
- [ ] Add stack source resolution path (git/file) before deploy execution.
- [ ] Add tests for compose stack create/deploy lifecycle.

### S109
- [ ] Implement full compose stack lifecycle operations: deploy/start/stop/restart/update/remove.
- [ ] Enforce state guards on operations based on current stack status.
- [ ] Add tests for legal/illegal compose lifecycle transitions.

### S110
- [ ] Support git-sourced and file-sourced compose definitions in stack model.
- [ ] Add validation and normalization pipeline for compose file ingestion.
- [ ] Add tests for git/file source parsing and invalid compose rejection.

### S111
- [ ] Persist compose stack operation timeline with status events and logs.
- [ ] Expose stack timeline query endpoints for operator diagnostics.
- [ ] Add tests for timeline completeness across stack operations.

### S112
- [ ] Implement env var and secret wiring for compose stack execution.
- [ ] Ensure secret values are never exposed in plaintext logs/events.
- [ ] Add tests for secret injection and redaction compliance.

### S113
- [ ] Implement compose rollback workflow where previous valid revisions exist.
- [ ] Store stack revision history to support rollback target selection.
- [ ] Add tests for rollback success and rollback-not-available cases.

### S114
- [ ] Model managed database resources as first-class entities linked to projects/services.
- [ ] Add CRUD/service APIs for managed database provisioning lifecycle.
- [ ] Add tests for managed database entity creation and ownership enforcement.

### S115
- [ ] Define baseline managed database engine catalog (PostgreSQL, MySQL/MariaDB, MongoDB, Redis).
- [ ] Implement engine-specific configuration validation profiles.
- [ ] Add tests for per-engine config validation and unsupported engine rejection.

### S116
- [ ] Implement managed database lifecycle operations (create/start/stop/restart/delete).
- [ ] Add state machine guards for destructive operations and active dependency checks.
- [ ] Add tests for lifecycle transitions and safe delete behavior.

### S117
- [ ] Implement scheduled backup policies for managed databases.
- [ ] Support external backup destination configuration and validation.
- [ ] Add tests for backup schedule trigger and destination failure handling.

### S118
- [ ] Implement restore workflow contracts and orchestration for managed databases.
- [ ] Add pre-restore validation checks (engine compatibility, snapshot existence).
- [ ] Add tests for restore success and invalid restore source errors.

### S119
- [ ] Add audit events for all backup and restore actions.
- [ ] Include actor, resource, timestamp, and result metadata in audit payload.
- [ ] Add tests ensuring backup/restore actions always emit audit entries.

### S120
- [ ] Ensure deployment logs are queryable from API and visible in web dashboards.
- [ ] Add filters for phase/step/level/time range in deployment log retrieval.
- [ ] Add tests for filter correctness and pagination behavior.

### S121
- [ ] Ensure runtime/container logs are queryable and streamable per node/service/container.
- [ ] Add retention and truncation strategy for runtime log persistence.
- [ ] Add tests for runtime log stream stability and retention policy behavior.

### S122
- [ ] Define platform metrics schema for CPU/memory/storage/network usage across resources.
- [ ] Implement metrics collection adapters and API aggregation endpoints.
- [ ] Add tests for metric aggregation integrity and missing-sample handling.

### S123
- [ ] Implement incidents/alerts timeline model for operational events.
- [ ] Emit incident timeline entries from deployment/runtime failure paths.
- [ ] Add tests for incident creation, update, and timeline ordering.

### S124
- [ ] Implement notification dispatch for deployment and incident outcomes.
- [ ] Add notification subscription preferences per project/user/channel.
- [ ] Add tests for notification delivery success and retry/failure handling.

### S125
- [ ] Implement channel adapters for Slack/Discord/Telegram/Email notifications.
- [ ] Add channel-specific payload transformers and configuration validators.
- [ ] Add tests for each channel adapter with success/failure scenarios.

### S126
- [ ] Build high-signal operational dashboard views (deploy health, incident trends, runtime saturation).
- [ ] Add dashboard API aggregations optimized for operator workflows.
- [ ] Add UI tests validating key dashboard widgets and filters.

### S127
- [ ] Ensure secrets are redacted before any log persistence or UI rendering.
- [ ] Add centralized redaction middleware for deployment/runtime logs.
- [ ] Add tests with known secret patterns ensuring plaintext never leaks.

### S128
- [ ] Extend token redaction coverage to API responses, logs, and stream payloads.
- [ ] Add regression tests for sensitive-token masking in edge-case payloads.
- [ ] Add documentation checklist for token handling and redaction boundaries.

### S129
- [ ] Audit all mutation endpoints for authN + authZ enforcement via guards/middleware.
- [ ] Remove any bypass paths that rely solely on UI-side authorization.
- [ ] Add security tests for unauthorized mutation attempts across modules.

### S130
- [ ] Implement session revocation flow for user/admin and active token invalidation.
- [ ] Ensure revocation propagates to dev-session and API access checks immediately.
- [ ] Add tests for revocation effect on active sessions and subsequent requests.

### S131
- [ ] Define explicit intra-platform trust boundaries (API, mesh, runtime agent, control plane).
- [ ] Enforce signed internal envelopes for trust-boundary crossing operations.
- [ ] Add tests for tampered/unsigned internal envelope rejection.

### S132
- [ ] Enforce RBAC checks on cluster and node management operations.
- [ ] Add role matrix for node add/remove/maintenance/inspect actions.
- [ ] Add tests for allowed/forbidden cluster action execution.

### S133
- [ ] Emit audit logs for all security-sensitive actions (auth changes, secrets, deploy control, node control).
- [ ] Ensure audit entries are immutable and actor-attributed.
- [ ] Add tests validating mandatory audit emission for sensitive actions.

### S134
- [ ] Implement remote server onboarding workflow with secure bootstrap token exchange.
- [ ] Persist node onboarding metadata and status in fleet inventory.
- [ ] Add tests for successful onboarding and invalid token rejection.

### S135
- [ ] Implement multi-node placement policy inputs in deployment planning.
- [ ] Add scheduler placement logic considering node capacity and constraints.
- [ ] Add tests for placement determinism and constraint compliance.

### S136
- [ ] Expose node health and inventory APIs for operator dashboards.
- [ ] Implement heartbeat/offline detection with node state transitions.
- [ ] Add tests for node health state updates and stale-node handling.

### S137
- [ ] Define cluster orchestration abstraction compatible with swarm/cluster execution backends.
- [ ] Implement baseline backend adapter interfaces and one concrete backend.
- [ ] Add tests validating backend adapter contract conformance.

### S138
- [ ] Add project/resource placement constraints in project/service policy model.
- [ ] Integrate placement constraints into scheduler decision path.
- [ ] Add tests for hard and soft constraint placement behavior.

### S139
- [ ] Enforce tenant/project isolation in multi-server routing and scheduling operations.
- [ ] Add cross-node isolation assertions in service discovery and network policy layers.
- [ ] Add tests ensuring no cross-tenant route/resource leakage across nodes.

### S140
- [ ] Define SCM integration provider contracts for GitHub/GitLab/Bitbucket/Gitea classes.
- [ ] Implement provider registry and capability flags per SCM adapter.
- [ ] Add tests for provider registration and integration handshake validation.

### S141
- [ ] Implement registry integration model for internal and external registries.
- [ ] Add credential storage and redacted usage for registry auth operations.
- [ ] Add tests for registry auth and image push/pull integration paths.

### S142
- [ ] Ensure API and CLI parity for core automation workflows (deploy, rollback, inspect, logs).
- [ ] Define CLI command contracts mapped to stable API operations.
- [ ] Add parity tests ensuring CLI output and API behavior alignment.

### S143
- [ ] Implement webhook subscription and delivery model for event-driven workflows.
- [ ] Add signed delivery payloads, retries, and dead-letter handling for failed endpoints.
- [ ] Add tests for webhook delivery success, retry, and replay protection.

### S144
- [ ] Implement template-based one-click app bootstrap flow using deployment templates.
- [ ] Add catalog metadata for bootstrap templates (runtime, env vars, dependencies, health defaults).
- [ ] Add tests for template instantiate/deploy workflow correctness.

### S145
- [ ] Define runtime coverage matrix for major app runtimes in feature inventory docs.
- [ ] Implement missing runtime adapters prioritized by target parity goals.
- [ ] Add tests/smoke scenarios per runtime class.

### S146
- [ ] Ensure managed database operations are integrated into control plane UX and APIs.
- [ ] Add operational runbooks for backup/restore/maintenance per engine.
- [ ] Add integration tests for database operation end-to-end flow.

### S147
- [ ] Ensure compose-first workflows support complex app topologies and dependency orchestration.
- [ ] Add template presets for common multi-service compose stacks.
- [ ] Add tests validating compose stack orchestration with inter-service dependencies.

### S148
- [ ] Deliver multi-server operator workflows in web control plane (placement, failover, inventory).
- [ ] Add API actions for cluster-aware deployment targeting.
- [ ] Add tests for multi-server operation flows and fallback behavior.

### S149
- [ ] Integrate notification channels with operational telemetry and incident timelines.
- [ ] Add actionable notification templates with links to deployment/incident context.
- [ ] Add tests for telemetry-triggered notifications and deduplication.

### S150
- [ ] Implement automated backup policies across services/databases with scheduling controls.
- [ ] Add backup health indicators to operator dashboards.
- [ ] Add tests for scheduled backup execution and recovery reporting.

### S151
- [ ] Keep routing/ingress automation coupled with deployment lifecycle and health verification.
- [ ] Add automated drift reconciliation for route config vs runtime state.
- [ ] Add tests for route drift detection and reconciliation success.

### S152
- [ ] Ensure core operations expose stable API automation surfaces with typed contracts.
- [ ] Add API compatibility checks for contract changes in CI.
- [ ] Add tests for backwards-compatible automation endpoints.

### S153
- [ ] Ensure preview deployment workflows are integrated with SCM events and cleanup policies.
- [ ] Add preview lifecycle controls in web dashboard (create/update/teardown/audit).
- [ ] Add tests for full preview lifecycle from webhook to cleanup.

### S154
- [ ] Deliver cluster/fleet observability views for node health, load, deployment pressure.
- [ ] Add fleet-wide metrics aggregation and filtering in dashboard APIs.
- [ ] Add tests for fleet dashboard data integrity under partial node outages.

### S155
- [ ] Maintain this source-of-truth file as canonical scope baseline in docs governance process.
- [ ] Add CI/doc lint check ensuring references point to this file as canonical source.
- [ ] Add governance checklist entry in contributor docs.

### S156
- [ ] Audit feature docs for contradictions against source-of-truth statements.
- [ ] Add docs review workflow requiring contradiction resolution before merge.
- [ ] Add periodic docs consistency report task in project maintenance.

### S157
- [ ] Define divergence documentation template for implementation-vs-statement mismatches.
- [ ] Require explicit divergence notes with scope, reason, and remediation plan.
- [ ] Add review check that divergence notes are linked from relevant feature docs.

### S158
- [ ] Keep status-specific implementation details in feature inventory and architecture pages.
- [ ] Add links from each statement area to its status-tracking doc section.
- [ ] Add docs validation step ensuring status updates are not embedded in canonical statements.

### S159
- [ ] Require new major capability statements to be added before implementation completion claims.
- [ ] Add PR checklist item enforcing statement-first documentation for major features.
- [ ] Add reviewer guideline to block feature closure without statement coverage.

### S160
- [ ] Enforce same-change-set updates for data model changes across source-of-truth + contracts.
- [ ] Add CI check verifying contract/data-model PRs include documentation updates.
- [ ] Add audit procedure for model change traceability.

### S161
- [ ] Enforce scenario validation for service ownership (`service.projectId === project.id`) in builder/contracts.
- [ ] Surface clear validation errors to fixture authors and API callers.
- [ ] Add tests for ownership-valid and ownership-invalid scenarios.

### S162
- [ ] Enforce presence of service configuration for every declared service in scenario models.
- [ ] Add scenario builder helper to auto-detect missing service config entries.
- [ ] Add tests for missing-config detection and error messaging.

### S163
- [ ] Validate provider/runner ownership and service linkage in scenario-level schema refinement.
- [ ] Ensure provider/runner references cannot point to unrelated services.
- [ ] Add tests for valid linkage and mismatched linkage rejection.

### S164
- [ ] Validate dependency endpoints to ensure all referenced services exist in same project scenario.
- [ ] Reject dangling dependency references during scenario build/validation.
- [ ] Add tests for dangling endpoint rejection and corrected dependency acceptance.

### S165
- [ ] Enforce explicit, project-scoped activation flags for `preview` and `development` environments.
- [ ] Ensure service/runtime operations resolve activation from project state, not hardcoded assumptions.
- [ ] Add tests for activation gating across project and service operations.

### S166
- [ ] Model preview dependency-sharing mode explicitly (`shared-instance` vs `isolated-instance`) in project/service preview config.
- [ ] Integrate sharing mode into preview dependency orchestration planner.
- [ ] Add tests for shared vs isolated preview dependency behavior.

### S167
- [ ] Model per-service development execution-location policy (`local` / `cloud` / `dependency-managed`) in contracts.
- [ ] Apply execution-location policy in development session planner/executor.
- [ ] Add tests for mixed-policy development sessions and policy conflict handling.

### S168
- [ ] Enforce scenario validation for service ownership (`service.projectId === project.id`) in builder/contracts.
- [ ] Surface clear validation errors to fixture authors and API callers.
- [ ] Add tests for ownership-valid and ownership-invalid scenarios.

### S169
- [ ] Enforce presence of service configuration for every declared service in scenario models.
- [ ] Add scenario builder helper to auto-detect missing service config entries.
- [ ] Add tests for missing-config detection and error messaging.

### S170
- [ ] Validate provider/runner ownership and service linkage in scenario-level schema refinement.
- [ ] Ensure provider/runner references cannot point to unrelated services.
- [ ] Add tests for valid linkage and mismatched linkage rejection.

### S171
- [ ] Validate dependency endpoints to ensure all referenced services exist in same project scenario.
- [ ] Reject dangling dependency references during scenario build/validation.
- [ ] Add tests for dangling endpoint rejection and corrected dependency acceptance.

### S172
- [ ] Validate dependency `enabledIn` values against project-defined environment names.
- [ ] Reject dependency activation config that references removed or unknown environments.
- [ ] Add tests for environment-set drift and dependency policy reconciliation.

### S173
- [ ] Validate runtime status coverage for every project-defined environment in scenario schemas.
- [ ] Ensure environment additions/removals trigger corresponding runtime status model updates.
- [ ] Add tests for full status coverage and missing-status rejection.

### S174
- [ ] Enforce pinned-environment membership checks against current project environment set.
- [ ] Return typed validation errors when pinned environments fall out of scope.
- [ ] Add tests for valid pinning and stale-pin rejection paths.

### S175
- [ ] Enforce explicit, project-scoped activation flags for `preview` and `development` environments.
- [ ] Ensure service/runtime operations resolve activation from project state, not hardcoded assumptions.
- [ ] Add tests for activation gating across project and service operations.

### S176
- [ ] Model preview dependency-sharing mode explicitly (`shared-instance` vs `isolated-instance`) in project/service preview config.
- [ ] Integrate sharing mode into preview dependency orchestration planner.
- [ ] Add tests for shared vs isolated preview dependency behavior.

### S177
- [ ] Model per-service development execution-location policy (`local` / `cloud` / `dependency-managed`) in contracts.
- [ ] Apply execution-location policy in development session planner/executor.
- [ ] Add tests for mixed-policy development sessions and policy conflict handling.

### S178
- [ ] Define Docker Swarm manager/worker topology as canonical production deployment model in architecture + deployment docs.
- [ ] Ensure runtime orchestration abstractions expose explicit manager/worker-aware semantics.
- [ ] Add validation scenarios for single-node and multi-node Swarm topology behavior.

### S179
- [ ] Implement explicit Swarm join workflow (manager-issued join material, worker enrollment, rotation policy).
- [ ] Persist node enrollment metadata and status transitions for auditability.
- [ ] Add tests for valid join, expired/invalid join material, and rejoin idempotency.

### S180
- [ ] Ensure cluster mutation workflows (deploy/update/scale/remove) are manager-orchestrated operations.
- [ ] Gate manager-only orchestration actions through explicit authorization and state guards.
- [ ] Add tests proving worker-side direct mutation attempts are rejected.

### S181
- [ ] Add replica policy defaults for critical user-facing workloads (minimum replicas = 2 when schedulable nodes >= 2).
- [ ] Enforce spread policy (`max_replicas_per_node=1` equivalent) in scheduling templates where supported.
- [ ] Add tests for replica policy behavior under 1-node and 2+-node cluster capacity.

### S182
- [ ] Keep Traefik + Swarm provider as canonical ingress implementation path in runtime route services.
- [ ] Mark custom redirect/token LB model as optional advanced capability with explicit enablement.
- [ ] Add integration tests for standard Traefik-only routing and optional advanced LB path separation.

### S183
- [ ] Define authenticated mesh ping contract and RTT/jitter measurement strategy.
- [ ] Add mesh peer scoring inputs (latency, jitter, load, capacity) with configurable weights.
- [ ] Add tests validating peer scoring ordering under controlled metric inputs.

### S184
- [ ] Implement adaptive peer-degree calculation (fleet size + capacity + latency budget) with min/max bounds.
- [ ] Expose peer-degree knobs in mesh configuration and environment templates.
- [ ] Add tests for peer-degree behavior across small/medium/large fleets.

### S185
- [ ] Implement periodic mesh re-evaluation with hysteresis and change-triggered rebalance.
- [ ] Add protection against peer flapping (max replacements per cycle, improvement threshold).
- [ ] Add tests for rebalance stability under fluctuating latency/load conditions.
