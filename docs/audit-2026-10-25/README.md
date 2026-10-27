# Production-readiness audit — 2026-10-25

Eleven parallel audits, each reading the source directly (no scripts, docs treated as claims, code as truth). Per-area detail with `path:line` evidence is in the sibling files:

| Area | Report |
|---|---|
| Setup / first-run | [setup.md](setup.md) |
| Auth / permissions | [auth.md](auth.md) |
| Projects & services | [projects-services.md](projects-services.md) |
| Deployment pipeline | [deployments.md](deployments.md) |
| Docker / Swarm / cluster / fleet | [docker-cluster.md](docker-cluster.md) |
| Networking (mesh, edge, domains) | [networking.md](networking.md) |
| Observability & notifications | [observability.md](observability.md) |
| API-services cutover / architecture | [architecture.md](architecture.md) |
| Web dashboard | [web.md](web.md) |
| Ops / security / tests | [ops.md](ops.md) |
| v1→v3 parity & doc reconciliation | [parity.md](parity.md) |

**Wave 2 (added 2026-10-26):** [monolith-cutover.md](monolith-cutover.md) · [bench-coolify.md](bench-coolify.md) · [bench-dokploy-dockhand.md](bench-dokploy-dockhand.md) · [bench-market.md](bench-market.md). Key points: `apps/api` cannot compile (4 bad `@repo/nest-*` imports in `app.module.ts`) yet tests, CI, Dockerfiles, compose and `apps/setup` still depend on it; cutover is ~14 steps / 2–3 weeks, long poles are the trigger registry + system actor and the e2e/spec port; features only the monolith has (builder registry, trigger registry, analytics download, `backfill-env-secrets`, drizzle/auth generation, 16 e2e specs) would be lost on deletion. Competitor benchmarks converge on the same top gaps: notification delivery, honest pipeline + webhooks, templates/databases, S3 backups, cron, CLI/API tokens, audit log, `deployer.yaml` IaC. Market report claims tagged `[mem]`/`[search]` are unverified.

**Wave 3 (added 2026-10-26):** start with [ROADMAP-AND-IDEAS.md](ROADMAP-AND-IDEAS.md) (synthesis + phased plan + decisions), backed by [ideas-mesh.md](ideas-mesh.md), [ideas-deploy.md](ideas-deploy.md), [ideas-dx-ai.md](ideas-dx-ai.md), [ideas-security-resilience.md](ideas-security-resilience.md) and [journeys.md](journeys.md) (six core user journeys walked step by step, with quick wins and e2e outlines).

**Wave 4 (added 2026-10-26) — Effect-TS migration:** [effect-architecture.md](effect-architecture.md) (sample + bridge package audit, conventions, per-service migration cost) · [effect-health-identity.md](effect-health-identity.md) (health rewrite parity; identity rewrite in flux) · [effect-ecosystem-research.md](effect-ecosystem-research.md) (adopt/adapt/avoid, version matrix; registry claims need re-checking) · checklist [roadmap/effect-migration.md](roadmap/effect-migration.md). Headlines: design fits but is a PoC not a template; `svc-health` rewrite covers only the two oRPC procedures and still has the uptime ÷1000 and `supervisors: []` bugs; identity converted for `user` only (new P0: admin can act on superAdmin); no per-request actor/correlation context in the bridge; version mismatches (`@effect/vitest` vs Vitest 5, oRPC beta pin, Nest 11 vs 12, TS 7 vs 5.9).

**Wave 5 (2026-10-26) — full-Effect decision + authZ/authN design:** [effect-target-architecture.md](effect-target-architecture.md) · [effect-layers-catalog.md](effect-layers-catalog.md) · [authz-authn-design.md](authz-authn-design.md). Operator decisions recorded in `docs/qa/effect/architecture.md`. Every Effect or oRPC-beta code sketch in these docs is unchecked against `effect@4.0.6`; confirm in the Template v1 spikes.

Caveat: almost nothing was run. Findings marked "not confirmed at runtime" in the area reports should be reproduced before being acted on. The working tree is a huge uncommitted restructure (2861 changed paths), so this audits what is on disk, not HEAD.

---

## 1. Verdict

**Not production-ready.** The *foundations* are strong and in places better than Coolify/Dokploy (WireGuard mesh with signed roster CRDT, pluggable edge providers, setup handover, Better Auth with passkeys/device flow, a real Docker-engine UI with exec/logs/files, 7 runners). But:

1. **Authorization is largely absent** — most mutations only check "logged in".
2. **Several flagship features look done but are inert** (GitHub webhooks, PR previews, notifications, cascade deploy, backups, templates, env-var encryption, project settings).
3. **The default deploy path is silently wrong** (no builder → `nginx:alpine` reported as `success`).
4. **The codebase exists twice** (monolith `apps/api` and `apps/api-services/*`), diverged, and the monolith does not even compile its imports.
5. **No install, backup, upgrade, or CI-gate story.**

Rough size of the remaining work: P0 (security + correctness blockers) is a focused 3–5 week effort; P1 (make every advertised feature true) another 2–3 months for one team; P2 (competitive parity) is open-ended.

---

## 2. Feature scorecard

Legend: ✅ real & wired · 🟡 partial / happy-path only · 🔴 stub or broken · ⬜ missing

### Platform bring-up
| Feature | State | Notes |
|---|---|---|
| Setup wizard + progress stream + reconnect replay | ✅ | Gate/phases, ordered handover, Continue gated on server+browser verification |
| Swarm found/join, mesh agent start, overlay attach | ✅ | Join UI unreachable from wizard (no `joinAddrs`) |
| Re-run after restart (already set up) | ✅ | |
| Setup security | 🔴 | `/setup/*` anonymous after setup; SSRF probes; no claim token; default-admin backdoor |
| Domain/HTTPS step in wizard | ⬜ | Hardcoded `http://*.deployer.localhost` |
| Production installer | 🔴 | `deploy.sh` is for another project (nginx/certbot "Gossip Club") |
| CLI (`deployer start/status/mesh connect`) | ⬜ | Planned, `apps/setup` scheduled for deletion in its favour — neither exists as a finished path |
| Retry after cluster failure | 🔴 | `failed` is sticky; retry skips swarm bootstrap |

### Identity & access
| Feature | State | Notes |
|---|---|---|
| Email/password, multi-session, sessions list/revoke | ✅ | |
| Admin ban/role/remove | ✅ | but admin→superAdmin self-promotion possible |
| Passkeys | 🟡 | `rpID` defaults to `api.` host, browser is on `web.` |
| Device-code flow | 🟡 | Approval page works; no client uses it |
| Invites | 🔴 | **Any user can mint a superAdmin invite**; no UI; broken pending filter |
| 2FA | 🔴 | Enrolment can't complete; no sign-in challenge |
| API keys | 🔴 | Header mismatch (`x-api-key` vs `Authorization`); not forwarded by BFF |
| Password reset / email verify / change | ⬜ | No mail transport |
| Organizations (Owner/Admin/Dev/Viewer) | ⬜ | Only platform roles + project roles exist |
| Audit log | ⬜ | |
| Sign-up gating | 🔴 | Open at API; role field client-settable (likely — verify) |

### Projects & services
| Feature | State | Notes |
|---|---|---|
| Project/service/environment CRUD, collaborators, sub-services, dependencies (API) | ✅ | Delete leaves containers/DNS/routes behind |
| Env-var merge (project→service→user) | ✅ | Stored **plaintext**; encrypted table has no consumer |
| Service config (builder, port, health, volumes, start cmd, secrets) | 🔴 | Stored, **ignored at deploy** |
| Project settings (quotas, retention, notifications, basic auth, IP allowlist…) | 🔴 | Nearly all inert |
| Dependency graph / cascade deploy | 🔴 | Copied into job payload, never read; no UI to edit |
| Preview environments | 🔴 | Creates DNS+route to *existing* container; webhook resolves service wrongly |
| Templates / one-click apps | ⬜ | Contract mounted (16 procs), no implementation |
| Managed databases, cron jobs, backups, static sites | ⬜ | |
| Private repo access | ⬜ | Clone has no credentials |

### Deployment pipeline
| Feature | State | Notes |
|---|---|---|
| Trigger → queue → build → run → health gate → route flip | 🟡 | Only: explicit `dockerfile` builder, public GitHub / upload / prebuilt image |
| Default builder | 🔴 | Missing builder ⇒ `nginx:alpine` marked **success** |
| GitHub webhooks | 🔴 | Secret never written ⇒ always 401; signature over re-serialised JSON; push ignored |
| GitLab | 🔴 | Checkout stub; no webhooks |
| Nixpacks/buildpack/railpack | 🔴 | Run generic image with custom commands |
| Compose | 🔴 | Builds then deploys `nginx:alpine` |
| Swarm runner | 🟡 | Well built but not selectable (excluded from enum) |
| Rollback | 🟡 | Works in monolith; UI button omits target id; services fork "rolls back" without reverting |
| Cancel | 🔴 | DB flip only; overwritten by running job |
| Queue durability | 🔴 | In-memory; reaped jobs stranded; only `building` reconciled on boot |
| Build logs | 🔴 | Build output never captured; streams silent |
| Image registry push | ⬜ | Multi-node swarm cannot pull |
| Cleanup of old containers/images/workspaces | ⬜ | |
| Archive upload | 🔴 | **Command injection** via `uploadPath` → `execSync unzip`; tar traversal |

