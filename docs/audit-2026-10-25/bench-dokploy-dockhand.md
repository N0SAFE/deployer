# Benchmark: Deployer v3 vs Dokploy vs Dockhand

Method: read-only. Competitor evidence from /home/sebille/Bureau/projects/tests/deployer/dokploy and .../dockhand (+ DOCKHAND_FEATURES.md). "Ours" from the 2026-10-25 audit scorecard (v3/docs/audit-2026-10-25/README.md) plus spot greps/listing of v3 code. Nothing was run. Ours legend: REAL / PARTIAL / STUB / MISSING.
Paths below are relative to each competitor root (dokploy/ or dockhand/) unless stated.

Positioning in one line: Dokploy = PaaS (build+deploy+DB+backup+domains) on Swarm/Traefik over SSH. Dockhand = Docker ops console (stacks, updates, scanning, audit) with no build pipeline and no ingress. We aim at the union plus a mesh-native network neither has.

Licensing note: Dokploy gates custom roles, audit log, SSO, whitelabel as proprietary (packages/server/src/lib/access-control.ts `enterpriseOnlyResources`; apps/dokploy/server/api/routers/proprietary/*). Dockhand gates LDAP, MFA, RBAC, audit behind an Enterprise license (src/lib/server/authorize.ts header comment; BSL 1.1). Free-tier RBAC/audit/SSO is an open lane for us.

---

## 1. Dokploy feature matrix

| Feature | Evidence | Ours | Gap / enhancement |
|---|---|---|---|
| Apps from GitHub/GitLab/Bitbucket/Gitea/Git/Docker image/zip drop | db/schema/application.ts `sourceType`; routers/application.ts saveGithubProvider... dropDeployment | PARTIAL: public GitHub, upload, prebuilt image; GitLab stub; private clone has no creds | Git-provider apps (GitHub App install tokens, GitLab/Gitea/Bitbucket OAuth), private clones |
| Build types: dockerfile, nixpacks, railpack, heroku/paketo buildpacks, static | schema `buildType`; packages/server/src/utils/builders/* | STUB: runner dirs exist (apps/api-services/services/runtime/src/modules/runners/{nixpacks,railpack,buildpack,dockerfile}) but audit: only explicit dockerfile works; missing builder -> nginx:alpine "success" | Make builders real, honest failure |
| Build args/secrets, cleanCache, submodules, watchPaths, command/args, replicas, CPU/mem limits | application.ts lines ~87-182 | STUB: stored, ignored at deploy | Wire service config into runners |
| Swarm service tuning (health check, restart policy, placement, update/rollback config, mode, labels, networks, ulimits, endpoint spec, stop grace) | application.ts healthCheckSwarm...ulimitsSwarm; UI components/dashboard/application/advanced/cluster | PARTIAL: swarm runner well built, not selectable | Expose swarm spec editor with typed form + YAML view |
| Docker Compose apps (docker-compose and stack types), isolated deployment, randomize names, convert preview | schema/compose.ts; routers/compose.ts (getConvertedCompose, randomizeCompose, isolatedDeployment, loadServices) | STUB: compose runner deploys nginx:alpine | Real compose realizer + service graph |
| Templates / one-click (remote catalog, TOML, variable generators, domains, mounts) | packages/server/src/templates/{github,index,processors}.ts; compose.deployTemplate/processTemplate/previewTemplate; catalog fetched from templates.dokploy.com | MISSING: contract mounted (packages/contracts/bff/modules/template, incl. validate/resolve/migration), no impl | Biggest adoption lever; our contract is richer (semantic validation, version migration) |
| Managed DBs: postgres/mysql/mariadb/mongo/redis/libsql | routers/{postgres,mysql,...}.ts (~600 lines each), db schema per DB | MISSING | Ship via templates first, then typed DB service kind |
| DB backups to S3 destinations + restore + keepLatestCount + prefix | schema/backups.ts, destination.ts; utils/backups/*, utils/restore/*; routers/backup.ts (613) | MISSING (also no platform-state backup) | See Top 25 |
| Volume backups + restore (with optional stop of service) | schema/volume-backups.ts; utils/volume-backups/*; UI application/volume-backups | MISSING | Combine with S3 destination model |
| Dokploy self-backup (web-server) | utils/backups/web-server.ts | MISSING (audit P0 #10) | Backup mesh roster + secrets + PG |
| Scheduled jobs (cron on app/compose/server/dokploy host, script editor, timezone) | schema/schedule.ts; apps/schedules (Hono + BullMQ service); routers/schedule.ts | MISSING (only internal setInterval loops) | Cron jobs per service, run in container; Dockhand shows execution history UI to copy |
| Deployment queue | apps/dokploy/server/queues/* (BullMQ + Redis, per-app jobs, cleanQueues, killBuild, cancelDeployment) | PARTIAL: BullMQ worker exists in runtime service; audit says in-memory queue, cancel is DB flip | Durable queue, real cancel |
| Rollbacks (stores full app context + image per deployment, registry-backed) | schema/rollbacks.ts (fullContext jsonb), routers/rollbacks.ts | PARTIAL: monolith only; services fork fakes it | We already have plan-snapshot/provenance contracts (packages/contracts/runtime/modules/deployment/plan-snapshot.ts): use as better rollback |
| Preview deployments per PR (+domain, comment on PR, expiry, security-block comment for non-collaborators) | schema/preview-deployments.ts; pages/api/deploy/github.ts | STUB: DNS+route to existing container | Real PR builds, teardown, PR comments |
| Webhooks: GitHub app, per-app refreshToken deploy URLs, gitlab/gitea/bitbucket | pages/api/deploy/{github.ts,[refreshToken].ts,compose/} | STUB: always 401 | Fix; add tokenized generic deploy hook |
| Patches (edit repo files at deploy time without forking) | schema/patch.ts; routers/patch.ts; services/patch-repo.ts | MISSING | Cheap, loved feature |
| Domains: Let's Encrypt/custom/none, https, stripPath, internalPath, per-domain cert resolver, wildcard host | schema/domain.ts; utils/traefik/domain.ts | PARTIAL: ACME+redirect real; verification never enforced; cert upload missing | Our edge/provider model is stronger; fix verification |
| Redirects, basic-auth security, extra ports/port mappings, mounts (volume/bind/file) | schema/{redirects,security,port,mount}.ts; UI advanced/{redirects,security,ports,volumes} | PARTIAL: Traefik middleware library exists (apps/api-services/shared/.../traefik/services/traefik-middleware-library.service.ts); project settings inert | Surface as per-service UI backed by existing library |
| Traefik file editor (dynamic config, web-server config, middlewares, env, ports) + file-system tree | routers/settings.ts read/updateTraefikConfig, readDirectories, updateTraefikFile; UI dashboard/file-system | PARTIAL: Traefik-in-swarm real, no editor | Read-only effective-config viewer + validated editor |
| Multi-server over SSH (ssh keys, setup script, validate, security audit, GPU setup) | routers/server.ts; setup/server-setup.ts, server-audit.ts (ufw/ssh/fail2ban checks); utils/servers/remote-docker.ts (dockerode over ssh) | REAL but different: WireGuard mesh + agent, no inbound ports. Add/remove node UI MISSING | Node add wizard; node security audit page |
| Swarm cluster mgmt (nodes, add worker/manager, remove) + swarm overview UI | routers/{cluster,swarm}.ts | PARTIAL: read; drain/promote/remove MISSING | Per audit P1 #20 |
| Docker management (containers list/start/stop/kill/remove, config, upload file to container, container terminal, logs WS) | routers/docker.ts; server/wss/* | REAL and richer (exec, files read/write/rename/delete, processes, inspect streams, image security scan) | Ours better; gaps: upload, remove from UI |
| Monitoring: Go collector (host + per-container CPU/mem/disk/net, retention, thresholds) + charts | apps/monitoring/*; components/dashboard/monitoring; notification `server-threshold` | PARTIAL: live streams only, no history; hostmetrics misleading | Time-series store + threshold alerts |
| Requests page (Traefik access-log analytics: status distribution, table) | components/dashboard/requests; settings.readStats/toggleRequests | MISSING | Cheap win from Traefik access log |
| Notifications: slack, telegram, discord, email, resend, gotify, ntfy, mattermost, pushover, lark, teams, custom webhook; events: build ok/err, db backup, volume backup, docker cleanup, server restart, threshold | schema/notification.ts; utils/notifications/*; routers/notification.ts (1030 lines) | STUB: web-push subscribe only; nothing delivers | Event-bus-driven delivery |
| Registry (credentials, build registry, rollback registry, push after build) | routers/registry.ts; utils/cluster/upload.ts | MISSING | Needed for multi-node swarm pulls |
| Docker cleanup (images/volumes/containers/builder), disk usage, log cleanup cron | routers/settings.ts clean*; getDockerDiskUsage | MISSING (audit: no cleanup) | |
| RBAC | lib/access-control.ts: better-auth org plugin, owner/admin/member + custom roles over ~30 resources x actions | MISSING authz (requireAuth only); no orgs | Policy layer (audit P0 #5) |
| Orgs, invitations, impersonation, teams/tags, project move/duplicate, environments (project>env>service) | routers/organization.ts, tag.ts, project.ts, environment.ts | PARTIAL: projects/environments real; orgs/invites broken | |
| Audit log (proprietary) | schema/audit-log.ts (user, role, action, resource, metadata, indexed); utils/audit | MISSING | Free-tier for us |
| SSO (OIDC/SAML), whitelabel, license key (proprietary) | routers/proprietary/*; schema/sso.ts | MISSING (Better Auth plugins available) | |
| 2FA, API keys, OpenAPI/swagger, CLI | routers/user.ts; openapi.json; pages/swagger.tsx; reset-2fa.ts | 2FA STUB, API keys STUB, OpenAPI REAL (oRPC), CLI MISSING | |
| AI assistant (generates compose from prompt, multi-provider) | routers/ai.ts; utils/ai/* | MISSING | Optional; template generation is the sane use |
| Installer (curl|bash), self-update, Stripe cloud billing | README; settings.updateServer | Installer STUB (deploy.sh is another project) | P0 |

Dokploy weak spots we can beat: SSH-driven remote control (no agent, no mesh, every op is an ssh exec; a node needs inbound 22); Redis hard dependency for queue; secrets/env in plaintext DB columns (no encryption layer found beyond Traefik/domain code); RBAC and audit paywalled; Traefik-only edge (no tunnel/CF edge); Swarm required for multi-node; no vuln scanning; no mesh DNS; no declared deployment plan object.

## 2. Dockhand feature matrix

| Feature | Evidence | Ours | Gap / enhancement |
|---|---|---|---|
| Multi-environment (socket, direct TLS, hawser-standard, hawser-edge outbound WebSocket agent) | src/lib/server/hawser.ts (edge connection manager, tokens table), routes/api/hawser/*, schema `hawserTokens` | REAL and stronger (WireGuard mesh, signed roster CRDT) but Docker pages only see API node, remote start/stop/kill not routed | Make every Docker page node-aware (selector exists: docker-node-context.tsx); route actions over mesh |
| Container list/actions (start/stop/restart/pause/rename/delete), batch ops, inspect, top, stats | routes/api/containers/[id]/*; BatchOperationModal | REAL list/inspect/processes/logs; actions via runtime-action | Batch ops, rename/pause surfaced |
| Create/Edit container modal | CreateContainerModal, EditContainerModal | STUB (toasts "created", calls nothing) | |
| Container auto-update w/ digest check, recreate-from-inspect (zero settings loss), per-container schedule, vulnerability gate (never/any/critical_high/critical/more_than_current) | scheduler/tasks/container-update.ts, update-utils.ts `shouldBlockUpdate`; schema autoUpdateSettings, pendingContainerUpdates | MISSING (scan exists; not gated) | Scan-gated update = easy leapfrog, we have scanning |
| Update check across containers, pending updates list | routes/api/containers/check-updates, pending-updates | MISSING | |
| Compose stacks: create/edit (CodeMirror), start/stop/restart/down, env vars, adopt/scan existing, import, move path | routes/api/stacks/*; StackModal; stack-scanner.ts | MISSING (docker stack procedures deliberately removed, packages/contracts/runtime/modules/docker/stacks/list.ts) | Hosts-level compose stacks + adoption of foreign stacks |
| Git stacks: repo+credentials, compose path, env file path, webhook (GitHub/GitLab signatures), cron/daily sync, build/repull/force redeploy, deploy progress SSE | schema gitStacks; routes/api/git/*; scheduler/tasks/git-stack-sync.ts | STUB | Needs webhook fix + git credentials |
| Compose service graph (Cytoscape) | stacks/ComposeGraphViewer.svelte | PARTIAL: we have service dependency graph (apps/web/.../ServiceDependencyGraphPanel.tsx) | Reuse for compose |
| Images: pull w/ progress, tag, remove, export, history, push to registry, prune | routes/api/images/*; ImagePullModal etc. | PARTIAL: list/inspect/scan; pull UI fake; no push/prune | |
| Vulnerability scanning grype + trivy, per-env scanner mgmt, results modal | lib/server/scanner.ts (1195 lines); ImageScanModal | REAL (scan streams, findings table, both scanners referenced in web) | Parity; add gating, history, scheduled rescans |
| Networks: create/inspect/connect/disconnect/duplicate/prune | routes/networks/*; routes/api/networks | PARTIAL: list only | |
| Volumes: create/inspect/browse/clone/export/prune + in-use detection | routes/api/volumes/[name]/{browse,clone,export,inspect}; VolumeBrowserModal | PARTIAL: list only (packages/contracts/runtime/modules/docker/volumes) | Volume browse reuses our container file browser |
| Registry browser (search, catalog, tags), registry creds, push/copy | routes/registry; RegistryModal | PARTIAL: list only; creds MISSING | |
| Logs: single + merged multi-container, streaming, favorites/groups, ANSI | routes/logs; /api/logs/merged | REAL single stream; merged/favorites MISSING; service logs tab fake | Merged project-level logs |
| Terminal: xterm via WebSocket, shell auto-detect, user choice | routes/terminal; containers/ContainerTerminal | REAL (terminal open/input/stream contracts); no auditing, viewer can exec | Audit + role gate + shell detection |
| File browser/editor (chmod, upload/download, rename, create, editor) for containers and volumes | FileBrowserPanel.svelte, CodeEditor.svelte (CodeMirror 6) | REAL partial (list/read/write/rename/delete/mkdir; no upload/chmod/download; text only) | Binary-safe transfer, chmod, editor |
| Activity (Docker events, virtualized, filters, SSE) | routes/activity | REAL (docker/activity page, events stream) | |
| Schedules monitor (container_update, git_stack_sync, system_cleanup, env_update_check, image_prune), execution history + logs, cronstrue | routes/schedules; scheduler/*; schema scheduleExecutions | MISSING | Our deployment lifecycle events could feed same UI |
| Notifications: smtp + apprise, per-env event sets | notifications.ts; EventTypesEditor | MISSING | Apprise bridge gives 90 targets cheaply |
| Auth: local, LDAP, OIDC, MFA, sessions; RBAC roles with env-scoped permissions (16 resources) | auth.ts, authorize.ts, schema roles/userRoles/ldapConfig/oidcConfig | Local/passkey REAL; OIDC/LDAP MISSING; MFA STUB; RBAC MISSING | Environment-scoped roles = node/project-scoped roles for us |
| Audit log (JSON/CSV/MD export, diff viewer, live SSE) | routes/audit; lib/server/audit.ts (455) | MISSING | Free, with diff + export |
| Dashboard (draggable tiles, CPU/mem history, disk usage, top containers, events summary, offline state) | routes/dashboard/* | PARTIAL (analytics, node pages); no history | |
| Command palette, saved filters/favorites, column settings, localStorage prefs | CommandPalette, DataGrid | MISSING palette | Cheap UX copy |
| Config sets (reusable env/labels bundles) | schema configSets | MISSING | |
| Environment policies: disk warning, timezone, update-check + prune schedules, labels, icons | EnvironmentModal | MISSING | Node policy panel |
| Self-update, changelog, What's New | SelfUpdateDialog; updater/ | MISSING | |
| Alerts page | routes/alerts | placeholder in Dockhand ("coming soon") | Opportunity |

Dockhand weak spots: no build pipeline, no domains/TLS/reverse proxy, no Swarm (only a network driver label), no backups, no rollback, no templates, no preview environments; RBAC/LDAP/MFA/audit enterprise-only; single control plane with agents dialing in (the "source of truth" model our operator rejects); alerts page empty; BSL license.

## 3. Top 25 features to build (value / effort, highest first)

Prerequisite (not counted): P0 authz layer, honest deploy path, secrets, installer. Without these, features below ship on sand.

| # | Feature | Value | Effort | Why / source |
|---|---|---|---|---|
| 1 | Notification delivery (SMTP, Slack, Discord, Telegram, ntfy, generic webhook, Apprise bridge) on event bus | very high | M | Both competitors; ours inert |
| 2 | Real audit log (free tier) with diff, export, live stream | very high | M | Paywalled in both |
| 3 | Fix GitHub webhooks + generic tokenized deploy-hook URL (per service) | very high | S | Dokploy [refreshToken].ts |
| 4 | One-click templates (compose-based, TOML/variables, generated secrets/domains) seeded with top 40 apps + DBs | very high | M | Contract already exists |
| 5 | Scheduled backups to S3 destinations (DB via template-declared dump command, volumes, platform state) + restore + retention | very high | L | Dokploy backup/volume-backup |
| 6 | Real builders (nixpacks, railpack, buildpack) and honest failure; build logs captured and streamed | very high | M | Dokploy utils/builders |
| 7 | Scan-gated container/service update ("update if no new critical CVEs") | high | S | Dockhand update-utils; we have scanner |
| 8 | Cron jobs per service/node with execution history UI | high | M | Dokploy schedule + Dockhand schedules |
| 9 | Cleanup/GC policies (images, volumes, builder cache, old workspaces) + disk-usage panel | high | S | Dokploy settings.clean* |
| 10 | Docker pages complete: volumes browse/clone/export/create, networks create/connect, image pull/tag/push/prune, container create | high | M | Dockhand parity |
| 11 | Remote container actions routed over mesh + node selector everywhere | high | M | Audit gap |
| 12 | Registry manager with credentials + push after build + digest pull | high | M | Multi-node swarm blocker |
| 13 | Metrics history (host + container time series) + threshold alerts | high | M | Dokploy apps/monitoring |
| 14 | Compose stack management (adopt foreign stacks, edit, up/down, env, graph) | high | M | Dockhand stacks |
| 15 | Git credentials + GitHub App / GitLab / Gitea providers, private clones | high | M | Both |
| 16 | Real preview deployments per PR with PR comment + TTL teardown | high | M | Dokploy preview-deployments |
| 17 | RBAC with environment/node/project scoped roles, custom roles free-tier | high | M | Dockhand Permissions + Dokploy statements |
| 18 | Rollback from stored deployment plan snapshot (one click, any past deployment) | high | S-M | Dokploy rollbacks, ours has plan-snapshot |
| 19 | CLI: `deployer start/status/deploy/mesh connect` | medium-high | M | Dokploy CLI/API; our README promises |
| 20 | Traefik effective-config viewer/editor + access-log request analytics page | medium | M | Dokploy file editor + requests |
| 21 | Node add/drain/remove wizard + node security audit (ssh/ufw/docker checks) | medium-high | M | Dokploy server-audit.ts |
| 22 | OIDC SSO (+ LDAP) via Better Auth plugins | medium | S-M | Dockhand/Dokploy |
| 23 | Command palette + saved filters/favorites + merged project logs | medium | S | Dockhand UX |
| 24 | Patches (file overlays applied at build) | medium | S | Dokploy patch.ts |
| 25 | Status page + synthetic uptime/cert checks | medium | M | Neither competitor has it |

## 4. Enhancements to existing features

- Terminal: add per-session audit trail, role gate (viewer cannot exec), shell/user auto-detection (Dockhand), reconnect.
- File browser: binary-safe upload/download, chmod editor, CodeMirror editing, volume mode via helper container.
- Image scanning: add grype+trivy side-by-side, scan history per digest, scheduled rescan, severity criteria on deploy/update, SBOM export.
- Deployment: surface stored plan (compiler/plan-snapshot/provenance) in the UI as "what will run"; diff between two deployments.
- Mesh/Network UI: show per-node reachability and edge provider health; mesh DNS in agent.
- Docker events/activity page: add saved filters, date presets, export.
- Setup wizard: add domain/HTTPS step, claim token, join UI (joinAddrs) — Dokploy's install is one curl; ours must be equivalent.
- Settings UI: stored-but-ignored fields must either be wired or hidden (audit cross-cutting #4).

## 5. Leapfrog opportunities (things neither does)

1. Mesh-native multi-node: nodes never expose inbound ports; Dokploy needs SSH inbound, Dockhand needs agent reachable or edge-dialing to a hub. Market it: "add a node by running one command behind NAT" (needs relay-over-session to be real).
2. No control-plane source of truth (roster CRDT) — survivable founder loss (e2e exists). Dockhand's hub and Dokploy's Postgres are single points of failure.
3. Pluggable edge (direct, Cloudflare tunnel, more later) vs Traefik-only for both.
4. Scan-gated deploy AND update, with deploy plan provenance: "this exact plan, this digest, this scan result" stored per deployment; rollback replays it.
5. Free-tier RBAC + audit + SSO + custom roles (both paywall).
6. Unified surface: PaaS (build/deploy/domains/previews) plus Docker ops console (terminal, files, scanning) in one product. Dokploy has thin Docker ops; Dockhand has no PaaS.
7. Typed oRPC/OpenAPI contract-first API with generated CLI and SDK; Dokploy's trpc is internal-first, Dockhand's REST is ad hoc.
8. Template system with semantic validation, compatibility matrix and version migrations (contract already designed) rather than a remote TOML catalog.
9. Mesh DNS (`deployer.internal`) and per-service private networking over WireGuard; neither has it.
10. Passkeys + device-code CLI login as first-class (Dockhand MFA is enterprise, Dokploy 2FA only).

## 6. Caveats

- Our column leans on the 2026-10-25 audit and file listings; per audit, little was run. Contract existence does not equal working implementation (template, notification, backups are examples).
- Dokploy template catalog lives remotely (templates.dokploy.com); the checkout has no local blueprint folder, so catalog size was not counted.
- I did not read every Dokploy router body; matrix rows come from router procedure names, schemas and util directories.
