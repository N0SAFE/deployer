# Web dashboard audit (apps/web) — 2026-10-25

Scope: every route in `apps/web/src/app`, hooks/domains, navigation, shell, PWA, auth flow. Paths are relative to `v3/apps/web/src` unless noted. Method: files read directly; no scripts used to summarise code. Not every one of the ~450 tsx files was read line by line; the large Docker engine UI (container modal, create-container, image scan) was sampled (page, hooks, terminal/log hooks), not exhaustively read.

Legend: REAL = wired to a real contract procedure and handles loading/error; PARTIAL = real but missing something material; FAKE = shows synthesized/placeholder data; DEAD = code present, never reached; MISSING = not built.

Overall: this is not a mock UI. Almost every page is wired to a typed ORPC procedure, has loading + error + empty states, and has honest "unavailable" copy where the backend is missing. The weaknesses are (a) a few fake/dead surfaces, (b) no real-time for the workload lists, (c) no role-aware UI below platform-admin level, (d) PWA/service-worker not actually wired, (e) several features a deploy platform needs that have no page at all.

---

## 1. Page-by-page matrix

Common to all dashboard pages: session via `createSessionLayout` (`app/dashboard/layout.tsx:39`), auth middleware on `/dashboard*`, `/settings`, `/profile` only (`middlewares/WithAuth.ts:115-129`), error boundary per section, skip-link (`layout.tsx:54`), sidebar becomes offcanvas on mobile (`components/dashboard/DashboardSidebar.tsx:139-142`), light/dark via next-themes (`app/layout.tsx:111`). No i18n anywhere (English hardcoded, `<html lang="en">`, no next-intl/i18next). Default `QueryClient` with no options (`utils/providers/ReactQueryProviders.tsx:10`): staleTime 0, retry 3, refetch on focus.

### Public / auth / system

| Route | Status | What / backend | States / notes (evidence) |
|---|---|---|---|
| `/` (`(app)/page.tsx`) | REAL (static marketing) | Static landing, links to dashboard/signin | Static copy only; fine. Sitemap/robots point at `http://localhost:3000` and `Allow: /` (`public/robots.txt`, `sitemap-0.xml`) — wrong for a private console |
| `/auth/signin` | REAL | `authClient.signIn.email`, passkey button, dev demo credentials block gated by `NODE_ENV !== production` (`auth/_utils/dev-only.ts:9`) | Zod form, error hints. **No forgot/reset password, no email verification, no social login page** |
| `/auth/signup` | REAL in dev only | `authClient.signUp.email`; in production renders "Sign-up is closed" (`auth/signup/page.tsx:96-119`) | Gate is build mode, not a server flag (comment says so). **No invitation-acceptance page**, so "Invitation sent" (project team) has no landing route |
| `/auth/me` | REAL | Better Auth multi-session/device accounts, passkeys, push settings (760 lines) | The only place `PushNotificationSettings` is mounted (grep) |
| `/auth/error` | REAL | Error code display | ok |
| `/setup` | REAL | `setup.getState` then shared `SetupWizard` from `@deployer/ui` with `setupApi` | Server-side redirect to signin when done; middleware gate `WithSetup.ts` with 3 s timeout, fail-open |
| `/device` | REAL | Device-authorization approval (CLI login / agent capabilities) via `authClient` | Prefill from `?user_code`; explicit approve/deny |
| `/manage/web-app` | REAL UI, risky | `platform.*ManagedWeb*` (toggle, restart, set origin, enable/disable tunnel) | Page claims to be "deliberately public" (`manage/web-app/page.tsx:7-11`) but the 6 procedures have no `@AllowAnonymous` (`apps/api/.../platform-managed-web.controller.ts`), so the global AuthGuard applies: logged-out visitors get 401 -> redirect to signin (contradicts comment), and **any authenticated user of any role** can stop/restart the web app or open a Cloudflare tunnel (no `requirePlatformRole`) |
| `/~offline` | DEAD | Offline page | No service worker is built or registered, so nothing ever serves it (see §3) |
| `/middleware/error/env`, `/healthCheck` | REAL | Internal error screens | ok |
| `/api/server/health`, `/ping` | REAL | Route handlers for readiness | ok |
| `/.well-known/agent-configuration` | REAL | Agent-auth discovery | ok |

### Dashboard — platform & fleet

