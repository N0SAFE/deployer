# Benchmark: Coolify (v4.1.2 / nightly 4.2.0) vs Deployer v3 (rewrite-v3)

Method: Coolify read from source at `/home/sebille/Bureau/projects/tests/deployer/coolify` (paths below are relative to it). Ours taken from `v3/docs/audit-2026-10-25/README.md` (scorecard) plus spot greps (no backup / cron / SMTP-Slack delivery / template code exists in apps/ or packages/). Nothing run. "Ours" legend: REAL / PARTIAL / STUB (looks done, inert) / MISSING.

Stack note: Coolify = Laravel 11 + Livewire + Alpine, Postgres, Redis/Horizon, Soketi, **agentless SSH** to servers (inbound port 22 on every managed node), optional Sentinel agent (push metrics). Our model is the inverse (WireGuard mesh, no inbound), which is the main strategic divergence.

## 1. Feature matrix

| Feature | Coolify evidence | Ours | Gap / enhancement |
|---|---|---|---|
| Build packs: nixpacks, static, dockerfile, compose, **railpack**, plain docker-image | `app/Enums/BuildPackTypes.php`, `ApplicationDeploymentJob.php` (deploy_nixpacks/railpack/static/dockerfile/compose/dockerimage_buildpack) | PARTIAL: explicit `dockerfile` + prebuilt image only; nixpacks/railpack run a generic image; compose deploys nginx; missing builder => fake "success" | Biggest product gap. Coolify railpack support is deep (config merge, build secrets, apt packages, buildx check). Do real nixpacks+railpack first, then compose. |
| Resource types in one "New resource" flow | `NewResourceTypes.php` (public git, GH app, deploy key, dockerfile, compose, image, service, 8 DBs); `Livewire/Project/New/*` | PARTIAL: project/service CRUD, no type picker for DBs/templates | Copy the single-entry picker (Git / Docker image / Compose / Template / Database). |
| Git sources: GitHub App, deploy key, public, GitLab, Bitbucket, Gitea | `Models/GithubApp.php`, `GitlabApp.php`, `PrivateKey.php`, `Livewire/Source/Github`, `Http/Controllers/Webhook/{Github,Gitlab,Bitbucket,Gitea}.php` | STUB: public GitHub only; no private clone creds; GitLab stub | Need GitHub App manifest flow + installation tokens, deploy keys, GitLab/Gitea. Coolify GH-App wizard + repo/branch picker (`/github-apps/{id}/repositories/.../branches`) is the pattern. |
| Webhooks (auto-deploy on push) | Per-provider manual webhook secrets (`manual_webhook_secret_*`, encrypted by migration 2026_04_19), `hash_equals`, `auditLogWebhookFailure`, `shouldSkipDeployAny` ([skip ci] style in title/commit), watch_paths filter | STUB: secret never written, always 401, push ignored | Fix, then add skip-keyword + watch_paths + fork-PR guard (`isForkPullRequest`). Coolify does this reasonably; we can be stricter (raw-body HMAC, durable dedupe). |
| Preview deployments (PR/MR) | `Models/ApplicationPreview.php`, `Jobs/ProcessGithubPullRequestWebhook.php`, `ApplicationPullRequestUpdateJob.php` (PR comment with URL), `CleanupPreviewDeployment`, `CleanupOrphanedPreviewContainersJob` (daily), settings `is_pr_deployments_public_enabled`, preview-suffixed volumes, separate preview env vars | STUB: DNS+route to existing container | Build real per-PR deployments, PR comment with link, teardown on close, orphan GC, preview-only env scope. Public-PR toggle (fork safety) is worth copying. |
| Deploy-by-API/webhook URL with token | `routes/api.php` `/deploy?uuid=|tag=&force=` (`api.ability:deploy`), `/deployments`, `/deployments/{uuid}/cancel` | MISSING (API keys broken; no deploy hook) | Cheap high-value: generic deploy hook + tag-based deploy. |
| Deployment pipeline quality | Queue per server with `concurrent_builds`, `deployment_queue_limit`, cancel, force rebuild, `should_skip_build` (image already exists), build server, log streaming, `configuration_snapshot` column (2026_05_11), pre/post-deploy commands (host or container) | PARTIAL: queue in-memory, build logs not captured, cancel is DB flip | Durable queue + captured logs + real cancel are table stakes. Snapshot-of-config-per-deployment is the same idea as our "execution plan stored and replayable" (we should do it). |
| Rolling update + healthcheck gate | `rolling_update()`, `health_check()`, `generate_healthcheck_commands()`; fields `health_check_{path,port,method,scheme,host,interval,timeout,retries,start_period,return_code,response_text,type(cmd)}` | PARTIAL: health gate real, but service health config ignored at deploy | Wire our stored health config to the gate. **Coolify weakness: swarm health check is `// Implement healthcheck for swarm` (empty), line ~1959.** Ours is swarm-first and can win here. |
| Rollback | `Livewire/Project/Application/Rollback.php` (retains N images, `docker_images_to_keep`, per-server retention disable, rollback to image tag) | PARTIAL (monolith only; UI omits target id) | Same model works: keep N images, one-click rollback list. Add digest pinning for swarm. |
| Docker registry push | `push_to_docker_registry()`, `docker_registry_image_tag` on previews | MISSING (multi-node swarm cannot pull) | Needed for us more than Coolify (we are multi-node by design). |
| Domains / proxy | Traefik (default), Caddy, NGINX(enum), NONE; `Server/Proxy/*` incl. dynamic config file editor, www<->non-www `redirect`, force-https, gzip, strip-prefix, custom labels, `custom_docker_run_options`, wildcard domain per server, basic auth per app (`http_basic_auth_*`), Traefik version check job | PARTIAL: Traefik-in-swarm with lanes/doors REAL; domain verification not enforced; no per-service basic auth/redirect UI | Copy: www redirect, basic auth, gzip/strip-prefix toggles, dynamic-config editor, outdated-proxy notice. Our lanes model is richer than anything Coolify has. |
| SSL | Let's Encrypt via Traefik/Caddy; per-resource `SslCertificate` model + **internal CA** for DB/service TLS (`Livewire/Server/CaCertificate`, `RegenerateSslCertJob` twice daily); `SslExpirationNotification` | PARTIAL: ACME + redirect real, cert UI missing, default email `admin@example.com` | Copy the cert expiry notification and DB TLS via internal CA. DNS-01 wildcard is where we can beat it (Coolify relies on server wildcard + HTTP-01 mostly). |
| Cloudflare tunnels | `Actions/Server/ConfigureCloudflared.php`, `Livewire/Server/CloudflareTunnel.php`, per-server `is_cloudflare_tunnel`, ssh_domain | REAL as edge provider (unverified vs real CF) | Coolify tunnels only the **SSH/management path** of one server; ours is a full ingress edge with replicated connector. Verify against real Cloudflare. |
| Databases: postgres, mysql, mariadb, mongodb, redis, keydb, dragonfly, clickhouse | `Models/Standalone*.php`, `Actions/Database/Start*.php`, `Livewire/Project/Database/*` (public port + timeout, init scripts, import dump, health, restart tracking, custom image) | MISSING | Highest-demand primitive after builders. Reuse our swarm runner with volumes + secrets. |
| Scheduled DB backups + S3 | `Jobs/DatabaseBackupJob.php` (pg/mysql/mariadb/mongo dumps, `dump_all`, per-db selection, timeout, `upload_to_s3`), `S3Storage`, `ScheduledDatabaseBackup` (retention by amount/days/max-storage, local and S3 separately, `disable_local_backup`), executions list, BackupSuccess/Failed/S3Warning notifications, restore/import form | MISSING (also no platform self-backup) | Build backup engine once, use for tenant DBs and our own Postgres/roster. Coolify gaps: no restore verification, no PITR/WAL, no encryption at rest, mongodb/pg only partial coverage of redis/clickhouse. Beat with encrypted+verified restores. |
| Cron / scheduled tasks | `Models/ScheduledTask.php`, `Jobs/ScheduledJobManager.php` (every minute, cron + timezone via `CronExpression`), `ScheduledTaskJob.php` (exec in container, timeout 300s, executions + output), TaskSuccess/Failed notifications, API CRUD | MISSING | Medium effort (swarm one-shot jobs or exec). Better: run as ephemeral swarm job on any node, with logs. |
| Env vars | `EnvironmentVariable` flags: `is_buildtime`, `is_runtime`, `is_literal`, `is_multiline`, `is_shown_once`, `is_preview`, `is_shared`, `comment`; bulk edit, .env paste, `is_env_sorting_enabled`, generated `SERVICE_*` magic vars; build secrets (`use_build_secrets` via BuildKit), `inject_build_args_to_dockerfile`; encrypted at rest | PARTIAL: merge project>service>user real; **plaintext**; no build/runtime split | Add build vs runtime flag, shown-once secrets, preview scope, comments, encrypted store. |
| Shared variables | `Livewire/SharedVariables/{Team,Project,Environment,Server}`, referenced as `{{team.X}}`, `{{project.X}}`, `{{environment.X}}` | PARTIAL (project/service/environment merge) | They have 4 scope levels incl. server; we have the merge but no reference syntax or UI. |
| Servers | `Models/Server.php`, `ServerSetting` (concurrent_builds, build server, jump server, sentinel, wildcard domain, cleanup freq/threshold, timezone, disk alert threshold, connection timeout), ValidateAndInstallServerJob, InstallDocker (apt/dnf/arch), Hetzner create (`HetznerController`, cloud-init scripts), server patch check/update (`ServerPatchCheckJob`, apt/dnf/zypper), server delete | REAL for swarm found/join + mesh admission; node add/drain wizard MISSING | Copy: validate-and-install wizard (OS detect, docker install, prereq check), cloud-init scripts, patch check. Ours should replace SSH with "run this one-liner / token" mesh join. |
| Multi-server + build servers | Deploy to additional destinations (`deploy_to_additional_destinations`, not in swarm), `is_build_server`, `use_build_server` per app, `concurrent_builds` | PARTIAL: multi-node swarm; remote builders MISSING | Build-server model is a good primitive; ours could do builder-on-any-mesh-node + registry push. |
| Swarm | `SwarmDocker`, `Server/Swarm.php`, replicas, placement constraints, worker-only; Coolify shows "experimental"; `PushServerUpdateJob.php:165 // TODO: Swarm is not supported yet`; no healthcheck, no additional destinations, network creation TODO | REAL swarm bring-up; runner opt-in but not selectable | **Leapfrog zone**: Coolify's swarm is second-class. Make swarm the default runner with stable service names, rolling update, health gate. |
| Teams / RBAC | `Team`, `Role` (member/admin/owner), invitations by link/email (`Team/InviteLink`), TeamPolicy... but **`ApplicationPolicy`, `ApiTokenPolicy` etc. have "Authorization temporarily disabled" blocks returning `true`; `ProjectPolicy::view` returns true** | PARTIAL: platform roles + project roles; **authz mostly absent** | Coolify's per-resource RBAC is effectively team-wide. Our fix (policy layer: platform x project x resource) would be *better than Coolify* once done. |
| API tokens | Sanctum `PersonalAccessToken` with abilities `read / write / deploy / root`, expiry + `ApiTokenExpirationWarningJob`, IP allow-list (`allowed_ips`), per-instance enable switch | STUB (header mismatch, not forwarded) | Copy abilities + expiry warning + IP allow-list. |
| OAuth / SSO | `OauthSetting` + Socialite: azure, authentik, bitbucket, clerk, discord, github, gitlab, google, infomaniak, zitadel (confirmed in migrations/seeders, 10 providers); registration toggle; 2FA via Fortify; passkeys NO | PARTIAL: Better Auth w/ passkeys REAL; social/OIDC config UI MISSING; 2FA broken | Better Auth genericOAuth covers all of it. We have passkeys (Coolify does not). |
| Notifications | 6 channels: email (SMTP + Resend), Discord, Slack, Telegram, Pushover, generic Webhook (`Notifications/Channels/*`, `Livewire/Notifications/*`); 14 per-channel toggles: deployment success/failure, status change, backup success/failure, scheduled task success/failure, docker cleanup success/failure, server disk usage, reachable/unreachable, patch, traefik outdated; also SSL expiry, API token expiry, restart-limit-reached, container restarted/stopped | STUB: nothing delivers | Copy the event taxonomy and per-channel toggle matrix verbatim; ship webhook + email + Slack/Discord first. Ours also has web push (needs SW). |
| Logs / terminal | Live container logs (`Shared/GetLogs`, `Logs`), deployment logs with hidden/debug lines, in-browser terminal via realtime server (`docker/coolify-realtime/terminal-server.js`), `ExecuteContainerCommand`, host terminal toggle (`is_terminal_enabled`), proxy logs, sentinel logs | REAL docker logs/exec/files; service logs tab fake; build logs not captured | We are ahead on Docker-engine UI (cross-node file browser, exec). Fix deployment/build logs. Add terminal audit trail (Coolify has none). |
| Metrics | Sentinel agent (Go binary, pushes to `/api/v1/sentinel/push`), per-server and per-container charts (`Server/Charts`, `Shared/Metrics`), retention days setting | REAL node/container metric streams, no history | Add time-series storage; copy "metrics history days" setting. Mesh-agent can be our sentinel without inbound ports (push over mesh). |
| Log drains | Axiom, New Relic, Highlight, custom Fluent Bit config (`Actions/Server/StartLogDrain.php`) | MISSING | Low priority; do generic OTLP/syslog/Loki later. |
| Resource limits | cpus, cpuset, cpu shares, memory, swap, swappiness, reservation (`Shared/ResourceLimits.php`), GPU options, stop grace period, `max_restart_count` | STUB (stored, ignored) | Wire to swarm `resources.limits/reservations`; add restart-policy + max-restarts alert. |
| Healthchecks / monitoring | Container status aggregation (`ContainerStatusAggregator`), `ServerCheckJob`, `ServerConnectionCheckJob`, restart-limit notification | PARTIAL probes; per-service monitor MISSING | Active per-service probes + status page is a leapfrog (Coolify has no status page, no synthetic uptime). |
| Auto-update / self-upgrade | `CheckForUpdatesJob`, `UpdateCoolifyJob`, `Actions/Server/UpdateCoolify.php`, release channels (`next_channel`), auto_update_frequency, version pinning via `versions.json`, helper image check | MISSING | Needed for an installable product. Coolify has **no rollback of self-upgrade** (grep `UpdateCoolifyJob.php` finds none). Beat with swarm rolling update of the platform + automatic rollback. |
| Cleanup jobs | `DockerCleanupJob`, `Actions/Server/CleanupDocker.php` (threshold-based, image prune excluding app repos, builder prune, optional volume/network prune), `CleanupInstanceStuffsJob`, `cleanup:database`, orphan preview GC, executions history (`DockerCleanupExecution`) | MISSING | Port the threshold-driven model + execution history; swarm-aware. |
| Compose support | Raw compose, domain-per-service mapping (`docker_compose_domains`), magic `SERVICE_FQDN_*`/`SERVICE_PASSWORD_*` vars (2084 occurrences in templates), compose editor, volume rewriting for secrets | STUB | Compose realizer for swarm stacks (`docker stack deploy`) is a differentiator if done honestly. |
| Templates / one-click services | 361 YAML files in `templates/compose/*.yaml`; `service-templates*.json` index (333 entries with slogan/tags/logo/port); fetched from CDN by `PullTemplatesFromCDN` | MISSING (contract mounted, 16 procs, no impl) | Importing/adapting Coolify's compose format (license: Apache-2.0, verify) gives instant catalog. Use the `SERVICE_*` magic-variable spec for compatibility. |
| Public REST API | `routes/api.php` ~110 routes + `openapi.json/yaml` (8.8k lines), tokens abilities; resources: applications, databases, services, servers, projects/envs, deployments, security keys, cloud tokens, github-apps, hetzner, teams, scheduled-tasks | PARTIAL: typed ORPC (strong), API-key auth broken | We can ship OpenAPI **generated** from ORPC contracts for free. Coolify's openapi is hand-annotated (`OpenApi.php`). |
| MCP / AI | `app/Mcp/*` (read-only tools: list/get apps, DBs, servers, services, infra overview), `routes/ai.php`, `is_mcp_server_enabled` | MISSING | Read-only MCP over our contracts is cheap once API keys work. Coolify has no write tools yet. |
| CLI | Separate repo (coolify-cli, not in checkout) | MISSING (planned) | Pick CLI vs setup app (operator decision). Make `deployer mesh connect` the hero. |
| Audit log | `auditLogWebhookFailure` + Spatie-style logs only for webhook failures | MISSING | Neither has a real one; ours could ship first (actor, resource, diff). |
| Multi-tenant / billing | Stripe subscription, server limits per team (`Team::serverLimit`, `Subscription*`) for Coolify Cloud | n/a | Operator decision (single vs multi-tenant). Skip. |
| UX | `GlobalSearch` (Cmd-K), `Boarding` wizard, `Tags`, project clone/move (`Shared/ResourceOperations.php`: clone to other server/env with volume cloning, move to env), `ActivityMonitor` live log slide-in, `DeploymentsIndicator` global, `ConfigurationChecker` ("restart needed" badge), two-step confirmation dialogs for danger actions, resource "Danger" tab, `Livewire/Project/Shared/UploadConfig` (import/export config) | Dashboard with real states; no global search; viewers see destructive buttons | See section 4. |

