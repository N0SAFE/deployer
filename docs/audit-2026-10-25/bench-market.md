# Market benchmark: deployment-platform feature taxonomy vs. deployer v3

Date: 2026-10-25. Branch rewrite-v3. Read-only research.

Evidence tiers:
- **[doc]** = fetched from official docs this session.
- **[search]** = web search snippet or third-party source. Treat as unverified.
- **[mem]** = general knowledge, not re-verified. Treat as unverified.

"Ours" is taken from `docs/audit-2026-10-25/README.md` (scorecard) plus spot greps. The scorecard says almost nothing was run, so "stub" means "stub on disk".

Legend for "Ours": OK = real and wired, PART = partial, STUB = looks done but inert, NONE = missing.

Priority is for a self-hosted operator audience: P0 = table stakes, P1 = high value, P2 = nice to have, P3 = skip or defer.

Caveat on research depth: many WebFetch pulls of official landing pages were shallow. Several platform claims are therefore **[mem]** and labelled so. Re-verify before putting any of them in marketing copy.

---

## 1. Taxonomy matrix

### A. Deploy sources and build

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Git push or webhook auto-deploy (GitHub) | All. Vercel, Netlify, Render, Railway, Coolify, Dokploy, Komodo stacks "auto-deploy on push" [doc]; Heroku auto-deploy [doc] | STUB. Secret never written, always 401, push ignored | P0 |
| GitLab / Bitbucket / Azure DevOps / generic git | Vercel supports all four [doc]. Dokku and Coolify support generic git [mem] | STUB (GitLab); NONE for the rest | P1 |
| Private repo access (GitHub App, deploy keys) | Vercel, Dokploy "Git Sources" [doc], Coolify GitHub App [mem] | NONE (anonymous clone) | P0 |
| Prebuilt image deploy | Dokku [doc], Dokploy, Coolify, Fly, Render | PART (works, no registry credentials) | P0 |
| Zip / folder drag-and-drop upload | Vercel Drop (works without an account) [doc]; CapRover CLI deploy of the git commit [doc] | PART (and has command injection) | P1 |
| CLI deploy from a working dir | Vercel `vercel deploy` [doc]; CapRover `caprover deploy` [doc]; fly, railway | NONE | P0 |
| Deploy hooks (secret URL triggers a deploy) | Vercel [doc]; Render, Netlify build hooks [mem] | NONE | P0 (quick win) |
| Dockerfile build | Everyone | OK | done |
| Auto-detect builder (Nixpacks/Railpack/buildpacks) | Railway defaults to Railpack [doc]; Dokku uses Herokuish buildpacks [doc]; Coolify, Dokploy use Nixpacks [mem] | STUB. Advertises auto-detect, runs an alpine template | P1 |
| Compose as a first-class source | Komodo stacks [doc]; Dokploy, Coolify, Portainer [mem/doc] | STUB (deploys nginx:alpine) | P0 for this audience |
| Build logs streamed | All | NONE (output not captured) | P0 |
| Build cache / remote or dedicated build server | Dokploy "Build Server", "Concurrent Builds" [doc]; Komodo EC2 spot builders [doc] | NONE | P2 |
| Watch paths / monorepo filters | Railway watch patterns [doc]; Dokploy "Watch Paths" [doc]; Render path filters [doc] | NONE | P1 |
| Pre-deploy / release command (migrations) | Railway `preDeployCommand` [doc]; Heroku Release Phase [doc]; Render `initialDeployHook` [doc] | NONE | P1 |
| Image registry push and pull (multi-node) | Dokploy Registry [doc]; Kamal registry [mem]; Dokku registries [doc] | NONE. Multi-node swarm cannot pull | P0 |