| Route | Status | Backend | Notes / evidence |
|---|---|---|---|
| `/dashboard` (command center) | REAL, PARTIAL | `cluster.listNodes/getSnapshot`, `fleet.admissions`, `deployment.list`, `service.list`, `reachability.ingress`, `analytics.realTime` — 7 separate reads joined in the browser (`dashboard-client.tsx:35-41`) | Derived verdict, vitals omit missing data, real empty states. `bff.dashboardOverview` hooks exist (`domains/bff/hooks.ts`) and the comment calls the landing page "first adopter", but **nothing imports `domains/bff`** (grep) — dead code. Recent deployments list is not live (no stream/poll) |
| `/dashboard/nodes` | REAL | `fleet.listServers/allocations`, `mesh.localNode`, mesh SSE | Presence derived from live mesh not registry; offline filter; copy admits "Removing them needs an API that does not exist yet" (`nodes/page.tsx:131`) — no node deregistration UI |
| `/dashboard/nodes/[nodeId]` | PARTIAL | fleet, mesh, `deployment.list(nodeId)`, `cluster.getNodeResources` | 4 tabs (overview/deployments/fleet/config), tab state is `useState` not in URL (`[nodeId]/page.tsx:27`); no node-scoped logs/shell/images/networks/volumes (the plan in `docs/FLEET-CENTRIC-FRONTEND-REWRITE.md` §2 promised them) |
| `/dashboard/nodes/capacity` | REAL | fleet admissions/allocations, set capacity, resolve admission | Admit/reject real |
| `/dashboard/nodes/diagnostics` | REAL | mesh route planner, ownership lookup, connect/disconnect peer, sessions | Operator tooling, real |
| `/dashboard/cluster` | REAL but unsafe | `cluster.getSnapshot/listNodes/getMaster/updateNode`, swarm config, swarm event SSE | Role/ingress `Select`/`Switch` call `updateNode.mutate` **immediately with no confirmation** (`cluster/page.tsx:80-84`). A guarded implementation (`_components/cluster-nodes-table.tsx`, `confirm-node-change-dialog.tsx`, `_utils/node-change-guard.ts` with quorum math + tests) exists but **is never imported** (grep: only referenced by each other) — DEAD while the unsafe path ships |
| `/dashboard/network` | REAL | `reachability.ingress` | Read-only overview; each card links to editor |
| `/dashboard/network/ingress` | REAL | lanes + edge provider (admin-gated edit via `useCanManageNetwork`) | ok |
| `/dashboard/network/mesh` | REAL | mesh members, join paths, revoke (admin-gated) | ok |
| `/dashboard/network/dns` | REAL (read) | records derived from ingress state | Read-only; no hook of its own |
| `/dashboard/network/domains` | PARTIAL | project domains (add/verify/remove), reachability | **Per-project only** — must pick a project first (`domains/page.tsx:41`); no cross-project domain/certificate inventory, no TLS expiry view |
| `/dashboard/analytics` | REAL, shallow | `analytics.getRealTimeMetrics` (10 s poll), `getDeploymentMetrics`, `getServiceHealth`, `getDeploymentUsage` | Honest: "History is not recorded yet" (`resource-snapshot-card.tsx`). 21 analytics endpoints incl. reports/report-configs are exposed in `domains/analytics/endpoints.ts` but no UI uses them (reports, API usage, storage usage, user activity) |

### Dashboard — workloads