## 2. Top 25 features to build, ranked by value / effort

(Value = what a self-hoster notices; effort S/M/L. Ordering respects dependencies, i.e. P0 security from our audit stays first.)

| # | Build | Value | Effort | Why / notes |
|---|---|---|---|---|
| 1 | Honest deploy pipeline (no nginx fallback, captured build logs, durable queue, real cancel) | Very high | M | Parity precondition; Coolify queue/logs are the benchmark. |
| 2 | Real nixpacks + railpack builders (+ static, dockerfile) | Very high | M | Core Coolify draw; all code exists in ours as stubs. |
| 3 | Notification delivery: webhook, email (SMTP), Slack, Discord, Telegram + Coolify's 14-event toggle matrix | High | S-M | Pure plumbing on existing event bus; webhook first. |
| 4 | Working GitHub webhooks + secrets + skip-ci + watch_paths | Very high | S | Fix of an advertised feature. |
| 5 | GitHub App (private repos, installation tokens, repo/branch picker) + deploy keys | Very high | M | Private repos are unusable today. |
| 6 | Generic deploy hook URL + API tokens with `read/write/deploy` abilities and expiry | High | S | `/deploy?uuid&force` is the CI integration people use. |
| 7 | One-click databases (pg, mysql, mariadb, mongo, redis, valkey/keydb, clickhouse) with volume + secret + public-port toggle | Very high | M | Swarm service + volume placement constraint. |
| 8 | Scheduled backups to S3 (retention by count/days/size, executions, restore, notifications) | Very high | M-L | Also covers our own Postgres; do verified restore. |
| 9 | Templates catalog importing Coolify compose YAML with `SERVICE_*` magic vars (start with top 50) | Very high | M | 361 templates ready to adapt; license check. |
| 10 | PR/MR preview deployments (build per PR, comment, teardown, orphan GC) | High | M | Needs #2 and #4. |
| 11 | Env var model: build vs runtime, secret/shown-once, encrypted, per-preview, comments, .env paste, bulk | High | M | Fixes our plaintext finding. |
| 12 | Cron / scheduled tasks as ephemeral swarm jobs, with executions + notifications | High | M | Coolify's is container-exec only. |
| 13 | Resource limits + restart policy + max restart alert wired to swarm | Med-high | S | Fields already stored. |
| 14 | Rollback with N retained images + registry push/digest pin | High | M | Required for multi-node swarm anyway. |
| 15 | Docker cleanup policy (threshold, execution history, preview/orphan GC, builder cache) | High | S-M | Disks fill on every self-hosted box. |
| 16 | Platform self-upgrade with automatic rollback and release channels | High | M | Coolify lacks rollback; ties to installer (#17). |
| 17 | Production installer / CLI (`deployer start`, mesh join one-liner) | Very high | M | Currently `deploy.sh` belongs to another project. |
| 18 | Authz policy layer + project-role-aware UI | Very high | M | Beats Coolify (whose policies are disabled). |
| 19 | Per-service health monitoring + status page + SSL expiry alerts | High | M | Leapfrog; Coolify has none. |
| 20 | Compose realizer (`docker stack deploy`, domain-per-service mapping) | High | L | Needed for #9 templates with multi-container apps. |
| 21 | Domain features: www redirect, basic auth, gzip, strip-prefix, per-domain TLS, DNS-01 wildcard | Med-high | M | Small toggles on Traefik labels. |
| 22 | Global search (Cmd-K), clone/move resource, activity slide-in | Medium | S-M | Cheap UX wins from Coolify. |
| 23 | Time-series metrics history from mesh agent (no inbound, push over mesh) | Medium | M | Coolify Sentinel equivalent, nicer transport. |
| 24 | Server onboarding wizard: validate OS/docker, cloud-init, Hetzner/DO provisioning, patch check, drain/remove | Medium | M-L | Replace Coolify's SSH with mesh token. |
| 25 | OIDC/social login config UI (Better Auth generic OAuth) + 2FA fix + read-only MCP server | Medium | S-M | Parity checkbox; MCP is a cheap differentiator. |

## 3. Enhancements to existing features (we have it, make it better)

- Network / edge: add custom domains on tunnel edge, DNS-01 wildcard, verified-only routing, cert expiry UI (Coolify has none of the lane concept; widen the gap).
- Docker engine UI: add terminal session audit trail and role gates (Coolify terminal requires `is_terminal_enabled` flag only).
- Setup wizard: add the domain/HTTPS step and claim token (Coolify boarding does server+project only, but its first-user-is-root registration race is a known risk).
- Deploy analytics: surface per-deployment config snapshot and diff (Coolify only stores the snapshot).
- Mesh agent: promote to sentinel, node status from real heartbeats, node drain/remove.
- ORPC contracts: publish generated OpenAPI + typed SDK; Coolify OpenAPI is hand-written and drifts.
- Passkeys: fix `rpID`; keep as differentiator (Coolify has none).
- Health gate: honour service health fields and implement swarm health (Coolify's swarm branch is empty).

## 4. UX patterns worth copying

1. "New resource" picker: one screen, grouped Git / Docker / Databases / Services.
2. Configuration sidebar per resource: General, Advanced, Environment, Persistent Storage, Healthchecks, Resource Limits, Webhooks, Preview, Rollback, Scheduled Tasks, Danger. Each saves instantly with inline helper text.
3. "Configuration changed, redeploy required" badge (`ConfigurationChecker`).
4. Live deployment slide-in (`ActivityMonitor`) and global deployments indicator.
5. Cmd-K global search across projects, servers, resources.
6. Danger tab with typed confirmation; two-step confirmation instance setting.
7. Clone/move resource across env or server with volume cloning option.
8. Notification settings as a channel-by-event toggle grid with "test" button.
9. Server validate-and-install progress (OS, docker, prereqs) with a retryable log.
10. Backup UI: schedule, retention in three dimensions, executions with size/status, "backup now".
11. Config upload/export (`UploadConfig`) and shared variables hierarchy view.

## 5. Coolify known weak spots we can beat

- **Authorization disabled in policies** (`app/Policies/ApplicationPolicy.php`, `ApiTokenPolicy.php`: "Authorization temporarily disabled"; `ProjectPolicy::view` returns true). RBAC is team-wide, no per-project roles.
- **Swarm is second-class**: no health check (`ApplicationDeploymentJob.php` ~1959), no additional destinations ("not supported in swarm mode"), network creation TODO (~788), `PushServerUpdateJob.php:165 // TODO: Swarm is not supported yet`.
- **Inbound SSH to every server** (agentless SSH model; `ServerConnectionCheckJob`, `ValidateServer`), ssh multiplexing cleanup jobs (`CleanupStaleMultiplexedConnections`, `ServerCleanupMux`) show operational cost. No NAT/CGNAT support; Cloudflare tunnel only protects SSH.
- **Single control plane**: one Laravel/Postgres/Redis instance is the source of truth; if it dies, management dies (workloads survive). Matches our "mesh first, no source of truth" principle.
- **No self-upgrade rollback**, no status page, no synthetic uptime, no audit log, no restore verification, no PITR.
- **Heavy hand-rolled SSH shell construction** in 4.9k-line `ApplicationDeploymentJob.php` (escaping fixes appear throughout the migrations/changelog: e.g. `sanitizeHealthCheckValue`), a recurring injection surface.
- **Nixpacks to railpack churn** in progress (both exist, `deploy_railpack_buildpack` newest); Coolify docs lag. Opportunity to pick one default (railpack) cleanly.
- Observability limited to Sentinel optional agent; no history unless Sentinel enabled.
- Single-tenant UX leaks of Coolify Cloud code (Stripe actions, subscription pages) inside the OSS tree.

## 6. Where we can leapfrog (strategic)

1. **Mesh-first, zero inbound ports**: add a node = run one command; no SSH keys, no port 22, works behind NAT once relay lands (relay-over-session is currently a stub, so finish it before marketing this). Coolify cannot match this without re-architecting.
2. **Pluggable edge providers**: direct, Cloudflare Tunnel today; add frp/WireGuard-VPS, Tailscale Funnel, Caddy. Coolify has fixed proxy choice per server (Traefik/Caddy) and no tunnel ingress.
3. **No source of truth**: replicated signed roster; control plane loss tolerable. Coolify is a single Postgres.
4. **Lanes (local/private/public)** with mesh-private routes: internal apps without public exposure; Coolify has one public lane.
5. **Swarm-native everything**: rolling updates, replicas, placement labels, cross-node volumes policy, global Traefik with HTTP provider and no docker socket.
6. **Typed contract-first API + generated OpenAPI/SDK/MCP** from one ORPC source.
7. **Passkeys + device-code CLI login** on Better Auth.
8. **Honesty**: ship a platform health/self-check page and fail loudly (Coolify silently skips swarm paths).

## 7. Suggested sequencing

- Phase 0 (blockers from our audit): authz, secrets, honest deploys.
- Phase 1 (credibility, ~6-8 weeks): #1, #2, #4, #5, #6, #3, #11.
- Phase 2 (stickiness): #7, #8, #12, #15, #9, #10.
- Phase 3 (differentiate): #17, #16, #19, #23, #24, mesh relay + more edge providers.

Caveats: Coolify's CLI (separate repo), Sentinel (Go binary) and Coolify Cloud billing are not in this checkout; SSO provider list was inferred from `OauthSetting::couldBeEnabled` and `get_socialite_provider` (azure/authentik/clerk named explicitly, others via default branch); template count of 361 is the YAML file count in `templates/compose`; "ours" status relies on the 2026-10-25 audit and only spot-grepped code, not runtime.
