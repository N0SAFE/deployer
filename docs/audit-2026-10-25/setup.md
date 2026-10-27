# Audit: SETUP / BOOTSTRAP / FIRST-RUN

Scope: `apps/setup`, API-side `/setup/*` (both `apps/api` monolith and `apps/api-services` BFF+shared), admin bootstrap, readiness, wizard UI (`packages/ui/base/src/components/setup`), `apps/web/src/app/{setup,device}`, setup contracts, compose/infra, deploy.sh, docs.
Method: source read file by file. Runtime behaviour was NOT executed (I ran `apps/setup` `test:unit`; it exceeded my 170 s budget and was killed, so no pass/fail verdict). All paths below are relative to `/home/sebille/Bureau/projects/tests/deployer/v3`.

Important context discovered: the working tree is mid-restructure. `git status` shows ~794 deletions under `apps/api/{bff,shared,services}` (moved, uncommitted, to `apps/api-services/{bff,shared,services}`), while `apps/api/src` is the "retiring monolith". There are therefore TWO live implementations of the API-side setup surface (`apps/api/src/core/modules/setup/**` and `apps/api-services/shared/src/core/modules/setup/**`, files differ), and `apps/setup` can hand over to either (monolith image vs. BFF+5-service tier). The canonical plan (`docs/architecture/09-implementation-plan.md:56-66`) says to DELETE `apps/setup` and replace it with a CLI-driven configurator (`deployer start`), none of which is started (`:149-152` unchecked, no CLI binary exists). So the thing being audited is simultaneously the only working onboarding path and a component scheduled for removal.

---