| Route | Status | Backend | Notes / evidence |
|---|---|---|---|
| `/dashboard/projects` | REAL | `project.list/create/update/delete` + `service.list` + `deployment.list` (limit 100) | Search/sort, create/rename/delete dialogs, empty/filtered/error/slow-load states (`projects/page.tsx`). Hard `limit: 100` windows, no pagination; "Not in the latest deployments" admits it |
| `/dashboard/projects/[id]` (overview) | REAL | project, `service.list` (global, filtered client-side), environments, deployments | `service.list` fetches up to 100 services of ALL projects then filters in the browser (`[projectId]/page.tsx:36,42`) — breaks past 100 services |
| `.../services` | REAL | service CRUD + CreateServiceWizard (8 steps) | GitHub repo/branch browse + runner detection are real (`StepProvider.tsx:134-208`). `authSecretRef` still hardcoded `'default'` (`CreateService.defaults.ts:19`); no secret picker |
| `.../deployments` | PARTIAL | `deployment.trigger/cancel/rollback/retry/delete` | The only screen with Deploy/Cancel/Rollback. Lowest-quality file: `as any` on every mutation, `any` filters (`deployments/page.tsx:63-150`), bare Skeleton instead of shared states |
| `.../environments` | REAL | environments CRUD/clone/status, service x env matrix, variable templates | Free-form env names + kinds |
| `.../configuration` | REAL | general/deployment/security/resource/notification config + contracts card | ok |
| `.../configuration/environments/[environmentId]` | REAL, read-only | `project.getEnvironment` | Read-only; edit lives elsewhere. **Linked wrongly from service env page** (see §3 bug 1) |
| `.../dependencies` | REAL (expected) / derived (real) | service deps + docker containers | "Real state" graph derived from shared docker network on the LOCAL engine only; `graphServiceEnvironments` fakes "every service in every env" (`dependencies/page.tsx:72-77`) |
| `.../domains` | REAL | project domains add/remove/verify | ok |
| `.../team` | PARTIAL | collaborators list/invite/role/remove | Shows `userId` instead of name/email in remove dialog (`team/page.tsx:86`); invite has no accept page |
| `.../services/[sid]` (overview) | REAL, thin | service, deps, env links, last 5 deployments | Heavy `as unknown as` casts; **no Deploy / Redeploy / Restart / Stop button** on service pages (only active toggle in layout) |
| `.../services/[sid]/deployments` | REAL (partial) | `deployment.list`, `deployment.getLogs` (polled 4 s while running, `deployment-logs-viewer.tsx:37-41`) | Real build/deploy output, pause/follow/copy/download. **No rollback/cancel/redeploy on this screen**; `deployment.stream*` procedures never used (grep) |
| `.../services/[sid]/logs` | **FAKE** | `docker.deployment.list` + `docker.container.list` + mesh SSE | Not logs. Lines are sentences composed from statuses ("Deployment completed in production"). Code says so itself: "KNOWN GAP — these are not log lines" (`logs/_utils/service-activity.ts:44-55`). Real log streaming exists on `/dashboard/docker/logs` but is not wired into the service page |
| `.../services/[sid]/monitoring` | PARTIAL | `docker.container.list` | Latest snapshot only ("not a history"); local node's engine only; env columns come from a fixed `ENV_NAMES` list while environments are "free-form" |
| `.../services/[sid]/previews` | REAL | `deployment.listServicePreviews`, `promoteServicePreview` | ok |
| `.../configuration/general` | REAL | `service.update` | name/port/resources/retention |
| `.../configuration/environment` | REAL, basic | `service.update(environmentVariables)`, env links, templates | Plain key/value; values visually masked only (stored/returned in clear); no `.env` paste/import/export, no secret type, no per-env values (convention "prefix ENV_NAME"), no diff/versioning (`configuration/environment/page.tsx`) |
| `.../configuration/network` | REAL | `service.getNetwork/updateNetwork`, Cloudflare zones | ok |
| `.../configuration/provider` | REAL | `providers.*`, provider JSON-schema driven form | ok |
| `.../configuration/preview` | REAL | `service.update` preview/contract/mock | ok |
| `/dashboard/services` | REAL | service/project/deployment lists | Global inventory, 100-item windows |
| `/dashboard/deployments` | REAL, partial | `deployment.list` (node-scoped filter), `retry` | Retry only; text says "open a service to ... roll back" but service pages have no rollback |

### Dashboard — node engine (connected node only)

| Route | Status | Notes |
|---|---|---|
| `/dashboard/docker` | REAL | Engine summary + runtime SSE; live refetch via `useDockerLiveRefetch` |
| `/dashboard/docker/containers` | REAL | Table + container modal with tabs: overview, logs, env, files browser, processes, mounts, network, labels, layers, security, compose, **terminal (exec)** — real open/send/close session + stream (`docker/_hooks/use-container-terminal.ts`) |
| `/dashboard/docker/images` | REAL | list/pull/remove + security scan stream |
| `/dashboard/docker/networks`, `/volumes` | REAL | lists + event streams |
| `/dashboard/docker/logs` | REAL | Stream per container, ANSI, highlight, follow (`logs/_components/*`) — the real log viewer, but only for the local engine and not reachable from a service |
| `/dashboard/docker/shell` | REAL | Shell into a running container |
| `/dashboard/docker/activity` | REAL | Docker events live feed |
| All of the above | LIMITATION | Docker contracts take no node id; the pages show only the API-hosting node (`docker/_components/docker-node-context.tsx:12-16,50-54`) and warn when the header node picker differs. In a multi-node mesh you cannot see logs/exec/containers of other nodes. No role gate on terminal/delete in the UI |

### Settings

