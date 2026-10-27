# Ideas: DX, Automation, Observability, AI-assisted Ops

Date 2026-10-26. Read-only. Paths relative to `v3/`. Competitor claims come from `docs/audit-2026-10-25/bench-*.md`; tags [mem]/[search] there are unverified and I carry them forward as such. Items marked (code) I confirmed by reading source this session.

## 0. Grounding: what we really have (and what is false advertising)

Real and reusable:
- **Typed contracts built by one builder** (`standard.zod(...)` in `packages/transport/orpc/src/operations/zod`, `builder/`). Every route has `openapi` meta, `p\`/${p("id", z.uuid())}\`` path templates, `standardDomainErrorContracts` typed errors. Seven contract packages (`packages/contracts/{bff,fleet,health,identity,project,runtime}`) plus entities. `GET /openapi.json` is generated from the composed contract (`apps/api-services/bff/src/modules/docs/openapi-docs.controller.ts:64`, anonymous: must be gated). About 315 BFF forwarders cover 18 namespaces.
- **Agent Auth is already wired (code)**: `packages/auth/src/server/plugins/agentAuth.ts` derives one capability per `operationId` from the OpenAPI spec; read-only methods by default; writes need a WebAuthn gesture; `onEvent` is meant to be the audit source. Plus `useDeviceAuthorization()` (RFC 8628), `useApiKey()`, passkeys, 2FA in `packages/auth/src/server/auth.ts:175-215`. `apps/web/src/app/.well-known/agent-configuration/route.ts` serves discovery. Known breakage from the audit: API-key header mismatch and BFF not forwarding it; no client uses the device flow; `agent-auth` is pinned at 0.6.2 and unstable.
- **Compiled plan snapshots (code)**: `packages/contracts/entities/src/entities/deployment/plan.schema.ts` has `deploymentCompiledPlanSnapshotSchema` (planHash, compilerVersion, immutable, nodes, edges with kind `dependency|rollback|retry|gate`), with create/list/get/get-by-run contracts (`packages/contracts/runtime/modules/deployment/plan-snapshot.ts`). Also template provenance (`provenance.ts`) and node lifecycle events per run (`lifecycle-events.ts`). The audit says the plan is not persisted on the deploy row or used for rollback; the schema and API exist, the producer does not.
- **Correlation schema exists (code)**: `deploymentObservabilityContextSchema` (`base.schema.ts:25`: correlationId, traceId, spanId, parentSpanId, source) is on the deployment entity. Nothing propagates it BFF -> service -> docker (observability.md section 5; the logger has no trace ids).
- **Streams**: container metrics (`apps/api-services/services/runtime/src/modules/docker/domains/containers/events/docker-container-metrics-stream.service.ts`, 400 ms docker stats), container logs mesh-routed (`.../containers/runtime/docker-container-logs-domain.service.ts`), deployment lifecycle SSE, docker events, swarm events, mesh SSE, health registry `/health/stream` (`apps/api-services/shared/src/server/health/health-registry.service.ts`).
- **Event outbox**: table + claim/retry/dead-letter exist, but `dispatchClaimed` only calls `markSent` (`apps/api-services/shared/src/core/modules/events/outbox/local-event-outbox-dispatcher.service.ts:143-148`). It is a log, not a bus. Health registry `changes$` has no subscriber.
- **Provider/builder schemas**: `packages/utils/provider-schema/src/{catalog,domain}` drive form generation from JSON schema, reusable for a `deployer.yaml` schema and for template validation.
- **Mesh**: signed roster CRDT (`packages/infrastructure/mesh-network/src/roster.ts`), mesh-agent (`apps/mesh-agent/src/agent.ts`, gossip client, control server). Nodes hold their own state; no central store. Operator memory file says: no central control planes, nodes never open inbound ports.
- **Web**: single typed nav model feeding sidebar and Cmd-K (`apps/web/src/components/dashboard/navigation.ts`), 75 `route.info.ts`, `bff.*` screen procedures with no consumers until a1990f59, TanStack Query defaults unset.
- **Fake/dead to fix first**: service Logs tab synthesizes sentences (`apps/web/src/app/dashboard/projects/[projectId]/services/[serviceId]/logs/_utils/service-activity.ts:44-55`); notifications never send; service worker not registered; build output not captured; deploy falls back to `nginx:alpine` "success"; authz is `requireAuth()` only.