## 1. Feature inventory

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Setup app boot (Nest + SSR wizard, one-way exit 0) | REAL | `apps/setup/src/main.ts:28-55`, `app.config.ts:62-99`, `modules/handover/services/setup-exit.service.ts:69-99` |
| 2 | Gate (`/setup/health` 200 from `launching` on, 503 on `failed`) | REAL | `modules/health/setup-phase.service.ts:158-168`, `setup-readiness.indicator.ts:30-59`, `setup-health.controller.ts:35-50` |
| 3 | Phase state machine (RxJS BehaviorSubject + edge Subject) | REAL, with a sticky-failure bug (see 3.4) | `setup-phase.service.ts:106-116` |
| 4 | Wizard SSR page `GET /` | REAL (always `needsSetup:true`, even if configured) | `modules/wizard/wizard-page.controller.ts:37-41` |
| 5 | Wizard UI (mode, cluster, db, account, progress, continue) | REAL | `packages/ui/base/src/components/setup/setup-wizard.tsx`, `steps/*` |
| 6 | Pre-gate state answered locally from `node_config` | REAL (but route-collision risk, 3.3) | `wizard-state.service.ts:63-90`, `wizard.controller.ts:74-82` |
| 7 | Probes (db/mesh/remoteAuth) forwarded to API | REAL | `wizard.controller.ts:86-111`, `apps/api/src/modules/setup/controllers/setup.controller.ts:61-277` |
| 8 | Trigger: persist choices -> open gate -> (prod) found swarm | REAL | `setup-gate.service.ts:168-238`, `wizard.controller.ts:149-160` |
| 9 | Persist wizard choices to shared SQLite `node_config` | PARTIAL: omits swarm participation (policy/advertiseAddr), hard-codes `strategy:"local"` | `setup-gate.service.ts:316-353` |
| 10 | In-memory retention of trigger payload (password not persisted) | REAL (lost on setup crash; documented) | `setup-gate.service.ts:74-79, 190` |
| 11 | Bootstrap Traefik (plain container, loopback-only :80, file+docker providers) | REAL | `modules/ingress/services/bootstrap-ingress.service.ts:145-226, 676-718` |
| 12 | Mesh agent start + mesh founding before swarm | REAL (found path only) | `modules/cluster/services/mesh-agent-launcher.service.ts:44-79`, `swarm-bootstrap.service.ts:52-63` |
| 13 | Swarm found (mesh/interface address, DataPathAddr) | REAL | `swarm-bootstrap.service.ts:121-136, 177-212` |
| 14 | Swarm JOIN from setup | PARTIAL / effectively dead from UI: needs `swarm.joinToken` + `swarm.joinAddrs` in payload; remote schema has no `joinAddrs`, founding schema has them but mode is `create` | `setup-gate.service.ts:277-297`, `packages/contracts/entities/src/entities/swarm/swarm-config.schema.ts` (join selection = `policy`+`joinToken` only) |
| 15 | API scheduling as swarm service (monolith) | REAL | `modules/handover/services/api-service-provisioner.service.ts:171-374` |
| 16 | Microservices-tier scheduling (BFF + 5 svc) | REAL code, but conflicts with BFF provisioning inside API flow (3.8) | `services-tier-provisioner.service.ts:36-140`; `apps/api-services/shared/.../local-initialization.service.ts` `provision_api` step |
| 17 | Handover pipeline (retarget api route -> trigger -> wait ready -> release :80 -> prove ingress -> wait web -> setup=done page -> `ready`) | REAL | `handover-orchestrator.service.ts:212-410` |
| 18 | Trigger delivery with retry (4xx not retried) | REAL | `handover-orchestrator.service.ts:589-641` |
| 19 | Readiness watcher incl. tier roll-up `/health/platform/ready` | REAL | `api-readiness-watcher.service.ts:112-148` |
| 20 | Ingress file writers (`dynamic-{api,setup,web}.yml`, atomic) | REAL, HTTP/`deployer.localhost` only | `ingress-handover.service.ts:106-110, 180-195, 300-315, 378-386` |
| 21 | Orchestration SSE stream (setup steps + forwarded API frames, replay, heartbeat, terminal replay) | REAL | `modules/wizard/wizard-stream.service.ts`, `modules/progress/services/orchestration-stream.service.ts` |
| 22 | Failure + retry (`retryHandover`) | PARTIAL: only re-runs the handover; does not re-run cluster bootstrap (3.4) | `wizard.controller.ts:295-307` |
| 23 | Auth proxy `/api/auth/*` on setup host | REAL | `middleware/setup-auth-proxy.ts:44-109` |
| 24 | API `/setup/*` executor (local flow: swarm, db, migrate, seed admin, register node, finalize) | REAL | `apps/api/src/core/modules/setup/services/local-initialization.service.ts:136-416` |
| 25 | API remote-join flow (grant, admission, version check, swarm join) | REAL (not exercised here) | `.../remote-initialization.service.ts:40-250` |
| 26 | Post-setup destination | REAL | `apps/api/src/modules/setup/services/post-setup-destination.service.ts:60-77` |
| 27 | Post-setup verification (server ingress probe + browser probe, Continue gated) | REAL | `post-setup-verification.service.ts:84-173`, `packages/ui/.../use-platform-verification.ts` |
| 28 | Post-setup hints list | STUB: constant list, ignores dismissed flags | `setup.controller.ts:316-323` |
| 29 | Hint dismiss | PARTIAL: persists to `node_config.postSetupFlags`, never read back; unauthenticated | `setup.controller.ts:328-364` |
| 30 | `/setup/done` page | REAL in BFF only; MISSING in monolith `apps/api` | `apps/api-services/bff/src/modules/console/controllers/setup-done.controller.ts:35`; grep finds none in `apps/api/src` |
| 31 | Restart path (`setup_done` -> open gate w/o wizard) | REAL | `setup-gate.service.ts:119-143`; API side `bootstrap-orchestrator.service.ts:102-238` |
| 32 | Default admin bootstrap on restart | REAL but DANGEROUS default (3.1) | `admin-bootstrap-policy.ts:101-104`, `default-admin.bootstrap.ts:47-51`, `bootstrap-orchestrator.service.ts:335-363` |
| 33 | `core/readiness/readiness.port.ts` (apps/api) | REAL (token bound in HealthModule, used by `main.ts`) but docstring stale | `apps/api/src/main.ts:12,124`, `modules/health/health.module.ts:49` |
| 34 | `apps/web/src/app/setup/page.tsx` (second wizard host) | REAL, duplicate surface; contradicts setup app comment "web no longer renders /setup" | `apps/web/src/app/setup/page.tsx:12-33` vs `apps/setup/src/views/pages/setup.tsx:20-27` |
| 35 | `apps/web/src/app/device` (device-code approval) | PARTIAL: UI + Better Auth plugin real, no CLI client exists; agent-capability path `/device/capabilities` has no route | `apps/web/src/app/device/page.tsx`, `packages/auth/src/server/plugins/securityPlugins.ts:121-149`, `agentAuth.ts:88` |
| 36 | `deploy.sh` | MISSING for this product: it is for a different project ("The Gossip Club", nginx, certbot, `the-gossip-club.sebille.net`) | `deploy.sh:1-4, 248-290, 331-353, 504, 558-559` |
| 37 | Production compose (`prod` profile) | PARTIAL: only builds the monolith image; no BFF tier, no registry push, no `.env` validation | `infra/docker/compose/docker-compose.prod.yml:35-62`, `common/setup/docker-compose.config.prod.yml` |
| 38 | `infra/docker/compose/deployer/docker-compose.deployer.yml` | STALE: references removed Phase-0 sub-app and "tgclub" names; used by nothing real | file header, `deploy.sh:504` |
| 39 | CLI onboarding (`deployer start/status/join`) | MISSING (planned, unchecked) | `docs/architecture/09-implementation-plan.md:149-157`; only nest-commander dev commands in `apps/api-services/bff/src/cli/commands/` |
| 40 | Docs | STALE: `docs/setup-*.md`, `startup-flow-explained.md` carry SUPERSEDED banners; `INITIALIZATION_PLAN.md` describes the deleted pre-setup API and has no banner | `docs/INITIALIZATION_PLAN.md:1-30` |
| 41 | Q&A records per root AGENTS.md protocol | MISSING for setup | `docs/qa/` has no `setup/` |