| Route | Status | Notes |
|---|---|---|
| `/dashboard/settings` | REAL | Hub, integration + trust summaries |
| `/dashboard/settings/account` | REAL | Profile form, theme toggle, passkeys, sessions, API keys, linked accounts (`components/account/security-cards.tsx`). Push notification settings are NOT here (only `/auth/me`) |
| `/dashboard/settings/users` | REAL | Better Auth admin: list/search/ban/role/create/remove (admin-only) |
| `/dashboard/settings/security` | REAL | Mesh trust keyring + strict mode (admin-only) |
| `/dashboard/settings/node` | REAL | Node address/config/DB test/mesh secret rotate (admin-only; non-admin sees "Administrators only") |
| `/dashboard/admin/providers` + `code/*` + `dns/*` | REAL | GitHub App (manifest, PAT, manual, install callback, repos), GitLab apps, Cloudflare (zones, records, tunnels) |
| `.../code/docker-hub`, `.../dns/route53`, `.../dns/google-dns` | PLACEHOLDER (honest) | `UnavailableIntegration` explains the API cannot store these credentials (`admin/providers/_components/unavailable-integration.tsx`). Good UX, but 3 listed integrations are unavailable. `admin` layout has no role guard; only hidden in nav |

Dead/unreachable summary: `~offline`, `domains/bff/*`, cluster guarded table + confirm dialog + guard, `PostSetupHints` mounted twice (root `app/layout.tsx:133` and `dashboard/layout.tsx:85`), `docs/qa/web-rebuild/feature-mapping-v1-v2-to-v3.md` (dated 2026-03-24, describes organizations/admin pages that no longer exist), `projects/_components/CREATION-ROADMAP.md` (stale), `apps/web/animate-pulse`, `check-manifest4.py`, `list-shells.py`, `redoc-static.html` junk in the app root.

---

## 2. What works end to end

- Auth: sign-in (email/password, passkeys), first-run setup wizard + redirect gate, device-authorization approval, sessions/API keys/passkeys management, platform user admin.
- Project -> service creation (wizard with GitHub App repo/branch browse and runner auto-detect) -> trigger deployment (project deployments page) -> per-deployment real build/deploy logs (polling) -> retry / rollback / cancel / delete (project deployments page) -> previews and promote.
- Project config: environments (kinds, rules, clone, matrix), variable templates, service env vars, domains + verification + reachability, DNS provider/zone binding, team roles.
- Fleet: node registry with live mesh presence, admissions, capacity, allocations, peer connect/disconnect, route planner, topology map, cluster snapshot/master, swarm config, swarm event feed (SSE).
- Network: lanes, edge provider, mesh membership/revoke, DNS records, join paths.
- Node engine: containers with exec terminal + files + logs + processes, images + scan, networks, volumes, events — all real streams.
- Navigation: a single typed model drives sidebar and Cmd-K palette (`components/dashboard/navigation.ts`), admin-only entries filtered in both; typed declarative routes everywhere (75 `route.info.ts`).
- Quality signals: 61 unit/state tests incl. `*.states.test.tsx` for the main sections, only 7 `as any` (one file), 451 `aria-*` usages, skip link, `role="status"/"log"`, reduced-motion handling on spinners.

---

## 3. Broken / risky

Bugs and correctness
1. **Service env page "Config" link opens a guaranteed "Environment not found".** It passes the environment *name* as `environmentId` (`configuration/environment/page.tsx:165-166`), but `useProjectEnvironment` only enables for UUIDs (`domains/project/hooks.ts:55-61`, `isProjectIdUsable` = UUID regex), so the query never runs and the page renders "Environment not found".
2. **Service "Logs" tab shows invented lines**, not logs (`logs/_utils/service-activity.ts:44-55`). The primary "why did my app crash" screen cannot answer that.
3. **Cluster page applies role/ingress changes with no confirmation** while a tested, quorum-aware guard sits unused (`cluster/page.tsx:80-84` vs `_utils/node-change-guard.ts`). Demoting the last manager is one click.
4. **PWA/service worker is not wired**: `app/sw.ts` exists but nothing builds/serves it (no `sw.js` in `public`, no serwist route handler or `next.config` integration, no `register()` call — grep). Consequences: `/~offline` unreachable; push subscribe throws "Service worker not registered" (`PushNotificationSettings.tsx:121-126`); and `sw.ts` has no `push`/`notificationclick` handler anyway. `site.webmanifest` still says "Next.js NestJS Turborepo Template" / "NestJS App" with `orientation: portrait-primary`.
5. **"Live" header chip overpromises**: it reflects cluster-control-plane reachability (`HeaderLiveStatus.tsx`) yet its tooltip says "this page updates as things change". Projects, services, deployments, dashboard home and node detail are NOT live (no streams/polls; default react-query focus refetch only). Only mesh/cluster/docker/analytics views stream.
6. Managed-web console: unauthenticated-looking page + procedures open to any authenticated role (see matrix). Needs `requirePlatformRole('admin')` and an honest comment.