### B. Environments, previews, release safety

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| PR / preview environments | Vercel, Netlify, Render (full-env copies, expiry, `previewValue`) [doc], Railway PR envs [mem], Dokploy previews with labels, 3 max, wildcard domain [doc], Heroku Review Apps [doc], Coolify [search] | STUB (DNS + route to the existing container) | P1 |
| Preview TTL / auto-expire | Render `expireAfterDays` [doc] | NONE | P2 |
| Skip-preview markers in PR title/labels | Render [doc]; Netlify `[skip ci]` [search]; Dokploy label gate [doc] | NONE | P2 |
| Rollback to previous deploy (instant, retained artifact) | Vercel Instant Rollback [doc]; Netlify one-click [search]; Dokploy Rollbacks [doc]; Heroku rollback [mem] | PART (monolith only; UI omits target) | P0 |
| Promote-without-rebuild (artifact promotion) | Heroku pipelines [doc]; Vercel promote [doc] | NONE | P1 |
| Pipelines / staging to production environments | Heroku [doc]; Railway environments [doc]; Render environments [mem] | PART (environment CRUD exists, rules inert) | P1 |
| Zero-downtime / health-gated cutover | Kamal-proxy readiness [doc, search]; Dokploy Zero Downtime [doc]; Dokku checks [doc]; Railway overlap/draining [doc] | PART (health gate, route flip; swarm runner unreachable) | P0 |
| Canary / rolling release by traffic % | Vercel Rolling Releases (stages, cookie bucket, abort, API/CLI) [doc] | NONE (greps for "canary" hit only incidental code) | P2, but a differentiator (section 4) |
| Skew protection | Vercel [doc] | NONE | P3 (frontend-specific) |
| Deployment protection / approvals / allowed-source policy | Vercel deployment policy per environment [doc] | NONE | P1 |
| Scan-gated deploys | Few (Vercel firewall is a different thing) [mem] | PART (image vuln scanner exists, not gating) | P1, cheap |
| Deploy history plus diff of config | Vercel [doc], Render [mem] | PART | P2 |

### C. Runtime, scaling, jobs

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Replicas / manual scale | Everyone. Railway multi-region replicas [doc]; Fly Machines [doc]; Dokploy Cluster [doc] | NONE (no scale call in swarm UI) | P0 |
| Autoscaling | Fly autoscale/autostop/autostart/suspend [doc]; Render [mem]; Vercel Fluid [mem] | NONE (2 file hits, incidental) | P2 |
| Scale-to-zero / autostop on idle | Fly [doc] | NONE | P2 |
| Cron jobs | Dokku cron [doc]; Railway cron field [doc]; Dokploy "Schedule Jobs" [doc]; Komodo Procedures scheduled [doc]; Render, Coolify [mem] | NONE | P0 |
| Background workers and queues | Render workers [doc]; Heroku process types; Kamal roles [doc]; Vercel Daemons [doc, via related links] | NONE (no role/process-type model) | P1 |
| Multiple processes per app (Procfile / roles) | Fly [doc]; Dokku Procfile [doc]; Kamal roles [doc] | NONE | P1 |
| Restart policy / healthchecks (HTTP/TCP/custom) | Railway [doc]; Fly [doc]; Kamal [doc] | PART (stored, ignored at deploy) | P0 |
| Resource limits / quotas | Dokploy [mem]; Docker | STUB (project quotas inert) | P1 |
| Machine / node migration off bad host | Fly [doc] | NONE | P2, natural fit for swarm |
| Node drain / promote / remove | Dokploy Cluster, Portainer [mem] | NONE | P0 for multi-node |

### D. Data, storage, add-ons

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| One-click managed databases | Coolify (any DB image; PG/MySQL/Redis/Mongo/ClickHouse) [doc]; Dokploy Databases [doc]; Dokku plugins [doc]; Easypanel [search]; Render, Railway [mem] | NONE | P0 |
| Scheduled DB backups to S3 | Coolify [search, doc for S3]; Dokploy S3 Destinations/Backups [doc]; Easypanel scheduled, retained, restorable plus R2 preset [search] | NONE | P0 |
| Volume backups | Dokploy "Volume Backups" [doc]; Easypanel [search] | NONE | P1 |
| Platform self-backup (control-plane state) | Coolify instance backup [search] | NONE (and this repo has no backup story at all) | P0 |
| Persistent volumes | Railway [doc]; Fly [mem]; all | PART (per-node volume, no cross-node story) | P1 |
| S3 destinations as a shared resource | Dokploy, Coolify [doc] | NONE | P1 |
| Template / one-click app catalogue | Coolify 300+ [doc]; Easypanel 750+ [search]; CapRover one-click [doc]; Railway templates [doc]; Dokploy templates [mem] | NONE (contract mounted, 16 procs, no impl) | P0 |
| Database branching / per-preview DB | Render previews copy datastores empty [doc] | NONE | P3 |