---

## 2. What works end to end (by code reading)

Dev profile (`SETUP_MODE=dev`, compose-owned API/Traefik/redis/db): operator opens `setup.deployer.localhost` -> wizard -> trigger opens gate immediately (`setup-gate.service.ts:211-230`) -> compose starts the API behind the healthcheck -> setup delivers trigger with retries (`handover-orchestrator.service.ts:589-641`) -> API provisions -> readiness poll -> ingress retarget -> web-route wait -> `setup.<host>` repointed to done page -> `ready` -> setup exits 0 -> Continue button gated on server verification + browser probe. Each step is idempotent and failure keeps setup alive with a retry. Log evidence from the unit run shows the pipeline progressing through those phases.

Prod profile (`SETUP_MODE=prod`) on a single node: setup starts bootstrap Traefik on 127.0.0.1:80, starts mesh agent, founds mesh + swarm, writes `node_config`, schedules `deployer-api` (or the BFF tier) with docker.sock, overlay, config volume and agent socket mounted, waits for readiness, releases :80, proves the swarm Traefik routes, retargets, exits. The design is coherent and heavily commented with the real failure modes it fixes (overlay attach retry, poisoned VXLAN rebuild, port race on promotion).

Restart of a finished node: `setup_done` skips the wizard, opens the gate, re-converges swarm, no trigger delivered (`handover-orchestrator.service.ts:592-599`).

---

## 3. Broken / risky