Security / permission UX
7. **No project-role-aware UI.** `grep` finds no use of project roles (owner/admin/developer/viewer) in any project, deployment, or docker page; only platform-admin gating exists (settings, network, nav). A viewer sees Delete project, Deploy, Rollback, exec terminal buttons; the API must be the only barrier. Docker terminal/remove has no UI gate at all.
8. Middleware auth covers only `/dashboard*`, `/settings`, `/profile` (`WithAuth.ts:115-129`); it checks cookie *presence* (`getSessionCookie`), not validity — validity relies on the layout session fetch / 401 plugin. `/auth/me`, `/manage/*`, `/device` are outside it.
9. Env var values are returned to and held in the browser in clear (masked by `type=password` only); there is no secret store or `authSecretRef` resolution UI.
10. Dev conveniences gated only on `NODE_ENV !== 'production'` (admin@admin.com / adminadmin shown on sign-in) — safe in a prod build but a staging build with `NODE_ENV=development` leaks it.

Scale / robustness
11. Hard `limit: 100` (and 300/500 for containers) on projects/services/deployments/containers with client-side joins/filters; no pagination UI on any workload list. Project pages fetch ALL services then filter.
12. Docker engine pages only see the API-hosting node; in a multi-node mesh, service monitoring/logs/exec for services scheduled elsewhere silently show "no containers".
13. Default `QueryClient` (retry 3, staleTime 0): every mount refetches; 401/5xx storms retry thrice; no global error/offline handling.
14. Leaflet CSS (4 files) imported globally in the root layout (`app/layout.tsx:3-6`) — shipped on login/landing.
15. Code health: project deployments page full of `any`; 44 `eslint-disable`; templated leftovers (manifest, junk files, stale docs); `docs/qa/web-rebuild` mapping is 7 months stale; `HeaderLiveStatus` wording; three listed integrations unavailable.

---

## 4. Required for production (ordered)

1. Fix security-class items: role-gate managed-web procedures + fix `/manage/web-app` semantics; confirm which docker/terminal/delete procedures check roles server-side and add UI gating (project role + platform role) so viewers get read-only views.
2. Real service logs: replace the synthesized `projectServiceActivity` with `docker` container log streaming + `deployment.getLogs`, per replica/env (reuse `docker/logs` components). Make deployment logs stream (`deployment.stream`) instead of 4 s polling.
3. Deploy controls on service pages: Deploy/Redeploy/Restart/Stop/Rollback/Cancel in the service header and deployment detail; retire the `any`-typed project deployments mutation code into shared hooks.
4. Wire the guarded cluster node table (or delete it) so role/ingress changes confirm quorum impact.
5. Auth completeness: forgot/reset password, email verification, accept-invite page for project/team invites, server-driven sign-up policy (not `NODE_ENV`), 2FA enrolment UI (only status card exists), account lockout messaging.
6. Fix the env-config link bug; add `.env` import/export, secret-type variables, per-environment values, change history; implement real secret store (`authSecretRef`).
7. Real-time for workloads: subscribe lists/overview to `deployment.streamQuery`, `service.streams.query`, `project.streamQuery` (all defined, none consumed) and invalidate; set sensible `QueryClient` defaults (staleTime, retry policy, global 401/offline handler).
8. Pagination/virtualisation and server-side filters for projects/services/deployments/containers; stop client-side joins (use `bff.*` screen procedures that already exist).
9. Make the PWA real or remove it: build `sw` through serwist, register, add push + notificationclick handler, runtime caching, correct manifest name/icons/orientation; otherwise delete `sw.ts`, `~offline`, manifest.
10. Multi-node engine access: node-scoped docker procedures so logs/exec/containers work for any mesh node (the fleet-centric plan steps 2-3 left this "deferred").
11. robots/sitemap: disallow all and drop localhost sitemap; ship only on public marketing routes.
12. Remove dead code and stale docs (bff hooks or adopt them, duplicate PostSetupHints, roadmap/feature-mapping docs, junk root files); update `docs/FLEET-CENTRIC-FRONTEND-REWRITE.md` status table, which claims the node-drill pages are done ("5 node drill pages/components: done — MeshPulse built") when per-node Services/Tasks/Images/Networks/Volumes/Logs/Shell pages do not exist.
13. i18n scaffolding (at least string extraction) if non-English operators matter; keep `lang` dynamic.

