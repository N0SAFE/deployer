# Platform Source of Truth (Statement-Based)

> Version: 2026-03-27  
> Scope: Deployer v3 target platform (self-hosted + optional cloud model)  
> Intent: This file is the canonical, statement-driven baseline for product, architecture, and delivery scope.

> **Execution rule (mandatory)**
> - Every statement in this file is directly linked to a dedicated implementation todo list entry in `v3/docs/PLATFORM_SOURCE_OF_TRUTH_TODOS.md`.
> - A statement is considered complete **only when all linked todos are complete**.
> - Any enhancement, correction, decision, or discovery that changes scope or behavior must update **both** this file and `v3/docs/PLATFORM_SOURCE_OF_TRUTH_TODOS.md` in the same change set.

---

## 1) Identity and mission

1. The platform is a self-hosted PaaS for deploying and operating modern applications on user-owned infrastructure.
2. The platform must provide cloud-like DX while preserving user control over servers and data.
3. The platform must avoid vendor lock-in by keeping deploy/runtime artifacts manageable outside the control plane.
4. The platform must support single-node and multi-node operation.
5. The platform must support both OSS self-hosted distribution and optional managed/cloud operation.
6. The platform target category is “Vercel/Render/Heroku experience on your own infra.”

---

## 2) Core domain model invariants

7. An organization contains multiple projects.
8. A project contains multiple services.
9. A project contains multiple environments.
10. A project must have one mandatory base environment named `production`.
11. All other environments are project-defined custom environments.
12. `preview` is a reserved special environment name and must be explicitly enabled per project.
13. `development` is a reserved special environment name and must be explicitly enabled per project.
14. A custom environment must be created from user intent (name, behavior, dependency policy, runtime policy).
15. A custom environment must have independent configuration and lifecycle controls.
16. A service always belongs to exactly one project.
17. A service runtime configuration must inherit environment scope from its project environments.
18. A service cannot reference a pinned environment that does not exist in the parent project.
19. A dependency edge must reference source/target services that both belong to the same project scenario.
20. Dependency environment activation (`enabledIn`) must only reference project-defined environments.
21. Service provider and runner records must match both project and service identity.
22. Project-level environment policy is the parent policy for service runtime behavior.

---

## 3) Tenancy and access model

23. Platform super-admin scope is above organization scope.
24. Organization scope is isolated from other organizations by default.
25. Project scope is isolated from other projects by default.
26. Service-level permissions must be expressible in the authorization model.
27. Role-based access must support Owner/Admin/Developer/Viewer baseline roles.
28. Fine-grained permission grants must be supported for enterprise-grade governance.
29. Access checks must run at API boundaries, not only UI boundaries.

---

## 4) Setup and bootstrap

30. First-run setup must initialize database connectivity.
31. First-run setup must initialize first admin identity.
32. First-run setup must initialize first organization context.
33. Setup flow must be represented as an explicit state machine.
34. Setup state must be queryable through an API endpoint.
35. Setup operations must be resumable after interruptions.
36. Node identity and bootstrap metadata must be persistable.

---

## 5) Project and service lifecycle

37. Projects must support create/read/update/delete operations.
38. Project collaborators must support invite/add/remove/role-change operations.
39. Services must support create/read/update/delete operations.
40. Services must support workload types: web, worker, cron, one-shot task.
41. Service configuration must support provider, build, runner, and health sections.
42. Service runtime must support min/max replicas and autoscaling controls.
43. Service runtime must support per-environment execution overrides.
44. Service runtime status must be tracked per environment.
45. Project-level defaults must be overridable per service.

---

## 6) Environment model and policy