### 3.1 CRITICAL - default super-admin backdoor on every restart
`resolveAdminBootstrapDecision` returns `always` by default, including in production (`apps/api/src/core/admin-bootstrap/admin-bootstrap-policy.ts:101-104`). On every boot of a `setup_done` node `bootstrapSeededAdmin` calls `ensureDefaultAdmin(databaseUrl)` (`bootstrap-orchestrator.service.ts:335-363`), which falls back to `admin@admin.com` / `adminadmin` when `DEFAULT_ADMIN_EMAIL/PASSWORD` are unset (`default-admin.bootstrap.ts:47-51`) and creates a super-admin if that email is missing. The setup app does NOT forward `DEFAULT_ADMIN_*`/`ADMIN_BOOTSTRAP` into the API task (`api-service-provisioner.service.ts:456-564` forwards neither), so on a prod install the operator's own admin is created in the wizard, and at the first restart a second super-admin with a publicly known password appears. `.env.example:178-179` ships those values; `.env.prod.example:68-69` ships a placeholder password. The log `admin@admin.com present` in a code comment (shared `bootstrap-orchestrator.service.ts:250-260`) shows this already happens in real runs. Same code in `apps/api-services/shared/src/core/admin-bootstrap/`.

### 3.2 CRITICAL - unauthenticated re-initialisation / SSRF surface stays public after setup
The API `/setup/*` controller is `@AllowAnonymous()` for every procedure (`apps/api/src/modules/setup/controllers/setup.controller.ts:27-28`; same in `apps/api-services/bff/src/domains/setup/controllers/setup.controller.ts`). Nothing checks "already configured":
- `triggerInitialize` only guards against a concurrent run (`initialization.service.ts:254-258`). A POST to `api.<host>/setup/trigger` on a finished node re-runs the flow: it generates a new `nodeId` and new `meshSharedSecret` and rewrites `node_config` (`local-initialization.service.ts:343-380`), and with `existingDatabaseUrl` it can repoint `databaseUrl` to an attacker DB (seeding an attacker admin there) or, with the `remote` strategy, join the node to an attacker mesh and persist its `peerServiceToken`/`databaseUrl` (`remote-initialization.service.ts:171-215`). At minimum this is a DoS of mesh identity; plausibly a takeover on next restart.
- `probeDatabase` (`setup.controller.ts:61-92`) opens a pg connection to any URL; `probeMesh` and `remoteAuth` (`:107-277`) make server-side HTTP requests to arbitrary URLs and return the response class -> open SSRF/port-scan primitive on the API's network (including `global-db`, Redis, docker overlay).
- `dismissPostSetupHint` writes to `node_config` anonymously (`:328-364`).
The setup app also reaches these before the API exists with no operator proof of ownership (see 3.5).

### 3.3 HIGH - route collision on `GET /setup/state` inside apps/setup
`SetupHealthController` is `@Controller("setup") @Get("state")` returning the phase snapshot (`modules/health/setup-health.controller.ts:57-62`), while the oRPC `getState` procedure is `.list().path("/state")` (GET) with prefix `/setup` returning a `SetupStateSnapshot` (`packages/contracts/bff/modules/setup/app.contract.ts:133-139`; `list()` = GET per `packages/transport/orpc/src/operations/base/standard-operations.ts:108`). `SetupHealthModule` is registered before `WizardModule` (`app.module.ts:36-44`). Whichever Express route registers first answers; if it is the health controller the wizard's first call gets `{phase, detail,...}` instead of `{needsSetup,...}`. I could not run the app to confirm which wins; neither spec covers it (`app.module.spec.ts` only compiles the graph). Needs a runtime test.

### 3.4 HIGH - sticky `failed` breaks cluster-failure retry
`SetupPhaseService.record()` ignores everything while `failed` (`setup-phase.service.ts:106-116`). Only `retryHandover` calls `reset()` (`wizard.controller.ts:295-307`), and it jumps straight to `launching`, skipping the cluster pipeline. Consequences:
- Swarm/mesh failure -> `phase.fail("Cluster bootstrap failed")` (`cluster-orchestrator.service.ts:121`) -> "Retry the failed step" resets to `launching`, handover tries `createSwarmService` on a non-swarm engine and fails again; cluster is never re-attempted.
- "Start over" + new trigger: `gate.open()` sees `isReady()===false`, persists again, calls `cluster.start` but its `record("clustering"/"launching")` calls are ignored while failed (`setup-gate.service.ts:232-233`, `cluster-orchestrator.service.ts:109-112`), so the gate never opens. Recovery requires restarting the container. Also no spec for `WizardController`/`ClusterOrchestratorService`/`SwarmBootstrapService` (the old `trigger-wizard.spec.ts` is deleted in the working tree).

