# Roadmap and differentiating ideas — synthesis (2026-10-26)

Synthesis of five proposal reports: [ideas-mesh](ideas-mesh.md) · [ideas-deploy](ideas-deploy.md) · [ideas-dx-ai](ideas-dx-ai.md) · [ideas-security-resilience](ideas-security-resilience.md) · [journeys](journeys.md). Built on the findings in [README.md](README.md). "No competitor has it" means none in our own benchmark reports (Coolify and Dokploy from source, others from docs); claims tagged `[mem]` in those reports are unverified.

## 1. Key insight: five features, one substrate

Almost every unique idea needs the same four things that are currently missing. Build these once, and ~20 features become cheap:

| Substrate | Today | Unlocks |
|---|---|---|
| **A. Policy-gated procedures** — every ORPC procedure annotated with resource+action+risk, default-deny middleware wired to the (currently unused) permission engine + `role_rules` | `requireAuth()` only | Free RBAC, scoped API tokens, agent/MCP gating, break-glass, approvals, quotas, freeze windows, generated permission matrix + 403 tests |
| **B. Release manifest** — per-deploy sealed record: image digest, resolved config, plan + hash, scan result, policy decision, actor; persisted on the deployment row | Plans in in-memory Maps; no digest column; retry drops env | Deterministic replay/rollback, dry-run diff, gate engine, CVE blast radius, drift reconcile, time machine, deployment passport, explain-failure |
| **C. Event bus with consumers** — the outbox currently only marks rows "sent"; health `changes$` has no subscriber | Nothing notifies | Notifications, alerts, audit log, incident timeline, status page, ChatOps, SLO auto-rollback |
| **D. Signed-roster extensions** — the roster is our only signed, owner-less replicated state; keep bulk data elsewhere, put hashes/signatures/grants in it | Flat authority (any member can revoke anyone — `roster.ts:610,625`), self-asserted timestamps | Tamper-evident audit, node-scoped secrets, k-of-n quorum, relay, mesh DNS, expiring admissions, signed release ledger |

Prerequisites A–C are also P0 items in the audit, so the differentiators are not extra work on top — they are the *right way* to do the P0 work.

## 2. Ideas competitors lack (ranked, ~top 20 of ~90 proposed)