---

## 5. UX/UI enhancements

- Put node tab/section state in the URL (node detail tabs, service config sections) for deep links and back-button.
- Unify list pages on one table primitive: sorting, column chooser, saved filters, bulk actions (delete/redeploy), pagination, CSV export. Today each page re-implements search/sort.
- Service page header: status, last deploy, public URL(s), replica health, Deploy/Restart/Stop split-button, env switcher (the project has first-class environments but no env switcher context).
- Command palette: add actions ("Deploy service X", "Create project", "Open logs of Y") not just navigation.
- Replace "StatStrip" top cards where AGENTS.md forbids them (nodes, network, projects overview use top KPI strips; the rule in `apps/web/AGENTS.md` bans this pattern).
- Live-state honesty: show per-page "updated 12 s ago + auto-refresh" instead of one global "Live" chip; show SSE reconnect state where streams are used.
- Deployment timeline: stage-by-stage (clone, build, push, deploy, health gate) with durations, instead of flat log text; diff vs previous deployment (commit, env, image).
- Env editor: bulk paste, reveal-all, search, "used by" and drift warnings across environments; copy between envs.
- Accessibility pass on the old pages (project deployments page, service env page use `div`/button groups without labels in places); keyboard operability of Dialog-driven delete flows; add `aria-live` to deployment status changes.
- Mobile: sidebar is offcanvas and tables use `overflow-x-auto`, but wide tables (deployments, containers) are not card-collapsed; terminal/log viewers are not tuned for touch. Only 117 of 452 tsx files use responsive prefixes — no mobile e2e.
- Theme: `theme-color` meta is static `#000000`; theme-color per scheme; `font-display` tokens exist but headings are inconsistent between old (project/service) and new (fleet) pages — two visual dialects (glass cards `bg-card/40 backdrop-blur-xl` vs flat cards).
- Team page: show names/emails/avatars, last active, pending-invite state and resend.

---

## 6. New pages / features recommended

High-value for a Vercel/Render/Coolify-class platform and currently absent (grep found no page or hook):
1. **Audit log / activity feed** (who deployed, changed env, exec'd into a container, changed roles). Docker events exist; platform-level audit does not.
2. **Secrets management** (project/environment-scoped, encrypted, rotation, reference by services). Backed by the missing `authSecretRef` resolution.
3. **Webhooks & CI/CD page**: per-service deploy webhook URL + secret, GitHub/GitLab push/PR trigger status, auto-deploy rules, deploy tokens/API keys scoped to a project (account API keys exist only at user level).
4. **Templates / one-click apps** (Postgres, Redis, Ghost, n8n, etc.) and "clone project / duplicate service".
5. **Unified log explorer** with search across services/nodes/time range and retention, plus log drains.
6. **Metrics history**: per-service CPU/memory/network time series, alert rules (CPU, restarts, health), notification channels (email, Slack, webhook, web push), notification inbox (header bell). Analytics says "History is not recorded yet".
7. **Backups & volumes**: scheduled volume/database backup, restore, retention; managed databases as first-class services.
8. **Cron jobs / one-off tasks / release commands** (migrations) per service.
9. **Certificates & domains inventory**: cross-project domain list, TLS expiry, wildcard status, redirects/www handling.
10. **Registry & image management**: private registry credentials (Docker Hub/GHCR/ECR placeholders exist, backend refuses them), image retention/prune policy UI, build cache controls.
11. **Billing/usage & quotas** (only if multi-tenant): per-project resource quotas, usage reports (analytics already exposes `generateReport/listReports` unused), plan limits.
12. **Org/team workspace** (the older plan listed organizations/invites; they were removed): teams, project transfer, SSO/SAML-OIDC providers.
13. **Node lifecycle**: add-node wizard (copy join command with token/QR), drain/cordon, remove/deregister node, per-node resource pages (Services/Tasks/Images/Volumes/Logs/Shell as originally planned).
14. **Maintenance/system page**: platform version, update check, DB backup/restore of the control plane, health of every internal component, support bundle download.
15. **Status/health page for end users** (public status of deployed services) and **incident timeline** derived from failed deployments.
16. **Onboarding checklist** on the command center (connect Git host -> create project -> add domain -> first deploy), driven by the verdict inputs it already computes.