### Cluster / Docker
| Feature | State | Notes |
|---|---|---|
| Container/image/network/volume listing, logs, inspect, exec, files (cross-node reads) | ✅ | Remote start/stop/kill not routed |
| Image vuln scanning | ✅ | Docker socket mounted into scanner |
| Opt-in swarm runner, platform supervisors | ✅ | |
| Authorization | 🔴 | Viewer can exec, kill, read env, change roles; **join tokens (incl. manager) returned to every user** |
| Master election | 🔴 | Per-node SQLite CAS; facade |
| Node health | 🔴 | Crashed nodes stay "active"; metrics table has no unique key |
| Node drain/promote/demote/remove, scale, remove service | ⬜ | |
| Image prune, registries (credentials), swarm secrets/configs mounting | ⬜/🔴 | |
| Fleet controllers (rollout planner, drift reconcile…) | 🔴 | 7 services provided, injected nowhere |
| Create-container / Pull UI | 🔴 | Toasts "created", calls nothing |

### Networking
| Feature | State | Notes |
|---|---|---|
| WireGuard mesh, roster CRDT, admission, revocation, founder-loss e2e | ✅ | Best part of the repo |
| Traefik-in-swarm, lanes, doors, rescue lane | ✅ | |
| Pluggable edge (direct, cloudflare-tunnel) + Network UI | ✅ | Tunnel unverified against real Cloudflare |
| Relay-over-session, operator CLI | 🔴 | Confirmed stubs; NAT-only peers never converge |
| Domain verification | 🔴 | Passes `"verify"` as user id; challenge strings mismatched; **never enforced** at routing; project owner can claim platform hosts |
| Per-mapping SSL / cert upload / wildcard DNS-01 | ⬜/🔴 | `provisionTlsCertificate` inserts a DB row only; default ACME email `admin@example.com` |
| Legacy domain routing | 🔴 | Writes routes for entrypoints that don't exist |
| DNS providers | 🟡 | Cloudflare only; Route53/Google are UI stubs; **no role check on DNS/tunnel/tunnel-token** |
| Mesh DNS (`deployer.internal`) | ⬜ | No resolver |
| Revoke cleanup (swarm, DNS, tunnel token rotation) | ⬜ | Token plaintext in roster |

### Observability
| Feature | State |
|---|---|
| Health probes (live/ready/stream), deploy health gate | ✅ |
| Deployment analytics, node/container metrics streams, container logs | ✅ (identity host metrics misleading) |
| Web push subscribe | 🔴 — service worker never built/registered; no push handler |
| Push/email/Slack/webhook **delivery** | ⬜ — nothing ever sends; "test notification" returns fake report |
| Per-service health monitoring & alerts | ⬜ — tables unused |
| Reports | 🔴 — download route missing, CSV/PDF are JSON, schedules never run |
| Audit/activity log, status page, metrics history | ⬜ |
| Service logs tab | 🔴 — synthesizes sentences from statuses |

### Web dashboard
Mostly real: nearly every page calls a typed procedure with loading/error/empty states. Broken: service logs tab (fake), environment "Config" link (name vs UUID), cluster edits with no confirmation, PWA/offline, no project-role-aware UI (viewers see destructive buttons), no live updates outside the Docker pages, 100-item caps with client-side joins, Docker pages see only the API node, no forgot-password/verify/invite-accept, no node add/remove. Missing pages: audit log, secrets, webhooks/CI-CD, templates, alerts, notification inbox, backups, cron, certificates, billing/quotas.

### Ops
Real: health/readiness, graceful shutdown, CORS policy, mesh-agent hygiene, ACME + redirect, non-root Dockerfiles with BuildKit secrets, ~4,000 unit tests (cached green), 27 API e2e specs. Missing: backups/restore, reproducible prod build, security headers, rate limiting, browser e2e, CI gate before deploy, real README.

---

## 3. Cross-cutting findings (these recur across areas)