### E. Config, secrets, Infrastructure as Code

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Declarative project file in the repo | Render `render.yaml` Blueprints, auto-sync, generate-from-existing, adopt [doc]; Kamal `deploy.yml` [doc]; Fly `fly.toml` [doc]; Railway IaC `.railway/railway.ts` with plan/apply and destructive guard [search]; Dokku `app.json` [doc]; CapRover `captain-definition` [doc]; Vercel `vercel.json` [mem] | NONE (`deployer.yaml` greps to 0) | P0 |
| GitOps reconcile of the platform itself | Komodo Resource Sync (TOML diff, UI confirm, git poll, pending alerts) [doc, search]; Portainer GitOps stacks [mem] | NONE | P1 |
| Terraform provider | Coolify, NetBird, Tailscale, Render, Vercel [mem]. Not confirmed from docs | NONE (5 incidental file hits) | P2 |
| Env var groups shared across services | Render env groups [doc]; Komodo shared variables with interpolation [doc]; Dokploy [mem] | PART (project to service to user merge, plaintext) | P0 |
| Per-environment variables | Railway [doc]; Vercel [mem] | PART | P0 |
| Secrets masked, encrypted at rest | Everyone sane | NONE (plaintext, encrypted table unused) | P0 |
| External secret providers (Vault, Infisical, etc.) | Dokploy "Secrets Providers" [doc] | NONE | P2 |
| Build-time secrets and args | Everyone | NONE (args never passed) | P1 |
| Config precedence (code over dashboard) | Railway [doc] | n/a | P3 |
| Patches / file overrides on a repo | Dokploy "Patches" [doc] | NONE | P3 |

### F. Observability and ops

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Runtime log viewer, live | Everyone | PART (Docker pages real; service logs tab fake) | P0 |
| Build log viewer | Everyone | NONE | P0 |
| Metrics (CPU/mem/net/disk) with history | Railway [doc]; Dokploy "Logs & Metrics" [doc]; Komodo alerts for CPU/mem/disk [doc] | PART (live streams; no history) | P1 |
| Log drains / forwarding | Netlify log drains [search]; Vercel log drains [mem] | NONE (0 hits) | P1 |
| OTel / Prometheus export | Common [mem] | NONE (3 incidental hits) | P1 |
| Alerts (deploy, health, node, resource) with routing | Komodo Alerters with whitelist/blacklist/type filter [doc, search]; Dokploy Notifications [doc]; Coolify [mem] | NONE (nothing delivers) | P0 |
| Notification channels (Slack, Discord, email, ntfy, webhook) | Komodo via Apprise/ntfy community alerters [search]; Dokploy [doc] | NONE | P0 |
| Status page / uptime checks | Few built in (Coolify and Dokploy: not confirmed) | NONE | P2 |
| Audit log | Netlify team and project audit log (Pro+) [search]; Vercel [doc, linked]; Dokploy Enterprise [doc] | NONE | P0 |
| Web terminal / exec | Komodo [doc]; Portainer, Dokploy [mem] | OK (exec with logs and files; Viewer can exec, which is a bug) | done, fix authz |
| Agent-powered debugging | Vercel Agent [doc, link title]; Dokploy "AI Assistant" [doc, nav item] | NONE | P2 |

### G. Networking, domains, certificates, edge

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Custom domains with verification | Everyone | STUB (never enforced) | P0 |
| Auto TLS (ACME HTTP-01) | Everyone | PART (ACME exists, default email is wrong) | P0 |
| Wildcard certs via DNS-01 | Dokploy DNS Providers and Certificates [doc nav]; CapRover requires wildcard DNS [doc] | NONE (Cloudflare only for DNS) | P1 |
| Auto-generated preview or default domains | Dokploy traefik.me [doc]; Vercel, Netlify, Render | PART (`*.deployer.localhost` hardcoded) | P0 |
| Private networking between services | Railway per-project [doc]; Fly 6PN [mem]; Kamal private `kamal` network [search] | OK via overlay | done |
| Cross-host private mesh | Tailscale Services [doc]; NetBird Networks [doc]; Dokploy guides for Tailscale and Cloudflare Tunnels [doc nav] | OK (own WireGuard mesh) | **differentiator** |
| Expose without opening ports | NetBird Reverse Proxy (beta) [doc]; Cloudflare Tunnel; Tailscale Funnel [doc]; Portainer Edge Agent polls outbound, no inbound [doc] | OK (edge providers; tunnel unverified live) | **differentiator** |
| Mesh DNS (`svc.internal`) | Fly `.internal`; Tailscale MagicDNS [mem] | NONE (no resolver) | P1 |
| IP allowlist / basic auth / country rules per route | NetBird proxy IP/country/CrowdSec/SSO/PIN [doc]; Dokploy inherits security and redirects in previews [doc] | STUB (settings inert) | P1 |
| CDN / edge cache | Vercel, Netlify, Fly [mem] | NONE | P3 (use Cloudflare edge provider) |
| L4 (TCP/UDP) service exposure | NetBird L4 and TLS-SNI [doc]; Tailscale serve TCP [doc] | NONE | P2 |
| Load balancing across replicas, sticky sessions | Fly Proxy [doc]; Traefik | PART | P1 |