46. Project environment configuration must support strategy per environment.
47. Project environment configuration must support health gate per environment.
48. Project environment configuration must support startup mode per environment.
49. Project environment configuration must support replica bounds per environment.
50. Project environment configuration must support traffic policy per environment.
51. Project environment configuration must support environment variables per environment.
52. Environment variables must also support project-level default variables.
53. The default project bootstrap environment is `production`.
54. `preview` must be explicitly enabled before it can be configured or used.
55. `development` must be explicitly enabled before it can be configured or used.
56. `preview` must support normal environment configuration plus preview-specific orchestration options.
57. `preview` must support granular dependency configuration per project and per service.
58. `preview` must support shared dependency instances when multiple dependents target the same dependency project.
59. Custom environments must support enable/disable state without losing configuration.
60. Environment policy changes must propagate to dependent service runtime interpretation.

---

## 7) Deployment sources and build model

61. Deployment source integrations must include Git-based providers.
62. Deployment source integrations must include artifact/image-based providers.
63. Build mode must support Dockerfile-based builds.
64. Build mode should support auto-detection based builders (Nixpacks-style target).
65. Build mode must support pre-built image deployment.
66. Build configuration must support root path, build context, branch/tag selection, and secret references.
67. Provider integration must support webhook-based auto-sync.

---

## 8) Deployment pipeline

68. Deployment lifecycle must include queued/building/deploying/success/failed/cancelled states.
69. Deployment lifecycle must be persisted and queryable.
70. Deployment execution must emit structured logs with timestamps.
71. Deployment cancellation must be supported with state guardrails.
72. Deployment retry must be supported.
73. Rollback to a previous good deployment must be supported.
74. Health checks must gate rollout progression.
75. Deployment policy must support environment-specific behavior.
76. Deployment policy must support manual approval gates for selected environments.
77. Deployment policy must support canary/rolling/blue-green/manual strategy classes.

---

## 9) Dependency graph and orchestration

78. Service dependencies must be represented as a directed graph.
79. Dependency requirement must support `required`, `optional`, and `disabled` modes.
80. Dependency health gates must support strict/warn/ignore semantics.
81. Dependency startup ordering must support before/parallel/after semantics.
82. Dependency attachment mode must support single-target and filtered multi-target selection.
83. Dependency policy must be editable per environment.
84. Dependency policy must support retries, timeout, and target-selection parameters.
85. Dependency policy must support advanced controls (circuit breaker, failure mode, telemetry).
86. Dependency graph policy must support context menu/preset style operations in UI control plane.

---

## 10) Cloud development mode target

87. Development mode is a dedicated feature to be delivered later in the implementation process.
88. Development mode must support token-based authenticated sessions.
89. Development session tokens must be short-lived and revocable.
90. Development session tokens must be scoped by project/service/identity.
91. Development mode must support local-machine initiated runs using a docker wrapper/utility layer.
92. Development mode must run selected containers on cloud infrastructure while preserving local developer UX.
93. Development mode must resolve service dependencies automatically and start required dependency services.
94. Development mode must expose per-service execution location controls (local vs cloud vs dependency-managed).
95. Development mode must support explicit per-service behavior rules for dependency handling.
96. Development mode must support deterministic cleanup/teardown.
97. Development mode must expose clear lifecycle states and observability.

---

## 11) Networking, domains, and ingress

98. The platform must support Traefik-based ingress/routing model.
99. Services with HTTP workloads must support domain attachment.
100. Services must support multiple custom domains.
101. SSL/TLS automation must be supported for managed domains.
102. Custom certificates must be supportable for advanced use cases.
103. Preview environments must support deterministic subdomain patterns.
104. Project internal communication must support private network boundaries.
105. Cross-node routing and service discovery must be addressable by control plane.

---

## 12) Docker and runtime operations

106. Runtime must support direct container lifecycle operations.
107. Runtime must support logs streaming and point-in-time logs retrieval.
108. Runtime must support container inspect and metrics retrieval.
109. Runtime must support image operations (pull/tag/remove/prune baseline).
110. Runtime must support volume and network management baseline.
111. Runtime should support interactive exec terminal for operators.
112. Runtime should support file copy/upload/download workflows.
113. Runtime operations must be permission-gated.

---

## 13) Docker Compose and stack operations