Critical constraint for the AI items: **nothing ships until authz exists** (P0 #5) and **write tools are gated by plan/approve**. Logs are attacker-controlled (any container emits them).

## 1. Brainstorm (22 ideas)

Rating key: Effort S (days) / M (1-3 wks) / L (1-2 months) / XL (quarter). Feasibility H/M/L is "can we do this well with what exists".

### A. Contract-derived surfaces

**1. One contract, five surfaces: CLI + TS SDK + MCP + OpenAPI + Terraform provider, all generated**
- Value: an operator or agent never waits for a hand-written wrapper; every new procedure appears in all surfaces in the same commit. Zero drift.
- Competitors: Vercel/Komodo hand-maintain SDKs [doc]; Coolify's openapi is hand-annotated (bench-coolify section 3); Dokploy trpc is internal-first (bench-dokploy 5.7). Terraform providers exist for Coolify/Render/Vercel [mem] but hand-written. No one generates CLI + MCP + Terraform from one typed source.
- Build on: `packages/transport/orpc` builder, `GET /openapi.json` (`openapi-docs.controller.ts:64`), `agentAuth.ts` (already derives capabilities from the spec), `bff/src/modules/delegation/generated/*`.
- Missing: operation metadata (`x-cli-name`, `x-destructive`, `x-requires-approval`, `x-streaming`) in the builder; a CLI runtime (citty/oclif) that reads the spec or the contract object; a stable versioned public spec with a scrubbed surface (no `test.*`, `setup.*`, `meshInternal`); scoped tokens.
- Sketch: add `.meta({cli:{path:["deploy","trigger"]}, risk:"mutating|destructive", approval:"passkey"})` to the builder. A build script emits `deployer` CLI manifest, MCP tool list, Terraform schema (via openapi -> tfplugingen-framework). CLI uses the ORPC client directly (types for free), streams via the same SSE procedures. CI check: surface parity job.
- Effort: M for CLI+MCP, L for Terraform. Risks: breaking-change policy for a public API; streaming procedures need CLI UX; hidden internal procedures leaking. Feasibility: H.

**2. Risk-annotated procedures drive authz, approval and MCP gating from one place**
- Value: the "permissions manifest per procedure" (architecture.md section 7) doubles as the policy for roles, passkey gates, audit verbs and agent grants. One annotation, four enforcement points, plus a generated test matrix that would have caught "Viewer can exec".
- Competitors: Coolify policies are literally disabled (bench-coolify 5); Dokploy/Dockhand paywall RBAC. None derive policy from the contract.
- Build on: `requirePlatformRole`, `agentAuth.ts approvalStrength` (maps HTTP method to proof), contract meta.
- Missing: `meta.access = {platform:["admin"], project:"developer", resource:"service"}`; a generic middleware that reads meta; test generator.
- Effort: M (is the P0 authz layer done right). Risks: over-general DSL. Feasibility: H. This is mostly prerequisite for 1, 3, 7.

**3. Scoped, expiring tokens with an "approval-required" tier (deploy keys, CI tokens, agent tokens)**
- Value: CI gets `deploy:service/x` for 30 days; an agent gets read-only plus "propose".
- Competitors: Vercel tokens, Coolify abilities read/write/deploy/root with IP allowlist and expiry [doc/code]. Not differentiating alone; the differentiator is binding to procedure risk and to passkey approval (idea 2).
- Build on: `useApiKey()`, device flow, agent-auth.
- Missing: fix header mismatch, forward through BFF, scope grammar, UI.
- Effort: S-M. Feasibility: H. Do early, it unlocks the rest.

### B. Declarative and GitOps

**4. `deployer.yaml` with `plan` / `apply` / drift view, schema generated from the same zod used by the UI form**
- Value: the file is the single reader of service config, ending the "stored but ignored" bug class (README cross-cutting #4). Pull-request review of infra. `plan` shows exactly what would change, including destructive guard.
- Competitors: Render Blueprints, Railway IaC with plan/apply [search], Kamal, Fly [doc]. None do it for a mesh with per-node placement or show runtime drift in a live UI.
- Build on: `packages/utils/provider-schema` (config schema -> forms), plan snapshot schema (`plan.schema.ts`, `planHash` gives idempotency and drift detection), project/service/environment contracts.
- Missing: the file schema, a `diff(desired, actual)` over entities, `apply` as an idempotent contract procedure (`config.plan`, `config.apply`) so UI/CLI/MCP share it, secrets as `sync:false` references, `generate` from existing state (Render's rule: removal never deletes).
- Sketch: `config.plan({yaml, scope}) -> {changes:[{op,resource,before,after,destructive}], planHash}`; `config.apply({planHash, confirmDestructive})`. UI diff view = same as CLI output. Drift: re-run plan on a timer, show "3 resources differ" badge.
- Effort: L. Risks: schema becomes a second source of truth vs. UI edits (decide UI writes the file or marks "managed by file"); secrets. Feasibility: M-H.

**5. GitOps with no central controller: each node reconciles the slice it owns from the repo**
- Value: matches mesh-first principle. A node offline for a week catches up alone; no single reconciler to lose. Komodo Resource Sync polls from one core [search]; Portainer GitOps stacks per Portainer server [mem].
- Build on: roster CRDT and gossip (`mesh-network/src/roster.ts`, `apps/mesh-agent/src/gossip-client.ts`) for gossiping a signed desired-state head (commit sha + plan hash) among members; `deployer.yaml` (idea 4).
- Missing: desired-state head object in the replicated state, deterministic ownership ("which node applies service X": placement label), leader-free dedupe, signed commits trust policy, per-node apply loop.
- Sketch: any member that sees a push webhook or poll hit publishes `{repo, sha, planHash, sig}`; owners apply their placement slice; results gossip back as per-node status; the UI aggregates convergence ("5/6 nodes at sha abc123").
- Effort: XL. Risks: conflict semantics when two nodes publish; partial apply; the architecture needs the desired-state model first. Feasibility: M. Genuinely unique, not first-quarter.

**6. Import/migrate wizard from docker-compose, Coolify, Dokploy, Heroku/app.json, render.yaml**
- Value: kills the adoption barrier ("how do I leave Coolify?"). Competitors only import their own formats [mem].
- Build on: `deployer.yaml` schema (4), `SwarmComposeRealizerService`, template contract with validate/resolve/migration (bench-dokploy 1), Coolify `SERVICE_*` magic vars (bench-coolify row 44).
- Missing: parsers, mapping report ("imported 11/13 fields; ignored: X, Y"), dry-run via `config.plan`.
- Effort: M per source, S for compose. Feasibility: H. Risks: licensing of competitor templates (verify), long tail of fields. Great demo.

### C. Correlation, observability

**7. Universal correlation id: deploy -> build -> container -> request -> alert**
- Value: click a failing request and see the deployment, plan node and build log that produced it; click a deploy and see its requests/errors. Nobody ties request traces to deploy provenance in self-host PaaS.
- Competitors: Dokploy has a requests page from Traefik logs [doc]; Coolify has no linkage; Vercel ties deployments to logs [doc] but hosted.
- Build on: `deploymentObservabilityContextSchema` (`base.schema.ts:25`), logger pino context filter (`packages/infrastructure/logger`), BFF AsyncLocalStorage context (`bff/src/clients/service-auth-context.ts`), container labels set at deploy (labels already pass `traefik.*`), Traefik access log.
- Missing: generate/propagate `x-request-id`/`traceparent` BFF -> svc -> docker; stamp containers with `deployer.deployment-id`/`plan-hash` labels; tail Traefik access log (JSON) with deployment label and index it; a place to store (see 8).
- Effort: M. Risks: cardinality/storage; header spoofing from public traffic (generate at the edge, strip inbound). Feasibility: H.

**8. Local-first telemetry store on every node (no central Loki/Prometheus), queryable over the mesh**
- Value: logs, metrics and access logs retained with ring buffers on the node that produced them; the UI/CLI/MCP fan out queries over the mesh. Fits "no source of truth" and avoids shipping data. Metrics history is a P1 gap (observability.md, web.md 6.6).
- Competitors: Coolify Sentinel pushes to central; Dokploy Go collector to central [doc]; Railway hosted. None federate queries across nodes without a collector.
- Build on: metrics stream (400 ms docker stats), logs domain service, mesh query routing (`MeshNodeCaller`, currently a stub returning `[]`, so fix that first), mesh-agent as sentinel.
- Missing: embedded store (SQLite/duckdb ring tables with downsampling), query contract (`telemetry.query`), mesh fan-out, retention policy, export (OTLP/Prometheus) as optional sink.
- Effort: L. Risks: query latency across NAT peers (needs relay), disk. Feasibility: M.

**9. Honest deployment timeline: stages, durations, diff vs previous (config, image digest, env keys, scan result)**
- Value: answers "what changed since last good deploy" in one view; feeds the explain-failure idea (10) and rollback. Web.md section 5 asks for it.
- Competitors: Vercel history [doc]; Coolify stores a config snapshot but does not diff it (bench-coolify 3). Dokploy rollbacks keep full context [doc] without a diff UI.
- Build on: compiled plan snapshots (planHash, nodes, edges), lifecycle events (`lifecycle-events.ts`), provenance, `deploymentExecutionProgressSchema`, image scanner.
- Missing: producer that persists plan per run (audit P0 #7), stage timing events, diff function (structural over plan nodes + env key set + digest), UI component.
- Effort: M. Risks: env secrets in diffs (show keys + hash only). Feasibility: H.

**10. Incident timeline auto-assembled from events**
- Value: when a node drops or a deploy fails, one page shows: deploy X at 14:02 -> health gate failed -> container restarted 3x -> node N lost mesh at 14:04 -> route flipped back. Zero manual stitching; exportable as post-mortem draft.
- Competitors: Dokploy/Coolify none; Vercel none self-hosted. Incident.io style but not in PaaS. Netlify audit log only [search].
- Build on: outbox (once dispatching), deployment lifecycle events, health `changes$`, docker events stream, swarm events SSE, mesh SSE, roster membership changes.
- Missing: unify into an append-only `platform_events` table (the outbox with a real dispatcher), correlation (7), grouping heuristic (time window + shared resource ids).
- Effort: M. Risks: noisy grouping. Feasibility: H. Doubles as the audit log backbone (idea 14).

**11. Built-in SLOs, error budgets, and deterministic auto-rollback on burn**
- Value: per-service SLO (availability from synthetic + Traefik status codes, latency p95). Budget burn after a deploy triggers rollback to the last green plan. Deterministic, not LLM-driven (agrees with bench-market section 7 recommendation).
- Competitors: none in self-host PaaS; Vercel Rolling Releases abort manually [doc]; Kamal-proxy gates on readiness only [doc/search]. Argo Rollouts does this, needs k8s.
- Build on: deploy health gate (`deployment-execution-workflow.service.ts`), Traefik routes (route flip), plan snapshots for "last green", telemetry (8), idea 7 labels.
- Missing: SLI collectors (Traefik access log parser), SLO model in `deployer.yaml`, burn-rate evaluator, rollback executor (rollback itself is partial: audit says the services fork "rolls back" without reverting).
- Effort: L. Risks: flapping rollback loops (cooldown, max 1 auto rollback per deploy), low-traffic noise (min request count). Feasibility: M; gated on honest rollback.

**12. Anomaly detection on metrics and deploy behavior (cheap statistics, not ML cloud)**
- Value: "service X memory grew 4x since deploy abc", "restart loop", "build time doubled". Surfaced as a card on the service page and an alert.
- Competitors: Coolify has restart-limit notification only; Dokploy thresholds only. None baseline per service.
- Build on: telemetry (8), deployment analytics (real DB aggregates), container metrics.
- Missing: EWMA/MAD baselines per service, deploy-relative comparison windows.
- Effort: M. Risks: false positives; keep it opt-in and explainable (show the baseline). Feasibility: M-H.

**13. Live topology map: projects, services, nodes, networks, with traffic and health overlaid**
- Value: one picture answers "where does it run, what talks to what, what is broken". Web already has a topology map for the fleet and a dependency graph panel (`ServiceDependencyGraphPanel.tsx`), but they are separate and not live.
- Competitors: Dockhand has a compose graph only (Cytoscape) [bench-dokploy 2]; Coolify/Dokploy none.
- Build on: mesh SSE, swarm events, docker networks, Traefik routes, health registry, telemetry rates, existing graph components.
- Missing: unified graph model (`topology.get` + stream), edge traffic from access log/conntrack, layout/zoom perf.
- Effort: M. Risks: scale of nodes/services in Cytoscape; honest "unknown" for edges without data. Feasibility: H.

**14. Audit log from one middleware, anchored to the signed roster**
- Value: actor, procedure, resource, diff, from-where (device/agent id). Exportable. Includes agent-auth events and terminal sessions. Both Dokploy and Dockhand paywall it; Coolify has none (bench-dokploy 8).
- Build on: ORPC middleware point, `agentAuth` `onEvent`, roster member ids (tie actors to mesh members), idea 2 annotations (risk level).
- Missing: table, writer, query/export, UI, retention; tamper evidence (hash chain per node, periodically anchored in roster).
- Effort: S-M (hash-chain anchoring +S). Feasibility: H. Do this early; it is cheap and every later feature emits into it.

**15. Auto-generated status page and synthetic checks from the health registry and routes**
- Value: public/private status page per project with zero config: components = services with public routes, uptime from real probes run from several mesh nodes ("multi-vantage"), incidents from idea 10. Cert/domain expiry included.
- Competitors: Coolify and Dokploy none (bench-coolify 5, bench-market 30). Uptime Kuma is a separate product.
- Build on: health monitoring schema (`healthChecks`, `serviceHealthConfigs`, unused tables in `packages/nest/schema`), mesh nodes as probe vantages, edge provider (publish the page through the tunnel without a new port), idea 10.
- Missing: probe scheduler and runner on nodes, result store, public render route (static, cached), incident notes.
- Effort: M-L. Risks: status page must not depend on the platform it reports on (serve from a node-local static snapshot; replicate via gossip). Feasibility: M-H.

### D. Notifications, ChatOps, mobile

**16. ChatOps: deploy, rollback and approve from Slack/Discord/Telegram, with passkey-bound approvals**
- Value: "deploy api prod" in chat produces a plan card; approval needs a one-tap link that opens a passkey prompt (so a chat account compromise cannot deploy). Failure cards show the explain summary (idea 18).
- Competitors: Coolify/Dokploy/Komodo send one-way notifications only (bench). Vercel has Slack app for notifications [mem]. Two-way with plan card and hardware approval: nobody.
- Build on: notification dispatcher (to build, audit P1 #17), `config.plan/apply` (idea 4), agent-auth passkey gate and device flow, token scoping (3).
- Missing: dispatcher, inbound webhook receiver with signature verification (SSRF-safe both ways), chat identity -> platform user linking (via device flow), interactive message builders.
- Effort: L. Risks: chat as injection channel; keep commands a fixed grammar, no free text to the LLM. Feasibility: M.

**17. Mobile PWA for on-call: push with action buttons (approve/rollback/ack), offline-readable incident view**
- Value: one-thumb rollback with passkey (device biometric). Dashboard already has mobile offcanvas; PWA is half-built.
- Competitors: none (Coolify/Dokploy/Dockhand are desktop UIs). Easypanel/Portainer none [mem].
- Build on: `apps/web/src/app/sw.ts` (exists, unregistered), push subscription backend (VAPID per user), passkeys (`usePasskey`), notification dispatcher.
- Missing: serwist integration + registration, push handlers with action buttons, a compact on-call route (`/oncall`: active incidents, last deploys, rollback button), manifest fix.
- Effort: M (after dispatcher). Risks: iOS push constraints; fix per-user VAPID with a real subject first. Feasibility: H.

### E. AI-assisted operations

**18. "Explain this failed deploy" with structured, injection-safe context**
- Value: button on a failed deployment: gets a ranked cause list with pointers to the exact log lines and the plan node, and a suggested fix as a **diff against `deployer.yaml`**, never an action.
- Competitors: Vercel Agent [doc, link title only]; Dokploy AI Assistant (generates compose) [doc nav]. Context assembly with plan + diff vs last green + health result + sanitized logs and typed output: not offered.
- Build on: plan snapshot, lifecycle events, build logs (once captured), idea 9 diff, `deploymentLogs` paged API, image scan results, provenance.
- Missing: build logs, a context packer (budgeted, deduplicated), an LLM provider setting (BYO key or local Ollama, since self-hosted users will refuse a vendor dependency), output schema (zod): `{causes:[{summary,evidence:[logRef],confidence}], suggestedPatch}`.
- Injection safety design: (a) logs wrapped as data blocks with delimiter + per-request nonce, the system prompt says logs are untrusted; (b) model has **no tools** in this mode, only returns schema-validated JSON; (c) evidence must cite log line ids that the server verifies exist, uncited claims are dropped; (d) suggested patch is only rendered, applies through `config.plan` and human approve; (e) redact secrets before sending (env values, tokens, using the logger's redaction paths); (f) strip ANSI/control chars, cap per-line length; (g) output rendered as text, never as HTML/markdown links.
- Effort: M. Risks: model hallucination (mitigated by evidence check), privacy (opt-in, local model option). Feasibility: H once build logs exist.

**19. Natural-language ops with plan/approve gate ("scale api to 3 on node-b, then deploy main")**
- Value: NL -> a typed **plan** (list of contract calls) shown as a diff/checklist; nothing runs until the human approves; approval uses the passkey for mutating steps.
- Competitors: Dokploy AI generates compose from prompts only [doc nav]; Vercel MCP asks for human confirmation [doc]. Plan-compiled NL with structural approval and hash: not present.
- Build on: contract-derived tool list (1), risk annotations (2), `config.plan/apply` and `planHash`, agent-auth grants (`agentAuth.ts`), audit (14).
- Missing: planner endpoint (LLM emits JSON array of `{procedure, input}` validated against zod; server re-validates and authorizes as the user's role, computes dry-run effects), approval token bound to `planHash` so the executed plan cannot differ from what was shown, rate limits.
- Rules: read-only tools callable freely during planning; write steps are *proposed*, never executed by the model. No autonomous remediation.
- Effort: L. Risks: scope creep; keep it a thin layer over 1, 2, 4. Feasibility: M-H.

**20. First-class MCP server with prompt-injection-safe tool design**
- Value: Claude Code/Cursor users manage the platform from their editor. Agent Auth gives grants + passkey approval already.
- Competitors: Vercel, Fly, Netlify, Render (early), Easypanel, Coolify (read-only) have MCP [doc/search]. So MCP alone is table stakes, not a differentiator. Ours differentiates via: passkey-gated writes, per-procedure risk, log content returned as typed data fields with a "untrusted" marker and truncation, plan/approve for mutations, audit events per call.
- Build on: `agentAuth.ts` (derives capabilities from the spec), `/.well-known/agent-configuration`, idea 1 manifest.
- Missing: an MCP transport (streamable HTTP) in front of agent-auth capabilities or direct from the contract manifest; curated high-level tools (`diagnose_deployment`, `plan_change`) beside raw ones; resource templates (`deployer://service/{id}/logs`).
- Effort: S-M. Risks: agent-auth 0.6.2 instability, already wrapped in one file. Feasibility: H. Do this early (cheap, high signal).

**21. Per-service runbooks, attached to alerts and executable as guarded steps**
- Value: markdown runbook stored with the service (`deployer.yaml` `runbook:` or file in repo), shown in the incident card; steps referencing contract calls render as "Run" buttons that go through plan/approve (and into the audit log).
- Competitors: none in PaaS (PagerDuty/Rundeck territory).
- Build on: `deployer.yaml`, alerts, plan/approve, contract manifest for step typing.
- Missing: runbook schema, renderer, alert linkage. Effort: S-M after 4. Feasibility: H. Optional LLM: "draft runbook from last 5 incidents" using idea 18's pipeline.

### F. Onboarding, search, planning

**22. Onboarding: "first deploy in 60 seconds" with detect + generate + preview**
- Value: paste a repo URL or drop a folder -> detect stack, propose `deployer.yaml` (port, healthcheck, env keys from `.env.example`), show plan, deploy, give URL. The command-center already computes a verdict from real state; a checklist can hang off it (web.md 6.16).
- Competitors: Railway auto-detect (Railpack) [doc]; Vercel Drop [doc]; Coolify Boarding covers server+project only. Generate-then-review with typed plan: not found.
- Build on: runner detection already in the service wizard (`StepProvider.tsx:134-208`), builders catalog (`provider-schema`), GitHub App browse, `config.plan`.
- Missing: honest builders and build logs (P1), URL minting (domain step in setup wizard), idea 4.
- Effort: M. Feasibility: H after builders. Great for demos; depends on P0 honesty.

**23. Command palette that acts, plus global search across entities and logs**
- Value: Cmd-K "deploy api", "open logs of web in prod", "roll back last deploy", "connect node". Coolify has Cmd-K search [doc], Dockhand a palette [doc]; none run actions through a contract-derived action list with confirmation.
- Build on: `navigation.ts` (palette subtitle/chords already modeled), contract manifest (1) for actions with risk (confirm if destructive), TanStack hooks.
- Missing: action registry, entity search endpoint (server-side `search.query` across projects/services/domains/nodes), recent items, parameter prompts.
- Effort: S-M. Feasibility: H.

**24. Capacity, cost and energy planner for self-hosters**
- Value: "node-a is at 82% memory; moving `worker` to node-b fits; your 3 nodes use ~140 W idle, est. 12 EUR/month". Placement what-if based on real telemetry and declared capacity (fleet capacity/admissions exist). Competitor: none self-host; cost views exist only in billed platforms (bench-market J3: "offer resource usage per project instead").
- Build on: fleet capacity/allocations (`/dashboard/nodes/capacity`), telemetry (8), placement labels, anomaly baselines.
- Missing: per-service resource history, bin-packing "what-if" with `config.plan`, power/cost inputs (user-entered kWh price, per-node watt profile, optional RAPL/Smart-plug later).
- Effort: M for capacity, +S for cost/energy as estimates. Risks: energy numbers are estimates; say so. Feasibility: M.

**25. Scan-gated deploys with provenance receipts**
- Value: each deployment stores `{plan hash, image digest, scan result, who approved}`; policy "block on new critical CVE vs previous deploy"; rollback replays the receipt. Quick win cited in bench-market section 4 and bench-dokploy 5.4.
- Competitors: Dockhand gates container updates on scan [doc]; none ties it to deploy plan provenance.
- Build on: image scanner (real), `provenance.ts`, plan snapshot. Effort: S-M. Feasibility: H.

**26. Per-node "pull-based" desired state viewer (explain convergence)**
- Merged into 5 (GitOps). Not separate.

## 2. Best 8 and build order

Order respects prerequisites (authz P0, honest deploy, build logs) and cost/value:

1. **Idea 2 + 3: risk-annotated contracts, authz policy, scoped tokens (M)**. Prerequisite of everything and a differentiator on its own (free RBAC). Include fixing the API-key header and BFF forwarding, and gating `/openapi.json`.
2. **Idea 14: audit log (S-M)**. Cheapest lasting asset; every following item emits to it. Include agent-auth `onEvent` and terminal sessions.
3. **Idea 1 (CLI + MCP first, SDK free, Terraform later) + Idea 20 MCP (M)**. `deployer deploy|logs|rollback|exec|mesh connect|plan|apply` from the contract manifest; MCP over agent-auth with plan/approve. This also resolves the `apps/setup` vs CLI decision by delivering the CLI via generation.
4. **Idea 7 + 9: correlation id + honest timeline with diff (M)**. Requires the audit P0 deploy honesty (plan persisted on the row, build logs captured). Output: deploy detail page with stages and "what changed".
5. **Idea 4: `deployer.yaml` plan/apply + drift (L)**. The keystone. Reader of config = fixes inert settings. Enables 6, 8 (below), 18-suggested patches, runbooks.
6. **Idea 10 + outbox dispatcher + notifications (M-L)**. Make the outbox a real bus, emit events, deliver to webhook/Slack/Discord/email/push; incident timeline as the UI. Also fixes the audit's top "misleading" gap.
7. **Idea 18 then 19: explain-failed-deploy (M) then NL plan/approve (L)**. Only after 4-5 so suggestions land as a reviewable diff. Provider is BYO/local, off by default.
8. **Idea 11 + 15: SLOs with deterministic auto-rollback plus auto status page (L)**. Needs telemetry store (8, trimmed to a ring buffer of access-log SLIs first) and a rollback that really reverts. Put the status page in the same release since it shares the probes.

Deferred but strategic: **5 (GitOps without controller)**, **8 (federated telemetry)**, **16 ChatOps** and **17 mobile PWA** (both depend on the notification dispatcher from step 6; 17 is a good small follow-up), **6 import wizard** (do right after `deployer.yaml`, marketing-friendly), **13 topology**, **24 planner**.

Quick wins independent of order (days): scan-gated deploys (25), command palette actions (23), service logs tab on real streams (fix), onboarding checklist on command center, gating anonymous `/openapi.json`.

## 3. Cross-checks: where competitors are weak (so the claims hold)

- No competitor offers: generated Terraform/CLI/MCP from one schema; contract-derived RBAC; passkey-gated agent writes; deploy provenance diffs; decentralised GitOps; SLO auto-rollback; auto status page (bench-coolify 5: "no status page, no synthetic uptime, no audit log"; bench-dokploy: audit and RBAC paywalled; bench-market 30: status page "few self-hosted PaaS").
- MCP exists at Vercel, Fly, Netlify, Render, Coolify (read-only), Easypanel (bench-market section 7). So do not market "we have MCP"; market the *gating model* (risk annotations, passkey, plan hash, untrusted-log handling).
- Render/Railway cover `deployer.yaml` plan/apply [doc/search]. Ours differs by drift view, mesh placement and being the single config reader. Do not claim first.
- Unverified: Vercel Agent and Dokploy AI Assistant capabilities (title/nav only); Coolify Terraform [mem].

## 4. DX/UX enhancements for existing pages (grounded in web.md)

Fixes first (bugs):
1. **Service Logs tab** (`.../services/[sid]/logs`): replace `service-activity.ts` synthesis with real container log stream + `deployment.getLogs`, reusing `/dashboard/docker/logs/*` components; keep the activity list as a secondary "Events" tab. Add search, level filter, time range, follow, permalinks with line anchors (shareable in incident cards).
2. **Env "Config" link bug** (`configuration/environment/page.tsx:165-166`): pass UUID not name. Then: `.env` paste/import/export, secret type (masked, show-once), reveal-all, per-env values with diff and "used by", copy between envs.
3. **Cluster page confirmation**: wire the existing quorum-aware table and `node-change-guard.ts` (`apps/web/src/app/dashboard/cluster/_utils/node-change-guard.ts`), typed confirmation for last-manager demotion; or delete.
4. **Deploy controls on service pages**: Deploy/Redeploy/Restart/Stop/Rollback/Cancel in a service header split-button; env switcher; status, last deploy, public URLs, replica health. Rollback needs the target id in the UI.
5. **Project-role-aware UI**: one `usePermission(procedureMeta)` hook driven by idea 2 annotations; hide or disable destructive actions for Viewer; docker terminal/delete gated. Server remains the barrier.
6. **PWA**: build and register `sw.ts` via serwist, add push + notificationclick handlers (idea 17), fix manifest ("Next.js NestJS Turborepo Template"), robots/sitemap disallow.

Flow enhancements:
7. **Live updates**: use `deployment.streamQuery`, `service.streams.query`, `project.streamQuery` (all defined, none consumed) to invalidate TanStack caches; set `QueryClient` defaults (staleTime ~15 s, retry 1, global 401/offline handler). Replace the global "Live" chip with per-page "updated 12 s ago", SSE reconnect state.
8. **Deployment detail as timeline**: clone/build/push/deploy/health-gate stages with durations from lifecycle events, stage-collapsible logs, diff vs previous (commit, image digest, env keys, plan hash, scan), sticky Rollback/Cancel. Make `deployment.stream` replace 4 s polling.
9. **Unified table primitive** (sorting, column chooser, saved filters, bulk actions: redeploy/delete, server pagination, CSV). Stop `limit:100` client-side joins; use `bff.*` screen procedures that exist (`domains/bff/hooks.ts` has no importers).
10. **Command palette actions** + entity search (idea 23); node and service config sections in the URL (deep links, back button).
11. **Onboarding checklist** on `/dashboard`: connect Git host -> create project -> add domain -> first deploy, using the verdict inputs it already computes (web.md 6.16). Hook for "first deploy in 60 s".
12. **Honesty UI**: show `dataSource` badges on every metric card (pattern from analytics), hide or mark settings that are stored-but-ignored until wired.
13. **Node pages**: add-node wizard (copy join command/QR; `joinAddrs`), drain/cordon, per-node Services/Images/Volumes/Logs/Shell (docker contracts need a node id first), node deregistration.
14. **Team page**: names/emails/avatars, last active, pending invite state with resend; accept-invite page; forgot/reset/verify flows.
15. **Mobile**: card-collapse for wide tables (deployments, containers), touch tuned log viewer; `/oncall` compact route (17).
16. **Accessibility**: `aria-live` on deployment status changes, labelled controls on the old project/service pages, keyboard-operable dialogs.
17. **Reports page**: either wire the 21 analytics endpoints (reports, API usage) or hide them; fix download route first.
18. **Visual consistency**: unify the two card dialects (glass vs flat), remove top KPI strips where `apps/web/AGENTS.md` bans them.

## 5. Risks (cross-cutting)

- **Sequencing risk**: the AI and automation features lean on P0 items (authz, honest deploy, build logs, outbox dispatch, MeshNodeCaller). Building them early on sand multiplies rework. The order above holds the AI work to steps 7+.
- **Public API stability**: generating CLI/SDK/Terraform commits us to a versioned surface; need an explicit stable/internal split via contract meta.
- **Agent Auth maturity**: 0.6.2, "unstable" by its own docs; keep isolated behind the one wrapper and track upstream.
- **Prompt injection**: treat logs, env keys, commit messages, PR titles as hostile. No tool access for explain mode; propose-only for NL ops; approval tokens bound to `planHash`; redaction before any model call; BYO/local model option.
- **Telemetry cost**: node-local ring buffers with hard caps; sampling for access logs.
- **Mesh dependence**: federated queries need relay-over-session (stub today) for NAT-only peers; otherwise degrade honestly ("node-c unreachable, showing cached").
- **Decision pending (operator)**: where `deployer.yaml` lives (repo vs replicated roster), whether UI edits are allowed on file-managed resources, and which LLM providers are acceptable. These change ideas 4, 5, 18, 19.