### H. Teams, access, security

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| RBAC with project scoping | Dokploy custom roles (Enterprise) [doc]; Portainer RBAC (Business) [doc]; Komodo [mem] | STUB. `requireAuth` only; Viewer can exec | P0 |
| SSO / OIDC | Komodo OIDC with GitHub, Google, generic [doc]; Dokploy Enterprise SSO and SCIM [doc] | PART (Better Auth could host; 2 incidental hits) | P1 |
| 2FA / passkeys | Dokploy account security [doc nav] | PART/STUB | P1 |
| Teams / orgs | Coolify teams [mem]; Vercel, Netlify | NONE (docs promise it) | P2 |
| API keys / PATs, scoped | Vercel tokens [doc]; Easypanel keys [search]; Coolify [doc, section exists] | STUB (header mismatch) | P0 |
| Image vuln scan | Few | OK | done |
| Signed webhooks and SSRF-safe outbound | n/a | STUB | P0 |

### I. API, CLI, SDK, MCP, AI

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Public REST/OpenAPI | Vercel REST [doc]; Komodo REST+WS [doc]; Coolify, Easypanel [doc/search] | PART (ORPC contracts; openapi in 98 files; not a documented public surface) | P0 |
| CLI | Vercel, Fly, Railway, CapRover [doc], Komodo [doc], Easypanel [search] | NONE (planned) | P0 |
| SDKs (TS, Rust) | Vercel SDK [doc]; Komodo Rust crate + npm [doc]; Netlify SDK [doc] | NONE (but ORPC gives a typed TS client for free) | P2 |
| MCP server (official) | Vercel `mcp.vercel.com`, OAuth, deploy, logs [doc]; Netlify [doc]; Fly (`fly mcp launch` and a provisioning server) [doc]; Render (early access, 2025) [search]; Coolify [doc, section exists]; Easypanel CLI+MCP [search] | NONE (0 hits) | P1 (cheap, section 6) |
| AI assistant inside the panel | Dokploy [doc nav]; Vercel Agent [doc, link title] | NONE | P2 |
| Deploy hooks, generic signed webhooks (inbound) | Vercel [doc]; Coolify [search] | NONE | P0 |
| Outbound event webhooks | Komodo alerters; Heroku [mem] | NONE | P1 |

### J. Cost, usage, DX extras

| Feature | Who has it | Ours | Pri |
|---|---|---|---|
| Usage and cost view | Hosted platforms (billing) | NONE | P3 for self-host. Offer "resource usage per project" instead |
| Template marketplace with community submissions | Coolify, Easypanel, Railway [doc/search] | NONE | P1 |
| Auto-update of containers (Watchtower style) | Komodo [mem, not confirmed from docs] | NONE | P2 |
| Multi-tenancy | Dokploy Core "Multi-Tenancy" [doc nav] | NONE (decision pending) | P2 |
| Production hardening guide | Dokploy [doc nav] | NONE | P1 (docs only) |

---

## 2. Table stakes we lack (ordered)

Every self-hosted PaaS above has these. Several are "present on paper but inert" in our scorecard, which is worse than absent because the UI lies.

1. **Working push-to-deploy and private repos.** Webhook secret, raw-body HMAC, GitHub App installation tokens. Every competitor does this on day one.
2. **Honest build, with logs.** Remove the `nginx:alpine` success fallback. Capture and stream build output.
3. **Authorization.** This is not a market feature, but no other platform ships "Viewer can exec". It blocks any adoption.
4. **Secrets and env groups, encrypted and masked.** Render env groups, Komodo shared variables.
5. **Managed databases plus S3-scheduled backups plus a template catalogue.** Coolify, Dokploy, Easypanel, CapRover, Dokku all lead with this. It is the main reason people pick them over raw Docker.
6. **Backup and restore of the platform itself** (Postgres, mesh roster, secrets).
7. **Cron jobs.** Present in Dokku, Dokploy, Railway, Komodo.
8. **Alerts and notifications that actually send.** Komodo alerters, Dokploy notifications.
9. **Audit log.**
10. **Scale, drain, remove node.** Dokploy Cluster, Portainer.
11. **Domain verification, enforced; wildcard certs; a real installer.**
12. **CLI plus API tokens plus deploy hooks.** CapRover has a CLI that is `login` then `deploy`.
13. **Rollback that reverts.** Exists in the monolith, not in the fork.
14. **Registry push so multi-node swarm can pull.**