### 3.5 HIGH - no operator claim / bootstrap token on the pre-auth wizard
The wizard that mints the first super-admin and holds the Docker socket (`common/setup/docker-compose.config.prod.yml`, mounts `/var/run/docker.sock`) has no setup token, PIN, or first-visitor binding. Mitigation is network-only: bootstrap Traefik binds `127.0.0.1` (`bootstrap-ingress.service.ts:73, 693-699`) and the setup container publishes no port. That is sound for a laptop but means a remote VPS operator must SSH-tunnel to port 80 and rely on `*.localhost` browser resolution; no docs or UI tell them so. If an operator later binds publicly (or the swarm ingress takes :80 on 0.0.0.0 before the done page replaces the wizard), the window is unauthenticated.

### 3.6 HIGH - production exposure: HTTP, `deployer.localhost` hardcoded
Hostnames are built only as `<svc>.[<prefix>.]deployer.localhost` (`ingress-handover.service.ts:106-110`, `api-service-provisioner.service.ts:575-583, 598-600`); Traefik has only `--entrypoints.web.address=:80` (`bootstrap-ingress.service.ts:665-673`); no TLS/ACME, no public domain input in the wizard, `NEXT_PUBLIC_*`/`AUTH_BASE_DOMAIN`/`TRUSTED_ORIGINS` are forced to `http://*.deployer.localhost`. Real public domains, HTTPS, cookies and Better Auth trusted origins depend on later post-setup edge/domain features outside this area. `docs/architecture/09` Phase 3 plans to delete this scheme.

### 3.7 HIGH - monolith handover target lacks `/setup/done`
Handover points `setup.<host>` at `${apiBackend}/setup/done` (`ingress-handover.service.ts:300-315`) and the destination fallback also uses it (`wizard.controller.ts:253-257`). Only the BFF has that controller (`api-services/bff/.../setup-done.controller.ts:35`); `apps/api/src` has none. With `DEPLOYER_API_IMAGE` (monolith, which is what `docker-compose.prod.yml` builds) the bookmarked wizard URL lands on a 404 after handover. Also `apps/setup/src/views/layout.tsx:14` links to `/manage/web-app`, a path only served by the web app.

### 3.8 MEDIUM-HIGH - three competing names/paths for "the API" in swarm
Setup creates `deployer-api` (monolith, `api-service-provisioner.service.ts:107-110`) or `svc-bff` + `svc-*` (tier, `:95-98`, `services-tier-provisioner.service.ts`). The API-side `provision_api` step additionally creates `deployer-bff` on port 3005 with a minimal env (`apps/api-services/shared/.../local-initialization.service.ts` ~L386-398, L586-641, `platform-names.ts:57,94-96`), and the ingress backend defaults to the monolith unless `DEPLOYER_INGRESS_BACKEND=bff`, which no compose file sets. In tier mode this yields `svc-bff` AND `deployer-bff` both running, with the ingress pointing at `deployer-api` (not scheduled) unless setup's retarget wins. Image fallback `deployer-svc-bff:dev` / `${COMPOSE_PROJECT_NAME}-bff:latest` is dev-only. `resolveApiBaseUrl` for prod trusts `SETUP_API_URL` verbatim (`api-address.ts:69-106`), so a wrong value in compose silently mis-targets the handover.

### 3.9 MEDIUM - persisted choices incomplete and fabricated defaults
`SetupGateService.persist` omits `swarmConfig`, forces `strategy` to `"local"` even for the remote strategy, and the cluster step uses `swarmInitOptions(mesh, nodeAddress)` ignoring the operator's `advertiseAddr`/`policy` (`setup-gate.service.ts:316-353`, `swarm-bootstrap.service.ts:52-63`). `participation.converge()` therefore runs on defaults until the API later writes the real choice. For a remote-join node in prod, setup first founds its own mesh + swarm (`mesh-agent-launcher.service.ts:59-64`) which the API must later abandon (`setup-gate.service.ts:259-275`); mesh teardown of the throwaway mesh is not shown anywhere I read.