1. **Authorization gap (critical, systemic).** `requireAuth()` is the only check on DNS, Cloudflare tunnels, docker exec/kill/env, cluster/fleet mutation, join tokens, swarm labels, project/service reads (incl. env vars), deployments/logs, analytics, managed web console. `requirePlatformRole` appears on ~13 handlers. Project-scoped reads have no membership check. Fix once with a policy layer (platform role × project role × resource ownership) applied by default, opt-out explicit.
2. **Secret handling.** `AUTH_SECRET` used as a hex key yields a 0-byte AES key with the shipped example values; one secret serves sessions + column encryption + ingress token; env vars/basic-auth/webhook secrets plaintext; join tokens plaintext in SQLite; tunnel token plaintext in the replicated roster; VAPID private keys plaintext; defaults `fallback-auth-secret`, `dev-fallback-key`, `admin@admin.com/adminadmin`, DB password `deployer`, no Redis password; a tracked cookie jar (`200`) holds a live superAdmin session token (expires 2026-10-29) and `.env.prod` is tracked.
3. **Two backends, one truth.** `apps/api` (monolith, imports nonexistent `@repo/*` packages, per architecture audit) and `apps/api-services/*` are ~20k lines of diverged copies; the services fork is *older* in places (runtime lacks builder/trigger registries, fakes rollback). Ingress/setup shape A still target the monolith. Every fix lands twice or regresses.
4. **"Stored but ignored" settings.** UI persists values nothing reads (service build/health/port, project quotas/notifications/retention, retry policies, environment rules, `isActive`).
5. **Silent success.** Missing builder → success; swallowed `.catch`es; migration failure "non-fatal" yet ready; cancelled rows overwritten; fake toasts.
6. **Docs drift.** Gap catalogue, feature-status, enhancement-overview-*, implementation-plan-200, swarm README, cutover doc, root AGENTS.md, README all contradict code (details in parity.md §2). Don't use them as a roadmap until refreshed.
7. **Quality gate is not green.** Cached logs show ~345 type errors across backend and lint failing everywhere; `bun lint` autofixes and mutates sources (an audit agent had to revert 6 files); web `ignoreBuildErrors` defaults true.

---

## 4. Path to production — ordered

### P0 — security and correctness blockers (do first, in this order)
1. **Rotate/remove committed secrets**: delete `200`, `.env.prod`, `PG`, `api.log`, `tmp/*` from tracking; revoke that session token; generate real secrets.
2. **Kill the backdoors**: default admin (`ADMIN_BOOTSTRAP` default `never`, no `adminadmin`), master-token/`loginAs` off outside dev (and fix `z.coerce.boolean("false")`), constant-time compare, required `AUTH_SECRET` with no default and ≥32 random bytes (fix hex/base64 mismatch; add key id + rotation).
3. **Close sign-up and invites**: `disableSignUp` at API, strip client `role`, fix `canCreateInvite`, role hierarchy for admin actions, define or remove the `user` role.
4. **Lock `/setup/*`** after completion; add one-time operator claim token; SSRF allow-lists on probes; resolve the `/setup/state` route collision.
5. **Central authorization layer** (see §3.1). Immediately: role gates on docker/cluster/fleet/DNS/Cloudflare/managed-web/console; remove join tokens from read responses; project membership on every project/service/deployment/log read; stop trusting client `projectId`.
6. **Fix injection**: replace `execSync("unzip …")`, containment check for tar, derive upload paths from upload ids, validate branch names, allow-list executor labels (`traefik.*` injection).
7. **Make deploys honest**: remove the `nginx:alpine` fallback, resolve source/builder/runtime from the saved service server-side, persist the plan on the row, never overwrite terminal states, make cancel abort, persist the queue, re-emit reaped jobs, reconcile `queued`/`deploying` at boot.
8. **Pick one topology**: delete or repair `apps/api`; delete the stray `deployer-bff` provisioning; one ingress switch; port monolith-only fixes into services; fix image healthchecks (port 3001 hardcoded).
9. **Migrations**: journal or delete `0040`, make boot failures fatal, add a lock, move drizzle-kit output to the canonical schema package, ship `backfill-env-secrets` in the BFF CLI.
10. **Backups**: scheduled `pg_dump`/WAL + restore drill; Postgres placement constraint/volume strategy; state (mesh roster, secrets) backup.
11. **A reproducible prod install**: build and publish all images (api/BFF/5 services/web/doc/setup/mesh-agent/door), replace `deploy.sh`, or ship the CLI; prod compose with Docker secrets, Redis auth (or drop Redis), no default DB password; stop mounting the Docker socket RW into public-facing services (socket proxy).
12. **Green gate**: zero type errors, lint non-mutating in CI, remove `ignoreBuildErrors`, gate `deploy.yml` on CI, fix Vitest coverage config.