---

## 3. Top 30 new features, ranked

Scoring: value to self-hosted operators x differentiation / effort. "Builds on" lists what already exists so effort is honest.

| # | Feature | Why / who has it | Builds on | Effort |
|---|---|---|---|---|
| 1 | Authorization policy layer (platform x project role x ownership), default-deny | Gate for everything. Portainer/Dokploy gate RBAC behind paid tiers; free is a differentiator | `requirePlatformRole`, project roles | M |
| 2 | Honest deploy pipeline: plan stored on row, no silent success, build logs captured | Table stakes | Dockerfile builder, health gate | M |
| 3 | Git-push deploy: webhook secret, raw-body HMAC, durable dedupe, system actor | Every competitor | existing push trigger | S-M |
| 4 | Declarative `deployer.yaml` in repo (service, env, health, cron, preDeploy, previews) plus `deployer plan/apply` | Render Blueprints [doc], Railway IaC [search], Kamal [doc]. Fixes the "stored but ignored" class of bug by making the file the single reader | service config schema | L |
| 5 | CLI: `login`, `deploy`, `logs`, `rollback`, `exec`, `mesh connect`, `plan/apply` | CapRover [doc], Vercel [doc], Komodo [doc] | ORPC typed client | M |
| 6 | Scoped API tokens (PAT and per-project deploy keys) | Vercel, Easypanel [doc/search] | Better Auth API keys (fix header mismatch) | S |
| 7 | Deploy hooks (secret URL) and generic signed inbound webhooks | Vercel [doc] | trigger registry | S |
| 8 | Template catalogue with one-click DBs first (Postgres, MySQL, Redis, Mongo) | Coolify 300+ [doc], Easypanel [search] | templates contract (16 procs) | M-L |
| 9 | Scheduled backups to S3-compatible destinations (DB and volume) plus restore drill | Dokploy [doc], Coolify [search], Easypanel [search] | none | M |
| 10 | Platform self-backup (PG, roster, secrets) with one-command restore | Coolify instance backup [search] | none | M |
| 11 | Encrypted secret store, masked on read, env groups, per-environment values | Render [doc], Komodo [doc] | encrypted table already exists | M |
| 12 | Notification and alert engine (deploy, health, node, cert expiry) with channel filters | Komodo alerters [doc/search] | event bus, health probes | M |
| 13 | Audit log (who did what, to what, from where), exportable | Netlify [search], Vercel [doc], Dokploy Enterprise [doc] | oRPC middleware point | S-M |
| 14 | Cron jobs as a service type (swarm replicated-job or one-shot) | Dokku, Railway, Dokploy [doc] | swarm runner | M |
| 15 | Private repo auth via GitHub App installation token and deploy keys | Dokploy Git Sources [doc] | `getInstallationAccessToken` exists | S |
| 16 | Real builders: Railpack (as Railway defaults to) plus compose realizer | Railway [doc], Komodo stacks [doc] | `SwarmComposeRealizerService` (709 lines) | M |
| 17 | Swarm as default runner: rolling update, start-first, rollback-on-failure, registry digest pull | Dokploy Zero Downtime [doc], Kamal-proxy [doc/search] | swarm runner is REAL but unreachable | M |
| 18 | Embedded or mesh-local registry for multi-node image distribution | Dokploy Registry [doc] | mesh | M |
| 19 | Node ops: drain, promote, demote, remove, scale, prune | Dokploy Cluster [doc], Portainer [mem] | docker UI | M |
| 20 | PR preview environments, real: per-PR build, teardown, TTL, label gate, `previewValue` overrides | Render [doc], Dokploy [doc], Heroku [doc] | preview rows, DNS, route | L |
| 21 | Domain verification enforced at routing; platform host reservation | Table stakes | Domain module | S-M |
| 22 | Wildcard DNS-01 and cert UI (Cloudflare first) | Dokploy Certificates and DNS Providers [doc nav] | Cloudflare DNS | M |
| 23 | MCP server exposing ORPC (read-first, human confirm for writes) | Vercel [doc], Fly [doc], Easypanel [search] | ORPC contracts | S-M |
| 24 | Log drains (syslog/HTTP/Loki) and OTel/Prometheus exporter | Netlify [search] | log streams | M |
| 25 | Metrics history (time series, retention) | Railway [doc], Dokploy [doc] | node and container metric streams | M |
| 26 | Release phase / pre-deploy command, watch paths | Railway [doc], Heroku [doc], Dokploy [doc] | workflow | S |
| 27 | Promote-without-rebuild between environments (artifact pinning by digest) | Heroku [doc], Vercel [doc] | image tags | M |
| 28 | Mesh DNS resolver (`<svc>.<proj>.deployer.internal`) | Tailscale MagicDNS [mem] | mesh-agent | M |
| 29 | Progressive delivery: weighted canary via Traefik weights, abort, auto-rollback on health | Vercel Rolling Releases [doc] | Traefik, health gate | M-L |
| 30 | Status page and synthetic uptime/cert checks | Few self-hosted PaaS (not confirmed either way) | health monitoring | M |