### 3.10 MEDIUM - secrets/defaults
- `AUTH_SECRET` defaults to `"fallback-auth-secret"` in setup's own schema (`apps/setup/src/config/env/env.schema.ts:149`) and is forwarded into the API/web tasks (`api-service-provisioner.service.ts:494-496`); only the prod compose variant enforces `:?` (`common/setup/docker-compose.config.prod.yml`). Other profiles can run with a public-knowledge signing key.
- `.env.example:174` contains what looks like a real base64 secret.
- Admin password and (remote) session token travel in clear HTTP on the overlay from setup to the API (`handover-orchestrator.service.ts:606-610`), and in browser memory in `ProgressStepContext`.
- API task gets `/var/run/docker.sock` rw (`api-service-provisioner.service.ts:321-326`): by design but equals host root for any API RCE.

### 3.11 MEDIUM - correctness details
- `listPostSetupHints` returns both hints regardless of dismissal (`setup.controller.ts:316-323`); contract enum has `domain`/`fleet` hints never emitted.
- `getSetupState` / `notStarted()` reuse step ids that exist in the live schema but the older `entities/setup/state.schema.ts`, `database.schema.ts`, `initialize.schema.ts` define different enums with the same exported names; dead duplicates next to `entities/setup/index.ts` (risk of wrong import).
- Wizard header hardcodes `v1.0.0` (`setup-wizard.tsx:306`).
- `GateService.managedWebEnabled()` reads the retained payload; after a setup crash the dashboard choice is lost and the env default stands (`setup-gate.service.ts:94-101`).
- Handover timeout (300 s) is also the trigger-retry bound and covers cold DB provisioning plus migrations (`handover-orchestrator.service.ts:669-671`); image pulls for a fresh VPS can exceed it, leaving `failed` with a retry that works only for handover-stage failures.
- Docs claim the API serves the wizard (`apps/api/src/modules/setup/setup.module.ts` header says plain `@Get/@Post`, "ORPC lazy-loaded") while code uses `@Implement`; stale comments throughout.
- `apps/api` and `apps/api-services/shared` setup/bootstrap code have diverged (DB URL resolution via `MANAGED_GLOBAL_DB_*` only in shared), so fixes must be applied twice or the monolith removed.

### 3.12 Tests
Present: phase service, readiness indicator, gate (incl. managed-web), wizard-state, handover orchestrator, ingress-handover, readiness watcher, API provisioner, bootstrap ingress, orchestration stream, api-address, swarm-node-address, app graph, API `setup.controller.spec`, post-setup specs, UI progress/verification tests, web `/setup` page test, `admin-bootstrap-policy.spec`. Missing: `WizardController` (trigger, retry, forwards, error mapping), `SwarmBootstrapService`, `ClusterOrchestratorService`, `MeshAgentLauncherService`, `ServicesTierProvisioner`, `setup-auth-proxy`, `WizardStreamService`, route-collision test, security tests for post-setup `/setup/trigger`, e2e of the full prod handover (only dev compose rehearsal).

---

## 4. Required for production (ordered)