### P1 — make advertised features true
13. **Webhooks & previews**: write/select secret, verify raw body, durable dedupe, system actor, deploy on push; real PR builds with per-PR deployment and teardown; GitLab (webhooks, MR previews, checkout); private clones via GitHub App installation tokens.
14. **Real builders**: Nixpacks/Buildpack/Railpack actually invoked; compose realizer; logs captured from build output and streamed (paged in UI).
15. **Swarm as default runner** with stable service names, rolling update, registry push + digest pull, old image/container/workspace cleanup; selectable in contract.
16. **Env/secrets**: single encrypted store, masked on read, per-environment variables, swarm secrets mounted; enforce environment rules/links; seed default environments.
17. **Notification system** on the event bus: working service worker (+push/click handlers), SMTP, Slack/Discord/webhook (SSRF-safe), alert rules wired to deploy/health/node events.
18. **Health monitoring**: active per-service probes + scheduler; node status from real heartbeats; fix `svc-health` uptime (÷1000 bug) and supervisors.
19. **Domains**: one source for verification instructions/verifier; enforce verified-only routing; reserve platform hosts; ACME email + DNS-01 wildcard; custom domains on tunnel edge; delete legacy routing; fix previews.
20. **Cluster ops**: drain/promote/demote/remove node, scale, remove service, prune, registries with credentials, route container actions over the mesh; fix or remove master election; fix fake UI (create container, approve allocation, role labels).
21. **Mesh gaps**: pass `declaredAddresses` to agent, relay-over-session (or documented NAT limitation + warning), `left` re-admission, address-collision retry, secret rotation on revoke, revoke cleanup.
22. **Auth completeness**: finish 2FA with challenge, passkey `rpID`/origin, API-key header + BFF forwarding, mail transport + reset/verify/change-password, invite UI + accept page, session revoke on ban/role change.
23. **Inter-service auth**: signed actor claim or service tokens (replace raw cookie forwarding), BFF client timeouts/retries/circuit breaker, give mesh controller one home and route `meshInternal`.
24. **Frontend fixes**: service logs → real stdout; env "Config" link; confirmation + quorum guard on cluster edits; project-role-aware UI; live updates via existing streams; pagination; forgot-password/invite pages; manifest/robots/sitemap.
25. **Cleanup/retention** enforcement; teardown on service/project delete.

### P2 — competitive parity and polish
Templates + managed databases, cron jobs, backups UI, static sites, registry manager, audit log, status page, notification inbox, secrets manager, CLI, cascade deploy with dependency UI, canary/blue-green, remote builders, Prometheus/OTel export, certificate management UI, organizations/teams model (decide whether to adopt at all — the docs promise it, the code has none), billing/quotas (only if multi-tenant), i18n, browser e2e (Playwright) over setup→login→deploy→rollback.

---

## 5. Enhancement and new-feature highlights

**Enhance what exists:** a policy-driven authz layer (single biggest leverage); deployment execution plan stored and replayable; real node stats from the mesh agent with a time series; terminal audit trail; scan-gated deploys; mesh DNS in the agent; provider-agnostic cert UI; a platform health page; typed settings with unique constraints; binary-safe file transfer in the container file browser.

**New features worth building** (ordered by value to a self-hoster): one-click templates (DBs first) · backups + scheduler · notifications/alert rules · audit log · deploy hooks / generic webhooks · CLI (`deployer start`, `mesh connect`, `deploy`) · status page + synthetic uptime/cert checks · node add/drain wizard · image GC policies · multi-region/tenant placement using existing labels · more edge providers (the plugin model is ready) · team/org model if multi-user SaaS is intended.

---

## 6. Decisions only the operator can make (they change the plan)

1. **Which backend wins?** Everything in this report assumes `apps/api-services` + BFF is the future and `apps/api` is deleted. If not, the P0 de-duplication changes.
2. **`apps/setup` or CLI?** Docs say delete setup for a CLI; neither is finished. Pick one before investing in either.
3. **Organizations in or out?** Docs/AGENTS.md promise Owner/Admin/Developer/Viewer orgs; code has platform + project roles only.
4. **Relay vs documented limitation** for NAT-only peers (consistent with the mesh-first principle, relay is the real answer).
5. **Single-tenant or multi-tenant?** Determines whether quotas/billing/tenant placement matter.
6. **Redis:** keep (what for?) or drop.