Items 1-3 and 11 are not "features" a user would ask for. They are prerequisites from the audit and should precede anything else on this list.

---

## 4. Quick wins (days, not weeks)

1. **Deploy hook URLs** (#7). One more trigger source in `triggers/deployment-trigger-registry.service.ts`, HMAC or random token, rate-limited. Vercel's model [doc].
2. **Scoped API tokens**: fix the `x-api-key` vs `Authorization` mismatch and have the BFF forward it. Unlocks CLI, CI, and MCP.
3. **Audit log middleware**: one ORPC middleware writing actor, procedure, and resource id to a table. Do it before more mutations exist.
4. **Scan-gated deploys**: scanner already works. Add a severity threshold plus per-service override.
5. **GitHub webhook secret write and raw-body verify**: the code resolves repo to service correctly already (`github-push-trigger.source.ts`).
6. **Watch paths and skip markers** (`[skip deploy]`) on the push trigger.
7. **Pre-deploy command field** wired into the workflow (migrations).
8. **MCP server, read-only first** (list projects, deployments, logs, node status). Thin wrapper over ORPC contracts.
9. **Remove inert settings from the UI** until wired. Honest UI is a quick win and avoids the "silent success" class.
10. **Production hardening guide and a working `README`**: Dokploy ships one [doc nav]. Cheap trust signal.
11. **Alert on cert expiry and node-down via the existing event bus** once any one channel (webhook or ntfy) works. Komodo's community uses Apprise/ntfy [search], so a generic webhook plus ntfy covers most operators.
12. **Fix swarm runner selectable** (remove enum exclusion): the code is REAL and the exclusion is a one-line gate, though reachability needs registry pull first.

---

## 5. Differentiators we could own

Every competitor's remote story is one of: (a) an agent that polls a central server outbound (Portainer Edge [doc]), (b) a mesh product with its own control plane (Tailscale, NetBird [doc]), or (c) SSH from the deploy machine (Kamal [mem]). Our "mesh-first, no source of truth, nodes never open inbound ports" is architecturally different from all of them. It is also the operator's stated principle (memory: "Mesh first, no source of truth").

Be honest about where this is claimed but not yet true: relay-over-session is a stub, so NAT-only peers never converge, and the Cloudflare tunnel provider has not been verified against real Cloudflare.

| Differentiator | What competitors do | What we can claim | Gap to close |
|---|---|---|---|
| **No inbound ports, ever, and no control plane** | Portainer Edge needs the server's UI and tunnel port reachable [doc]. NetBird/Tailscale/Headscale rely on a coordinator (our own doc says the same) | Any member can do anything any other can. Founder-loss e2e exists | Relay-over-session for NAT-only peers; token rotation on revoke; tunnel verified against real Cloudflare |
| **Pluggable edge providers** | NetBird Reverse Proxy is beta and one provider [doc]; Dokploy documents Cloudflare Tunnel and Tailscale as guides [doc nav], not as first-class | `direct`, `cloudflare-tunnel` today; plugin model ready | Add providers: Tailscale Funnel, NetBird expose, a "bring your own VPS as a front door" provider, plus per-provider health. Each is a small plugin |
| **Multi-node swarm with a private overlay by default** | Dokploy Cluster and Portainer manage swarm but leave inter-node networking to the operator | Swarm rides the mesh (mesh address advertised) so nodes can sit behind CGNAT or home routers | Drain/scale/remove; registry distribution; placement by label |
| **Mesh DNS plus identity-aware service access** | Tailscale Services, NetBird "NetBird-Only Access" [doc] | Services reachable by name only inside the mesh, public exposure explicit per route | Mesh resolver (#28); per-route "mesh-only / public / IP-allowlist" toggle (NetBird's IP/country/SSO controls [doc] as the feature bar) |
| **Signed, replicated roster as the audit and trust anchor** | None | A tamper-evident record of who joined and who was revoked, replicated without a server. Export it as the platform's first audit-log stream | Surface in UI; tie deploy actors to roster member ids |
| **Edge-local deploys (agent pulls its own work)** | Portainer Edge polls [doc]; Kamal pushes over SSH [mem] | Nodes converge on desired state they hold (CRDT) so a node that was offline catches up without a central scheduler | Needs the desired-state model first (links to #4, `deployer.yaml`) |
| **Home-lab / multi-site / edge fleet** | Fly and Vercel are hosted only. Coolify and Dokploy assume reachable servers | "Run apps on three machines in three houses with no static IPs." Nobody else markets this | Relay; placement; storage story for cross-node volumes |

Suggested roadmap order for the differentiators: (1) finish relay and verify the tunnel provider, (2) one more edge provider via the plugin API (Tailscale Funnel is the cheapest because the user already runs Tailscale [doc: Funnel exposes a service publicly]), (3) mesh DNS, (4) node ops, (5) desired-state convergence, (6) mesh-only routes with IP/country rules.

---

## 6. IaC / GitOps / API-CLI / MCP

### What the market does

- **Single-file app config in the repo.** Render `render.yaml` can generate from existing services (env values become `sync: false`), adopt existing resources, and never deletes on removal or disconnect [doc]. Railway now separates "Config as Code" (one service, `railway.json/toml`, deprecated for legacy services after 2026-12-01 [doc]) from "Infrastructure as Code" (`.railway/railway.ts`, whole project and environment, `config plan` and `config apply` with a destructive-change confirmation) [search]. Kamal uses `config/deploy.yml` with accessories, roles, hooks, secrets files [doc]. Fly uses `fly.toml` [doc]. Dokku uses `app.json` and Procfile [doc].
- **Reconcile the platform from git.** Komodo Resource Sync: declare resources as TOML in UI, local file, or git. Core diffs against current state, alerts about pending changes, executes only on confirmation [search]. A community issue reports deploy confirmation can still be manual despite `deploy = true` [search], so verify before copying that behaviour.
- **Layered precedence.** Railway: environment-specific code settings override base code settings, which override dashboard service settings [doc].
- **Terraform providers** exist for several (Coolify, NetBird, Tailscale, Render, Vercel) [mem]. Not confirmed from fetched docs.
- **CLI.** CapRover `serversetup`, `login`, `deploy` [doc]; Vercel `deploy`, `logs`, `curl --deployment`, `rolling-release start/complete` [doc]; Komodo CLI [doc].
- **API.** Vercel's deploy-by-API uploads file SHAs then creates the deployment [doc]. Komodo exposes REST plus WebSocket and typed clients (Rust crate, npm) [doc].

### Recommendation for us

1. **One schema, three surfaces.** Define `deployer.yaml` once (zod). The UI form, the CLI, the MCP tools, and a future Terraform provider all read and write the same schema. This also eliminates the "stored but ignored" class of defects, since a single resolver reads the saved config at deploy time.
2. **Adopt Render's safety rules**: removing a file never deletes resources; `generate` from existing state; `sync: false` for secrets.
3. **Adopt Railway's `plan` and `apply --confirm-destructive`** as the CLI contract. Also the Komodo behavior of pending-changes alerts with manual confirm (useful for production environments).
4. **GitOps for the platform itself** as a later step: Komodo-style Resource Sync. In our architecture, the desired state could sit in the replicated roster rather than a central DB (links to the mesh-first principle). That is an open design question for the operator.
5. **Terraform provider: defer.** Generate it from the OpenAPI spec once the public API surface is stable. Do not hand-write.
6. **API surface**: publish a versioned OpenAPI document from the ORPC contracts, with scoped tokens (#6). Today the contracts are internal.

---

## 7. AI-assisted ops: what is realistic

### What exists in the market

- Vercel: official MCP server (remote, OAuth, search docs, manage projects and deployments, analyze logs, web analytics). The docs warn about prompt injection and tell users to enable human confirmation [doc]. A "Vercel Agent" exists [doc, link title only; capabilities not fetched].
- Fly: `fly mcp launch` deploys MCP servers; separate MCP server for provisioning apps [doc].
- Netlify: MCP server, AI Gateway, Agent Runners [doc].
- Render: early-access MCP (create web services/datastores, logs, deploy history, query Postgres), June 2025 [search].
- Easypanel: CLI and MCP setup next to API keys [search]. Coolify: has an MCP section [doc, no detail].
- Dokploy: "AI Assistant" under Server docs [doc nav, content not fetched].

### Realistic for us (ordered by safety and payoff)

| Tier | Feature | Notes |
|---|---|---|
| 1. Read-only MCP | list projects, deployments, logs, node and mesh status, domain state | Safe. Thin wrapper over ORPC. Gives immediate value to any user running Claude Code or Cursor |
| 2. Diagnose-failed-deploy | MCP prompt or in-panel button: bundle last build log, container logs, health result, recent config diff, and ask a model for a likely cause | Needs build logs captured first (#2). Output is advice only |
| 3. Config generation | "Generate `deployer.yaml` for this repo" (detect stack, propose healthcheck, port, env keys) | Good fit once schema exists. Human reviews diff, then `plan` |
| 4. Write tools with a confirmation gate | deploy, rollback, scale, with a plan preview and an explicit approve step (Vercel's advice [doc]) | Reuse `plan/apply` as the gate. Never let an MCP client skip it |
| 5. Alert triage | summarize an alert burst, correlate node-down with deploy failures | Optional, after alerts exist |

What I would not build: autonomous remediation (auto-restart, auto-scale, auto-rollback decided by a model). The prompt-injection warning in Vercel's docs [doc] applies doubly to a platform that handles logs from untrusted app containers. If we want auto-rollback, make it a deterministic health-gate rule, not an LLM decision.

Security note for MCP: log content is attacker-controlled data. Treat it as data, never instructions. Scope MCP tokens (read-only by default), and bind them to project membership once the authz layer exists.

---

## 8. What I could not confirm

- Official pages for Coolify teams/Terraform/notifications, Easypanel templates/monitoring, Portainer GitOps and RBAC detail, Komodo auto-update, and Heroku rollback returned thin or no content. Those rows are tagged [mem] or [search].
- Railway "PR environments" page returned 404. The PR environments claim is [mem].
- Vercel Agent, Dokploy AI Assistant: existence confirmed only by a link title or nav item; capabilities unverified.
- Kamal proxy and accessories details came from third-party blog results, not official docs, apart from the config overview page.
- Our own status comes from the audit scorecard; greps were file-count heuristics (for example "canary" hits are incidental), not behavior checks.

---

## 9. Sources

Official docs fetched or surfaced:
- Vercel deployments: https://vercel.com/docs/deployments/overview
- Vercel rolling releases: https://vercel.com/docs/rolling-releases
- Vercel MCP: https://vercel.com/docs/mcp/vercel-mcp (canonical https://vercel.com/docs/agent-resources/vercel-mcp)
- Render Blueprints: https://render.com/docs/infrastructure-as-code
- Render preview environments: https://render.com/docs/preview-environments
- Render MCP changelog: https://render.com/changelog/official-render-mcp-server-now-in-early-access
- Railway basics: https://docs.railway.com/overview/the-basics
- Railway config as code: https://docs.railway.com/reference/config-as-code
- Railway IaC: https://docs.railway.com/infrastructure-as-code and https://docs.railway.com/cli/config
- Fly reference: https://docs.fly.io/reference
- Fly MCP: https://docs.fly.io/model-context-protocol
- Netlify docs: https://docs.netlify.com/ and https://docs.netlify.com/manage/monitoring/logs/
- Heroku pipelines: https://devcenter.heroku.com/articles/pipelines
- Kamal config: https://kamal-deploy.org/docs/configuration/overview/
- Dokku deployment: https://dokku.com/docs/deployment/application-deployment/
- CapRover: https://caprover.com/docs/get-started.html
- Portainer: https://docs.portainer.io/ and https://docs.portainer.io/admin/environments/add/docker/edge
- Komodo: https://komo.do/docs/intro and https://komo.do/docs/automate/sync-resources
- Dokploy: https://docs.dokploy.com/docs/core and https://docs.dokploy.com/docs/core/applications/preview-deployments
- Coolify: https://coolify.io/docs/ , https://coolify.io/docs/core/s3-storage/overview , https://coolify.io/docs/core/backup-and-recovery/instance-backup
- Easypanel: https://easypanel.io/docs , https://easypanel.io/changelog
- NetBird reverse proxy: https://docs.netbird.io/manage/reverse-proxy
- Tailscale Serve: https://tailscale.com/kb/1242/tailscale-serve

Repo files read: `docs/audit-2026-10-25/README.md`, `docs/audit-2026-10-25/deployments.md` (head), `docs/edge-mesh-architecture.md` (head).