1. Close the backdoor: make `ensureDefaultAdmin` never use built-in credentials; default `ADMIN_BOOTSTRAP` to `never` (or `when_empty` and refuse the `admin@admin.com`/`adminadmin` fallback when `NODE_ENV=production`); fail the boot if it would create a known-password admin.
2. Lock `/setup/*` after setup: gate trigger, probes, remoteAuth, hints on "node not configured AND a setup session proof"; return 404/409 once `setupState==="setup_done"`. Remove `AllowAnonymous` from everything except `state`/`node-status`/`done`. Add SSRF allow/deny rules (block private ranges and the platform overlay) for probes.
3. Add an operator claim: a one-time setup token printed in the setup container logs / CLI and required by the wizard (header or first-load cookie) before `trigger` is accepted.
4. Decide the architecture and delete the other: either complete the CLI/configurator plan and delete `apps/setup`, or retire `apps/api`'s monolith setup path and keep `apps/setup` for the BFF tier. Collapse duplicated `core/modules/setup` and `admin-bootstrap` into one tree; remove the `deployer-bff` vs `svc-bff` vs `deployer-api` triple naming; set `DEPLOYER_INGRESS_BACKEND` consistently.
5. Fix the failure state machine: `retry` must re-run the failed stage (cluster or handover), and `gate.open()` must clear `failed` when it is explicitly re-invoked. Add specs for WizardController/cluster/swarm bootstrap.
6. Resolve the `GET /setup/state` collision (rename the health snapshot route, e.g. `/setup/phase`) and add a supertest-level routing spec.
7. Public exposure: a "public domain" step in the wizard (or env), HTTPS entrypoint + ACME in the bootstrap Traefik, derive origins from it instead of `deployer.localhost`; document or build the remote-VPS access path (SSH tunnel vs. claim URL).
8. Make `/setup/done` exist in whichever API is the handover target, and point `setup.<host>` somewhere that always answers.
9. Persist the full wizard payload (swarm policy, advertise address, strategy) before converging; honour `advertiseAddr`; implement or remove the unreachable swarm-join branch in `entryModeFrom`; tear down the throwaway mesh/swarm on the remote path.
10. Rewrite production deployment entry: replace `deploy.sh` (wrong product), add a real installer (Docker check, `.env` generation with real secrets, `docker compose -f prod up`, firewall, backup of the `node_config` volume), publish images to a registry, remove `docker-compose.deployer.yml`.
11. Require `AUTH_SECRET` (no default) in the setup schema; remove the example secret from `.env.example`; stop forwarding secrets through plain HTTP bodies (or use mTLS/overlay encryption).
12. Run a real e2e on a clean VPS (prod profile) for: single node, restart after install, failure injection at each step.

---

## 5. Recommended enhancements

- Make the 300 s handover budget configurable and split it into per-stage budgets, with image pre-pull progress in the stream.
- Surface `docker.sock` privilege and overlay choices explicitly in the wizard summary; allow dry-run/preflight (ports 80/443/2377/7946/4789/51820, kernel WireGuard, docker version) before the cluster step (a preflight exists for the API in `shared/server/preflight`, none for setup).
- Persist enough of the trigger (excluding the password) to resume after a setup crash; the admin password could be handed over by a short-lived sealed token instead of re-entering.
- Real `hasUsers`/`hasAdmin` reporting from setup instead of the hard-coded `true` (`wizard-state.service.ts:74-79`).
- Replace regex-on-error-message handling (`/already (exists|connected|attached)/`, `isPortTakenError`) with structured codes where possible.
- Show the version dynamically in the wizard; fix header "Mesh node".
- One wizard host: remove the duplicate `apps/web/src/app/setup` or mark it intentionally the sole page once the API stops serving onboarding.
- Update or delete `docs/INITIALIZATION_PLAN.md`, `apps/api/src/modules/setup/setup.module.ts` header, `core/readiness/readiness.port.ts` header; add the missing `docs/qa/setup/*` per the root protocol.

---

## 6. Recommended new features

- CLI `deployer start | status | join | doctor` with a one-time configurator URL/token (matches `docs/architecture/02,03,11`).
- Installer script / `curl | sh` for a plain VPS with preflight, secrets generation, and idempotent re-run.
- "Join this node" flow driven by a join code from an existing cluster (single token containing mesh URL + swarm token + admission), replacing the separate remote-auth + join-cluster steps.
- Setup audit log (who ran setup, from which IP, which choices) persisted into the platform DB once available.
- Post-setup health report page (what verification checked, with re-run), plus backup/restore of `node_config` and swarm state.
- Wizard step for DNS/domain/edge provider choice (direct vs Cloudflare Tunnel) so the first public URL is correct on day one.
- Device-code CLI login client that actually consumes `/device` (UI exists with no client) and the missing `/device/capabilities` route.