114. The platform must support compose stack deployments.
115. Compose stack lifecycle must support deploy/start/stop/restart/update/remove.
116. Compose stack model must support Git-sourced and file-sourced definitions.
117. Compose stack operations must provide logs and status timeline.
118. Compose stack operations must support environment variable and secret wiring.
119. Compose stack operations must support rollback patterns where applicable.

---

## 14) Databases and managed resources

120. The platform must support managed databases as first-class resources.
121. Managed databases should include PostgreSQL, MySQL/MariaDB, MongoDB, Redis baseline.
122. Database lifecycle must support create/start/stop/restart/delete.
123. Database backups must support scheduling and external destination.
124. Restore workflows must be supportable.
125. Backup/restore actions must be auditable.

---

## 15) Observability and operations

126. The platform must expose deployment logs.
127. The platform must expose runtime logs.
128. The platform must expose resource usage metrics (CPU/memory/storage/network baseline).
129. The platform must expose incidents/alerts timeline.
130. The platform must support notifications for deployment and incident outcomes.
131. Notification channels should include Slack/Discord/Telegram/Email style integrations.
132. The platform must provide high-signal operational dashboards.

---

## 16) Security and compliance baseline

133. Secrets must never be logged in plaintext.
134. Sensitive tokens must be redacted in logs and UI.
135. API mutation boundaries must enforce authN + authZ checks.
136. Session model must support revocation.
137. Intra-platform trust boundaries must be explicit and audited.
138. Cluster/node actions must be RBAC-guarded.
139. Security-sensitive operations must be traceable via audit logs.

---

## 17) Multi-node and fleet operations

140. The platform must support remote server onboarding.
141. The platform must support multi-node resource placement.
142. The platform must support node health state and node inventory views.
143. The platform should support swarm/cluster-level orchestration patterns.
     > **Implementation STATUS (§23/SW): DONE** — Swarm baseline implemented behind the dockerode SDK: `entities/swarm/*` schemas, `DockerService` swarm SDK group, `SwarmRuntimeRunnerService` + Compose→swarm realizer, mesh master election (weighted score + quorum + CAS), `NodeInventoryService`, `clusterContract` API. See `docs/swarm-orchestration/`.
144. The platform should support project/resource placement constraints.
     > **Implementation STATUS (SW-032): DONE** — `node-placement.service.ts` (`dedicated` / `exclude-ingress` / `prefer-region` / default-shared-nodes) wired into the swarm runner via the `deployer.placement` executor label.
145. Multi-server operations must preserve tenant and project isolation boundaries.

---

## 18) Integrations and ecosystem

146. SCM integrations should include GitHub/GitLab/Bitbucket/Gitea classes.
147. Registry integrations should include internal and external registries.
148. API and CLI surfaces must both exist for automation.
149. Webhooks must be usable for event-driven delivery workflows.
150. Template-based deployment should support one-click app bootstrap patterns.

---

## 19) Product parity target (Coolify / Dokploy alignment)

151. The platform target includes broad app deployment coverage across major runtimes.
152. The platform target includes managed database operations.
153. The platform target includes compose-first complex app support.
154. The platform target includes multi-server operations.
155. The platform target includes notifications and operational telemetry.
156. The platform target includes backup automation capabilities.
157. The platform target includes routing and ingress automation via Traefik-class model.
158. The platform target includes API-level automation parity for core operations.
159. The platform target includes preview deployment workflows.
160. The platform target includes cluster/fleet observability and controls.

---

## 20) Documentation governance statements

161. This document is the canonical statement baseline for platform scope.
162. Feature documents must not contradict this document.
163. If implementation diverges, docs must record divergence explicitly.
164. Status-specific implementation details should live in feature inventory and architecture pages.
165. New major capability areas must add new statements here before implementation is considered complete.
166. Data model changes must update this document and related contracts in the same change set.

---

## 21) Canonical references used to derive this document

- Deployer v3 docs: architecture and feature inventory pages under `apps/doc/content/docs/architecture/`.
- Deployer v3 internal product specification: `platform-product-spec.mdx`.
- Deployer v3 complete feature inventory: `complete-feature-inventory.mdx`.
- External target references reviewed in this workspace:
  - `coolify/README.md`
  - `coolify/TECH_STACK.md`
  - `coolify/openapi.json` (tag/path capability review)
  - `dokploy/README.md`
  - `dokploy/GUIDES.md`
  - `dokploy/openapi.json` (tag/path capability review)