### Tier 1 — build as part of the P0/P1 rework
1. **Risk-annotated contracts → authz, scoped tokens, MCP, CLI from one manifest** (M). Free-tier RBAC is a real differentiator (Dokploy paywalls roles/audit/SSO; Coolify's policies are disabled in places). Agent Auth plugin is already wired (`packages/auth/src/server/plugins/agentAuth.ts`) with per-operation capabilities and passkey-gated writes.
2. **Release manifest + replayable rollback** (M–L). Rollback = replay a sealed manifest, with provenance. Competitors roll back to "previous image".
3. **Deploy dry-run (`plan`) with diff** (M). Same code path with effects off; also backs CLI plan/apply and `deployer.yaml`.
4. **Tamper-evident audit log** (M+M). Per-node hash chain, checkpoints signed by member keys, gossiped via the roster, peer-witnessed. Nobody else has verifiable audit.
5. **Gate engine** (M–L): scan, approval, freeze/window, soak gates; promotion by digest between environments (uses existing scanner + unused `environment_promotions` table).

### Tier 2 — the mesh-native moat (this is what only we can do)
6. **Relay-by-any-member** (L): forward inside existing WG tunnels, end-to-end encrypted, no coordinator. Fixes the stub, makes "works behind CGNAT" true.
7. **Peer-to-peer image distribution** (L): digest-addressed registry per node, pull-through from peers → registry-less multi-node deploys (blocker today: images never leave the build node).
8. **Mesh DNS with split-horizon** (M): resolver in the agent; same name resolves privately inside the mesh, publicly outside.
9. **Node-scoped sealed secrets** (L): data keys wrapped to allowed members' x25519 keys; a secret only decrypts on nodes allowed to run the service; rotates on revoke. First use: stop gossiping the tunnel token in plaintext.
10. **Mesh-gateway edge provider + health-aware leaderless failover** (M–L): a cheap VPS as public door for home-lab nodes.
11. **Operator member + expiring admissions + `deployer proxy`** (M): `deployer mesh connect` from a laptop; temporary access to private services.
12. **Microsegmentation** (L): nftables on the mesh interface from a signed policy (note: WG `AllowedIPs` is routing, not an ACL).

### Tier 3 — trust and resilience
13. **Deployment passport + supply-chain admission** (L): digest, plan hash, scan, cosign result, actor; refuse unsigned/vulnerable images. Implements the existing trust-gate spec (`apps/doc/.../deployment-trust-gate.mdx`, docs only today).
14. **k-of-n quorum + capability-scoped roster authority** (L): prerequisite before stacking more trust on the roster.
15. **Break-glass / JIT exec** with approvals, passkey step-up, session recording (L).
16. **CVE blast radius** (S–M): "which running deployments are exposed to CVE-X → gated rebuild". Quick win once digests are stored.
17. **Mesh-replicated, restore-verified backups** (XL, phased) and **self-upgrade with canary + auto-rollback** (XL), plus a **Game Day** drill button (M) as the test harness for both.

### Tier 4 — DX and intelligence
18. **`deployer.yaml` with plan/apply + drift view** (L): becomes the single reader of service config, ending the "stored but ignored" bug class. Import wizard (compose/Coolify/Dokploy/Heroku) right after.
19. **GitOps without a central controller** (XL): each node reconciles its slice from a signed desired-state head gossiped over the roster.
20. **Explain failed deploy → natural-language ops with plan/approve gate** (M, then L). Safety design: logs are untrusted, no tools for the model, evidence must cite real log lines, secrets redacted, fixes arrive only as a reviewable `deployer.yaml` diff, off by default, bring-your-own/local model. SLO auto-rollback stays deterministic (no LLM).
21. Also strong: graph-deploy saga with whole-graph rollback (wire the 5 dead fleet services), canary/verify-before-flip, drift reconcile + project time machine, ephemeral full-stack previews, correlation id + deploy timeline, auto status page, ChatOps, live topology map.

## 3. Hidden assets (already in the code, unused)

Wire these instead of writing new code: permission engine + `role_rules`; config resolver with rule engine and `dispatchAudit`; `compilePlan` with `planHash` and rollback edges; queue payload already carries `executionPlan`, effective config, `dependencyGraph`; five fleet services (DAG, rollout planner with canary mode, readiness gate, failure containment, fleet rollback) + drift service; preview-topology resolver; correlation-id schema; `environment_promotions` table; log hooks/metrics hook in web; `followStream` per-line callback; Agent Auth plugin; device-code login; quorum-guarded cluster table.

## 4. Phased plan (merged with the audit P0/P1)

| Phase | ~Weeks | Content |
|---|---|---|
| 0 Hygiene | 1 | Remove committed secrets (`200`, `.env.prod`, …), kill backdoors, Playwright harness, the 21 journey quick wins (domain verify user id, strip join tokens, drop `nginx:alpine` fallback, build output → logs, seed default environments, honest rollback, real service logs) |
| 1 Trust floor | 3–4 | Close sign-up/invites, lock `/setup/*`, **substrate A** (authz) in shadow mode → enforce, injection fixes, secrets/codec key fix, migrations fixed |
| 2 Honest pipeline | 4–5 | **Substrate B** (manifest, digest column, persisted plan), durable queue, cancel, real builders, swarm default, registry push, webhooks + system actor, monolith cutover steps (builder registry, triggers, e2e harness), installer/prod images |
| 3 Observability & ops | 3–4 | **Substrate C** (outbox consumers, notifications, audit log, health probes), backups, cron, node lifecycle, domain verification/ACME/wildcard |
| 4 Differentiators | ongoing | Tier 2 mesh moat first (relay, P2P images, mesh DNS, scoped secrets), then dry-run/gates/passport, `deployer.yaml`, CLI+MCP, templates/databases |

Journeys report estimates ~13 weeks to get all six core journeys green; the audit's 14-step monolith cutover fits inside phase 2.

## 5. Risks to keep in front of you

- Roster authority is flat: one stolen node can revoke all members or repoint the edge. Fix (idea 14) before building more trust on it.
- Naively wiring the permission engine locks everyone out (empty rules = deny; loader errors swallowed at `permission.service.ts:34`) → seed rules from current roles and run shadow mode first.
- Swarm raft still needs manager quorum: "partition tolerant" means mesh/ingress/doors keep serving, not that a minority can reschedule.
- Mesh DNS/relay add MTU and resolver edge cases; relay MTU is the main risk.
- `@better-auth/agent-auth` is pinned 0.6.2 and documented unstable.
- Committing a public generated API/CLI/MCP surface means versioning discipline.
- Logical backups give snapshot RPO only, no point-in-time recovery.
- Tension with mesh-first: deployments/queue/audit live in Postgres today. Recommendation: make manifests and audit events content-addressed and signed with the actor's mesh identity from day one so they can be replicated later.

## 6. Decisions needed from the operator

1. Which backend survives (assumed: `api-services` + BFF; `apps/api` deleted).
2. Installer: CLI or `apps/setup`.
3. Organizations: in or out.
4. NAT peers: build relay (recommended) or document the limitation.
5. Single- vs multi-tenant (drives quotas/billing/placement).
6. Where network state, secrets and audit live: mesh roster vs Postgres (conflicts with the Postgres-replica plan in `docs/edge-mesh-architecture.md`).
7. Where `deployer.yaml` lives (repo vs roster) and whether the UI may edit file-managed resources.
8. Which LLM providers are acceptable for AI-assisted ops, if any.
9. Swarm as the only runner?
10. Redis: keep or drop.