---

## 22) Immediate model compliance checklist (contracts + mocks)

167. Base project environment must include mandatory `production`.
168. Project scenario schema must validate service ownership (`service.projectId == project.id`).
169. Project scenario schema must validate service config presence per service.
170. Project scenario schema must validate provider/runner ownership and service linkage.
171. Project scenario schema must validate dependency endpoints reference in-project services.
172. Project scenario schema must validate dependency enabled environments exist in project environment set.
173. Project scenario schema must validate service runtime environment status coverage for project environments.
174. Project scenario schema must validate pinned environment membership in project environments.
175. `preview` and `development` environment activation must be explicit and project-scoped.
176. Preview dependency sharing rules (shared instance vs isolated instance) must be modelled explicitly.
177. Development per-service execution-location policy (local/cloud/dependency-managed) must be modelled explicitly.

This checklist is mandatory for keeping fixtures truthful and migration-safe.

---

## 23) Swarm manager + ingress baseline

178. Multi-node production orchestration baseline must use Docker Swarm manager/worker topology.
     > **Implementation STATUS: DONE** — SDK-first Swarm baseline: `swarm init/join` via the API (`SwarmClusterService`), idempotent single-node mode, platform stack + `docker-stack.deploy.yml` reference spec, master election + takeover. See `docs/swarm-orchestration/`.
179. Node onboarding must support explicit Swarm join flow (manager authority with worker enrollment and rotating join material).
     > **Implementation STATUS: DONE (core)** — `SwarmClusterService.joinCluster(token, addrs)` + join tokens persisted locally (`cluster_node`), never `.env`. Mesh-authenticated onboarding + token rotation to peers remain (P7).
180. Cluster operations must be initiated through manager-side orchestration APIs/workflows.
     > **Implementation STATUS: DONE (core)** — `clusterContract` API (`/cluster` snapshot/nodes/master/updateNode) + `SwarmRuntimeRunnerService` lifecycle ops; all manager-routed when a master is elected.
181. Critical user-facing workloads must support a minimum of two replicas when at least two schedulable nodes are available.
182. Traefik with Swarm service discovery is the canonical ingress/load-balancing model; custom redirect/token load balancer behavior is optional advanced scope.
     > **Implementation STATUS (181/182): DONE in specs + runner** — replica policy encoded in `docker-stack.deploy.yml` / compose realizer (`deploy.replicas`); Traefik swarm provider (`swarmMode=true`) + verify-only route probe (`swarm-route-verifier.ts`). Live multi-node verification remains on live-infra CI.

---

## 24) Mesh peer selection and adaptive topology

183. Mesh nodes must perform authenticated latency sampling across available peers and prefer low-latency, low-load peers for connections.
184. Mesh peer degree must adapt to fleet size, node capacity, and latency budgets while respecting configurable min/max bounds.
185. Mesh topology must periodically re-evaluate and rebalance peers using hysteresis to avoid flapping and to respond to latency/load changes.

---

## 25) Docker standalone-first delivery boundary

186. Docker operator capabilities must be deliverable as a standalone domain before deployment/project/service linkage is required.
187. Phase-1 Docker APIs and UI flows must rely on runtime/mesh truth and must not depend on deployment/project/service joins for core operations.
188. Deployment/project/service-linked Docker projections must remain explicit optional enrichments behind dedicated linked endpoints/adapters.
189. Phase-2 linkage additions must be additive and resilient: linkage degradation must not break core Docker operator workflows.
190. External platform capability reviews may inform parity targets, but v3 implementation must remain contract-first and boundary-safe.
191. Docker realtime surfaces must provide production-grade SSE behavior (ordered delivery, cursor-based resume, heartbeat keepalive, reconnect resilience, and observable lag/drop diagnostics).
