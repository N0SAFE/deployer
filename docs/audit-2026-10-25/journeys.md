# Core user journeys — ideal end state and gap-to-ideal (2026-10-26)

Scope: the six journeys a self-hoster must be able to complete for the product to be credible. Paths are relative to `v3/` unless absolute. Status words: **REAL** (works end to end in code), **PARTIAL**, **BROKEN** (exists, fails or lies), **MISSING**. Size: **S** < 1 day, **M** 2–5 days, **L** 1–3 weeks (one engineer).

## 0. Method, live path, and what changed since the audit

Method: read the 2026-10-25 audit set (README, projects-services, deployments, web, observability, parity, networking, docker-cluster, setup, auth, the three benches), then re-read the code on each journey path. Nothing was run. Claims I re-verified are given a `path:line`; claims I took from the audit and did not re-read are tagged `(audit)`.

**Which backend is the live path.** The BFF + five services (`apps/api-services/*`) is the path the web and setup tier talk to. `apps/api` (monolith) cannot compile: `apps/api/src/app.module.ts:18,25,28,69` import `@repo/nest-lifecycle`, `@repo/nest-database-core`, `@repo/nest-schema`, `@repo/nest-supervisor-core`, but the packages are named `@deployer/nest-*` (`packages/nest/*/package.json`). Yet `infra/docker/compose/docker-compose.prod.yml:40` (`build-api`) still builds it (`Dockerfile.api.prod:35-36` defaults `PRUNE_SCOPE=@deployer/api`). Everything below is traced through the services tier; where the monolith is *ahead* (uncommitted work in `apps/api/src/modules/deployment/triggers/`, `apps/api/.../github.webhooks.controller.ts:212-222`) I say so, because the fix is then a port, not a rewrite.

**Audit claims that are now wrong or need qualifying** (details in section 9): setup.md §3.8 (`deployer-bff` + `svc-bff` both run) is stale; parity.md rows "Rollback REAL", "Cancel REAL", "GitHub webhooks/PR previews REAL", "ZIP upload REAL" are wrong at product level; web.md "What works end to end" lists trigger/rollback as working when the UI sends an invalid rollback body and the trigger yields an `nginx:alpine` "success".

**Shared foundations.** Most work items below reduce to eight foundations. Build them once; every journey consumes them.

| ID | Foundation | Size | Used by |
|---|---|---|---|
| F1 | Authz policy layer: platform role x project role x resource, default-deny, applied in the `requireAuth` chain; scope list/get/stream by membership | L | J2 J3 J4 J5 J6 |
| F2 | "Honest deploy": resolve source/builder/port/health/env from the saved service server-side; persist an `execution_plan` + env snapshot on the deployment row; no artifact = failed deploy; delete `nginx:alpine` fallback | L | J1 J2 J4 |
| F3 | System actor / service token so webhooks, schedulers and approvals can act without a user session (reuse `x-mesh-internal-key`, `apps/api-services/bff/src/clients/service-auth-context.ts:64`) | M | J2 J4 J6 |
| F4 | Durable event journal → audit log + notification dispatcher + activity feed. Seed exists: `core_event_logs` (`packages/nest/schema/src/global/platform/events.ts:37`) and typed domain events already emitted (`project.service.ts:91,121,137,204,252`) | L | J4 J5 J6 |
| F5 | Installer + published images + registry (build once in CI, pull everywhere; digest pinning) | L | J1 J2 J5 |
| F6 | Encrypted env/secret store (codec exists: `packages/nest/schema/src/codecs/codec-registry.ts:184` `encryptedText`) | M | J2 J6 |
| F7 | Swarm as the default runner: stable service name, start-first rolling update, health-gated, auto-rollback, old-task cleanup | L | J2 J4 J5 |
| F8 | Playwright harness + support containers (git host, ACME, DNS, SMTP, mock Cloudflare) | M | all |

Per-journey effort if the foundations exist: J1 ≈ M, J2 ≈ L, J3 ≈ L, J4 ≈ M, J5 ≈ L, J6 ≈ M.

---

## J1. First-run install → first deploy in under 5 minutes

### Ideal end state

Budget (100 Mbit/s VPS, 2 vCPU/4 GB, images already published):

| t | What the operator sees |
|---|---|
| 0:00 | One command: `curl -fsSL https://<release host>/install \| sh`. Pre-flight prints pass/fail per check (Docker >= 24, ports 80/443/2377/7946/4789/UDP 51820, kernel WireGuard, RAM/disk) with the exact fix for each failure. Secrets (`AUTH_SECRET` >= 32 random bytes, DB password, setup claim token) are generated and stored; nothing has a default. |
| 0:20 | Images pulled by digest in parallel with a progress bar. No source build on the VPS. |
| 2:00 | Terminal prints `https://<ip-dashed>.sslip.io/setup?claim=<token>` (or the SSH-tunnel form). Wizard asks for: admin account, **address** (sslip.io default / my domain / Cloudflare tunnel), swarm role. One page, one button. |
| 3:00 | Live progress stream (reconnect-safe) → handover → dashboard over HTTPS. |
| 3:15 | Onboarding checklist on `/dashboard`: Connect Git (or paste a public repo) → Deploy → Add domain. |
| 4:30 | "New" → paste repo URL → platform detects Dockerfile/Nixpacks, creates project + service + default environments, deploys, streams build logs, shows an **Open** button with the live URL. |

Acceptance: install-to-dashboard <= 3:00 and dashboard-to-live-URL <= 2:00 for a public Dockerfile repo whose build takes <= 60 s; zero manual env-file edits; no credential the operator did not choose; re-running the installer is idempotent; a reboot does not create an extra admin.

### Current path, step by step

| # | Step | Code path | Status | Evidence |
|---|---|---|---|---|
| 1 | Get the platform onto a VPS | README says clone + `bun run init`; `deploy.sh` is for "The Gossip Club" (nginx/certbot) | MISSING | `README.md` quick start; `deploy.sh:1-4` |
| 2 | Start production | `bun start` → `docker-compose.prod.yml` → `build-api` builds the **monolith** from source on the VPS | BROKEN | `infra/docker/compose/docker-compose.prod.yml:40`; `Dockerfile.api.prod:35-36`; `apps/api/src/app.module.ts:18` |
| 3 | Use the BFF tier in prod | setup switches on `DEPLOYER_BFF_IMAGE` but no prod compose sets it or builds the 7 tier images (only dev-supervised does) | MISSING | `apps/setup/src/config/env/env.schema.ts:176-186`; `apps/setup/.../api-service-provisioner.service.ts:184-209` |
| 4 | Open the setup wizard | `apps/setup` SSR wizard → `/setup/trigger` → gate → swarm/mesh → handover | REAL (dev profile) | `apps/setup/src/modules/wizard/*`, `handover-orchestrator.service.ts` |
| 5 | Prove you own the box | no claim token or setup secret exists; mitigation is "bootstrap Traefik binds 127.0.0.1" | MISSING | grep `claim\|setupToken` in `apps/setup/src` finds only unrelated port-claim comments; setup.md §3.5 |
| 6 | Pick an address / HTTPS | hostnames hard-coded `<svc>.[prefix.]deployer.localhost`, HTTP only | MISSING | `apps/setup/src/modules/handover/services/ingress-handover.service.ts:108` |
| 7 | Create admin | wizard → API local init → Better Auth sign-up → superAdmin | REAL | setup.md §1 #24 `(audit)` |
| 8 | Survive first restart | default admin bootstrap decision is `always`, falls back to `admin@admin.com` / `adminadmin` | BROKEN (security) | `apps/api/src/core/admin-bootstrap/admin-bootstrap-policy.ts:~101-104`; `apps/api-services/shared/src/core/admin-bootstrap/default-admin.bootstrap.ts:48,50` |
| 9 | Land on the dashboard | `/dashboard` command center; hints list is a constant, ignores dismissal | PARTIAL | `apps/web/src/app/dashboard/dashboard-client.tsx`; setup.md §3.11 `(audit)` |
| 10 | Create a project | `project.createProject` creates **no environments** | PARTIAL | `apps/api-services/services/project/src/modules/project/services/project.service.ts:75-100` |
| 11 | Connect Git | GitHub App manifest requires a configured *and reachable* public access point; PAT path exists but is not used by clone | PARTIAL | `apps/api-services/services/fleet/src/modules/providers/code/github/controllers/github-account.controller.ts:201-217`; `shared/src/core/modules/git/git/services/git.service.ts:33` |
| 12 | Create the service (8-step wizard) | wizard builds provider/runner config; **no "deploy now"** | REAL form, config ignored later | `apps/web/src/app/dashboard/projects/_components/CreateServiceWizard.tsx`; grep `useTriggerDeployment` finds one page only |
| 13 | Press Deploy | only entry point is Project → Deployments → "New Deployment"; builds `source` for github only; environment select shows "No environments defined" | PARTIAL | `apps/web/src/app/dashboard/projects/[projectId]/deployments/page.tsx:94-120,215-229` |
| 14 | Contract accepts the call | `environment` is a strict 4-name enum, yet the dialog advertises free-form names | BROKEN for non-default env names | `packages/contracts/common/src/environment.schema.ts:60`; `packages/contracts/runtime/modules/deployment/crud.ts:93`; `deployments/page.tsx:30-31` |
| 15 | Server resolves what to build | trigger takes source/builder from the request; ignores `service.builderId`, port, health, start command; no builder → `fallbackContainerImage` (null) | BROKEN | `apps/api-services/services/runtime/src/modules/deployment/services/deployment.service.ts:457-487`; `.../builders/deployment-artifact-builder.service.ts:65-67` |
| 16 | Clone | anonymous `git clone --depth 1 --branch <branch>`, default branch `main`, no credentials, `--branch` takes a user string | PARTIAL (public only) | `shared/.../git.service.ts:21,33` |
| 17 | Build + log | `docker build`, output never captured, only milestone lines | BROKEN | `packages/nest/docker/src/services/docker.service.ts:455`; `followStream(stream, onProgressLine)` already supports a callback at `:1152` |
| 18 | Run | no image → `nginx:alpine`, marked `success`; plain docker runner not attached to the platform overlay (Traefik cannot resolve it) unless the user sets `DEPLOYER_NETWORK_MODE` in service env; old containers never removed | BROKEN | `.../runners/docker/docker-runtime-runner.service.ts:38,60,73`; `.../deployment/queue/deployment-queue.worker.service.ts:538-560` |
| 19 | Route | ingress picks newest `success` row that has `containerName` and `service.port`; host = `<service>-<project>.<lane domain>` | REAL, fragile | `shared/src/core/modules/platform-ingress/services/platform-routes-source.service.ts:213-248` |
| 20 | See the URL | `deployment.domainUrl` is set only from domain mappings, so a default deploy shows no URL although a lane route exists | BROKEN UX | `.../deployment-execution-workflow.service.ts:~600`; `shared/.../domain-routing.service.ts:143-145` (returns `no_domain_mappings`) |
| 21 | Reach it from your laptop | `*.deployer.localhost` resolves to the laptop itself | BROKEN on a remote VPS | step 6 |

Verdict: nothing in the chain from step 1 to step 3 works for a fresh VPS; from step 13 to 18 the first deploy is silently wrong even when the platform runs.

### Work items

| ID | Work | Size | Depends on |
|---|---|---|---|
| W1.1 | CI publishes versioned, multi-arch images for web, bff, svc-health/identity/project/fleet/runtime, setup, mesh-agent, door, scanner-runner (today `deploy.yml` builds one stale `deployer` image from `infra/docker/builder/deployer/Dockerfile.prod`) | M | — |
| W1.2 | `install.sh` (pre-flight, secrets, pull, `compose up`, print claim URL; idempotent; `--join` mode reserved for J5). Operator must still pick installer-vs-CLI (README §6.2); ship the script first, wrap it in the CLI later | M | W1.1 |
| W1.3 | Prod compose for the tier: remove `build-api`; set `DEPLOYER_BFF_IMAGE` and the five `DEPLOYER_SVC_*_IMAGE`, `MANAGED_WEB_APP_IMAGE`; Docker secrets; no default creds | M | W1.1 |
| W1.4 | Decide the monolith (delete, or repair imports). Minimum for J1: nothing in the prod path may reference it | S–M (full cutover is L, see monolith-cutover.md) | — |
| W1.5 | Setup claim token: generated by installer/setup, required on `/setup/trigger` and the probe forwards; lock `/setup/*` once `setup_done` (BFF `setup.controller` and setup app) | M | P0 #4 |
| W1.6 | Admin bootstrap default `never`; delete `admin@admin.com`/`adminadmin` fallbacks in both trees; fail boot if it would create a known-password admin | S | P0 #2 |
| W1.7 | Wizard "Address" step: sslip.io auto-address (default), own domain (optional DNS-provider token), Cloudflare tunnel. Derive web/API origins, cookie domain, trusted origins; add 443 + ACME with a **required** email to the bootstrap Traefik and handover (`ingress-handover.service.ts:108`) | L | W1.2 |
| W1.8 | Setup failure recovery: `retry` re-runs the failed stage; `gate.open()` clears sticky `failed` (setup.md §3.4) | M | — |
| W1.9 | Pre-flight in installer **and** wizard (ports, WireGuard, Docker version, disk) with actionable messages | M | — |
| W1.10 | Onboarding checklist on `/dashboard`, computed from queries it already makes; replace the constant `listPostSetupHints` | S–M | — |
| W1.11 | Seed default environments (production/staging/preview/development) on `createProject`; accept environment id or free-form name in `deployment.trigger` | S–M | — |
| W1.12 | Surface the live URL: compute `<label>.<lane domain>` from lane config and show **Open** in the service header and deployment row | S–M | — |
| W1.13 | "Quick deploy" page `/dashboard/new`: paste repo / image / upload → detect (`detectRunner` exists, `github-account.controller.ts`) → project + service + env + deploy → live log | M–L | F2, W2.3, W2.4, W2.9 |
| W1.14 | Pre-pull progress in the setup SSE stream; configurable per-stage budgets (300 s handover budget is shared today) | M | — |
| W1.15 | A real clean-VPS e2e (prod profile): single node, restart, failure injection per stage | M | F8 |

### UX details

- **Empty states**: no projects → existing "Create your first project" (`projects/page.tsx:176-181`) becomes step 2 of a persistent checklist; no Git provider → "Paste a public repo URL, or connect GitHub/GitLab (needs a public address — set one in Network)". Do not hide PAT: the App flow needs a reachable URL, which a brand-new VPS may not have yet.
- **Progress**: installer = per-check ticks then per-image bars; wizard = existing orchestration stream with step durations; deploy = stage timeline (clone → build → start → health → route) with elapsed time, not flat log text.
- **Failure**: name the stage and the cause, show the last 20 log lines inline, offer "Retry this step". Examples: "UDP 51820 is blocked (ufw is active): run `ufw allow 51820/udp`"; "No Dockerfile at repository root: set Root directory or pick Nixpacks".
- **Undo**: "Start over" in the wizard resets cleanly (volumes preserved only on request); first deploy is a normal deployment, so the previous state is "nothing running" and Stop/Delete is the undo.

### Acceptance criteria

1. On a clean Ubuntu 24.04 VM with only Docker, `install.sh` reaches a signed-in dashboard in <= 3:00 (warm registry cache) with no prompts besides the wizard.
2. `/setup/*` returns 401/409 without the claim token and after completion.
3. After `docker restart` of every platform container, `user` table still has exactly one admin.
4. A public repo with a Dockerfile deploys via Quick deploy and returns HTTP 200 on the displayed URL within 2:00 of pressing Deploy.
5. A repo with no Dockerfile and no detectable builder **fails** with a message naming the missing file; no `nginx:alpine` anywhere.
6. The displayed URL loads from a different machine over HTTPS (sslip.io or tunnel).

### E2E outline (Playwright; nightly, needs Docker)

`first-run.spec.ts` — fixtures: `stack` (clean VM or DinD; runs `install.sh` against a local registry), `gitHost` (Gitea container serving `fixtures/hello-http` with a Dockerfile).

1. `test.step("install")`: run installer; capture claim URL from stdout; assert exit 0 and elapsed < 180 s.
2. Open claim URL in a fresh context; assert `/setup/trigger` without token returns 401 (API request).
3. Fill account, keep default address; assert progress list reaches "Dashboard ready"; click Continue.
4. Assert checklist visible; click "New", paste Gitea repo URL; assert detected builder "Dockerfile".
5. Click Deploy; assert stage timeline advances and a build log line from the Dockerfile (`Step 1/..`) appears.
6. Assert **Open** link appears; `request.get(url)` returns 200 body `hello`.
7. `docker restart` all platform containers; reload; assert still signed in and `user` count == 1 (via API).
8. Negative: repo without Dockerfile → deployment status `failed`, message contains "Dockerfile".

---

## J2. Deploy a git repo, then ship changes by push (previews, rollbacks, env/secrets)

### Ideal end state

- Connect GitHub once (App via manifest, PAT fallback, deploy key for any git host). Pick repo + branch; the service is created with the detected builder and port.
- First deploy builds, pushes to the registry, starts a Swarm service with start-first rolling update, waits for the health check, flips the route, keeps the previous version serving on failure, and says so.
- `git push` to the configured branch triggers a deploy within seconds (raw-body verified webhook, deduped, branch/path filters, `[skip ci]`), commit status and URL posted back to GitHub.
- A PR gets its own preview deployment (`<svc>-pr-12.<domain>`, `preview` env scope, PR comment with URL, torn down on close, TTL + orphan GC, fork PRs gated).
- Rollback = one click on any previous successful deployment; redeploys the recorded image digest + env snapshot without rebuilding; completes in < 15 s; "roll forward" is just redeploy.
- Env vars: per environment, encrypted at rest, masked by default, `.env` import/export, build-time vs runtime flag, a "redeploy needed" badge when the running deployment's env hash differs from current.

### Current path, step by step

| # | Step | Code path | Status | Evidence |
|---|---|---|---|---|
| 1 | Connect GitHub App | web `admin/providers/code/github` → `manifestInit` (needs reachable public URL) → callback stores app with `webhookSecret` | REAL, gated on J3 | `github-account.controller.ts:201-217,289` |
| 2 | Private repo clone | anonymous clone; `getInstallationAccessToken` exists but is not called from the clone path | MISSING | `git.service.ts:33`; deployments.md §1 `(audit)` |
| 3 | Create service | wizard persists `autoSyncEnabled: true`, `webhookEnabled: false`, `authSecretRef: 'default'` — no consumer | REAL form, inert fields | `projects/_components/steps/StepProvider.tsx:64`; projects-services.md §1.5 `(audit)` |
| 4 | Deploy button | project Deployments page only; `as any` payload; source built for github only | PARTIAL | `deployments/page.tsx:96-114` |
| 5 | Server trigger | access check OK (owner/maintainer/deployer) then see J1 steps 15–20 | BROKEN | `deployment.service.ts:372-376,437-487` |
| 6 | Plan persisted? | row stores only `sourceType` + `sourceConfig`; builder/runner/env live only in the in-memory job payload | MISSING | `deployment.service.ts:491-498,518-561` |
| 7 | Queue | in-process `Map`; reaper resets expired jobs without re-emit; reconcile touches only `building`; one serial worker | BROKEN durability | `queue/deployment-queue-lifecycle.service.ts:44-45,595-649`; `queue/deployment-queue-reconciliation.service.ts:78`; `queue/deployment-queue.worker.service.ts:124` |
| 8 | Run + health gate | docker runner (see J1 step 18); health path hard-coded `/health`, service health fields ignored | BROKEN | `deployment-execution-workflow.service.ts:491` |
| 9 | Swarm rolling update | runner is well built (start-first, rollback-on-failure) but excluded from the contract enum and from `trigger` | UNREACHABLE | `runners/swarm/swarm-runtime-runner.service.ts`; deployments.md §1 `(audit)` |
| 10 | Webhook verify | secret read from `app_config.github_webhook` (nothing writes it) while the manifest flow stores a per-app secret; HMAC over `JSON.stringify(body)`, not raw bytes | BROKEN (always 401) | `fleet/.../providers/code/github/repositories/github-apps.repository.ts:175-186`; `.../middleware/github-webhook-auth.middleware.ts:119,188` |
| 11 | Push → deploy | `push` is "unhandled" and skipped | MISSING | `.../controllers/github.webhooks.controller.ts:78` |
| 12 | PR → service | `serviceId = payload.repository.full_name` placeholder; the fleet repository already has `findServiceBySourceUrl` (`github-apps.repository.ts:255`) | BROKEN, fix is tiny | `github.webhooks.controller.ts:138-140`; monolith fixed it at `apps/api/.../github.webhooks.controller.ts:212-222` |
| 13 | PR → preview | creates DNS + route + `preview_environments` row attached to the service's **latest deployment**; never builds the PR | BROKEN | `fleet/.../preview-provisioning.service.ts` `(audit)`; `PreviewEnvOverlayService` provided, injected nowhere |
| 14 | Rollback click | UI sends `params.id` only; contract requires `body.targetDeploymentId` → validation error | BROKEN | `deployments/page.tsx:141`; `packages/contracts/runtime/modules/deployment/crud.ts:233-236` |
| 15 | Rollback executes | creates a rollback row + job; worker runs the **deploy** code path with no artifact; `persistRollbackExecutionResult` marks `success`; route ignores it because the row has no `containerName` → silent no-op | BROKEN (silent) | `deployment.service.ts:673-720,1396-1411`; `platform-routes-source.service.ts:224-225` |
| 16 | Cancel | DB flip only; no guard against `building`/`success` overwrite; queue job untouched | BROKEN | `deployment.service.ts:566-623`; grep `cancelled` finds nothing in workflow/queue/repository |
| 17 | Retry | new row + job whose payload drops `executionPlan` **and** `runtimeConfiguration` (env vars) | BROKEN | `deployment.service.ts:932-950` |
| 18 | Env vars | `services.environment_variables` is plaintext JSONB, returned to any authenticated reader; merge chain project → service → user is real and snapshotted into the job | PARTIAL / insecure | `packages/nest/schema/src/global/project/deployment.ts:118`; `service.service.ts:88-102`; `deployment.service.ts:553` |
| 19 | Env UI | "Config" link passes env *name* where a UUID is required → "Environment not found"; no import/export, no secret flag, no per-env values | BROKEN/PARTIAL | `projects/[projectId]/services/[serviceId]/configuration/environment/page.tsx:165-166` |
| 20 | Logs during build | polled every 4 s, first 500 lines, no build output | PARTIAL | `deployment-logs-viewer.tsx:37-41`; `docker.service.ts:455` |
| 21 | Cleanup | old containers (docker runner stops only same `deploymentId`), workspaces, images never removed | MISSING | `docker-runtime-runner.service.ts:73`; deployments.md §1 `(audit)` |

### Work items

| ID | Work | Size | Depends on |
|---|---|---|---|
| W2.1 | **Honest deploy (F2).** `deployment.trigger({serviceId, environment, ref?})`; server reads provider config, builder (`builderId` or auto-detect Dockerfile/Nixpacks), port, health path/interval/retries, start command, resources, volumes; stores `execution_plan` JSONB + resolved env snapshot on the deployment row; no image produced ⇒ `failed` with reason; delete the `nginx:alpine` fallback in both runners (`docker-runtime-runner.service.ts:38`, `swarm-runtime-runner.service.ts:99`) | L | P0 #7 |
| W2.2 | **Real rollback.** Rollback = redeploy of the target's recorded image digest + env snapshot + plan through the runner; route flips only after the health gate; keep the last N images per service (retention setting finally enforced); reject targets whose image was pruned with a clear message | M | W2.1 |
| W2.3 | **Service-page deploy controls**: Deploy / Redeploy / Rollback / Cancel in the service header; rollback picker (commit, author, time, env diff); remove `as any`; adopt `projects/_utils/trigger-source.ts` (written, unused) | M | W2.1 |
| W2.4 | **Build/deploy log capture + streaming**: pass `onProgressLine` from `buildImage` into `insertLog`, emit `logAppended`/`statusChanged` from the workflow, web consumes `deployment.stream*` and tails (not first 500) | M | — |
| W2.5 | **Real cancel**: queue flag + `AbortSignal` into the build, guard every terminal-state write (`WHERE status NOT IN ('cancelled','success','failed')`), cancel a queued job before claim | M | — |
| W2.6 | **Durable queue**: `deployment_jobs` table, re-emit reaped jobs, reconcile `queued`/`deploying` at boot, per-service lock, bounded concurrency, prune finished | M–L | P0 #7 |
| W2.7 | **Swarm default runner (F7)** + registry push + digest pull; interim for docker runner: attach to the platform overlay when `networkMode` is unset and stop the previous container of the same service after the new one passes | L (interim S–M) | F5 |
| W2.8 | **Webhooks that work**: per-app secret selected by `x-github-hook-installation-target-id`; HMAC over raw body (needs `rawBody` access); durable dedupe (`WebhookIdempotencyService.claim()` exists, unwired); push dispatch through a trigger registry (port `apps/api/.../triggers/*`), branch filter from service config, `[skip ci]`, path filters; call runtime through `ServiceClient` with a **system actor** (F3) | M–L | F3 |
| W2.9 | **Private repos**: installation token or PAT injected via `http.extraHeader` (never in the URL/log), fetch-by-sha, default-branch detection, validate branch against `^[A-Za-z0-9._/-]+$` | M | — |
| W2.10 | **Real PR previews**: per-PR deployment (`<svc>-pr-N`), `preview` env scope, wire `PreviewEnvOverlayService`, PR comment + commit status, teardown on close, TTL + orphan GC, fork-PR guard; share naming between create and cleanup | L | W2.1, W2.8 |
| W2.11 | **Env/secret store (F6)**: encrypted JSON codec on `environment_variables`; `isSecret` + write-only masked reads; per-environment layers; `.env` import/export; build-time vs runtime flag; "redeploy needed" badge via env-hash comparison; fix the env "Config" link | M (encryption + masking) – L (everything) | — |
| W2.12 | Retry carries plan + runtime config (falls out of W2.1: copy the persisted plan) | S | W2.1 |
| W2.13 | GitHub Deployments/Status API back-reporting; tokenised generic deploy-hook URL for non-GitHub CI | M | W2.8 |
| W2.14 | Environment model: accept environment id/free-form name end to end (drop strict 4-value enum at `environment.schema.ts:60`) | S–M | — |
| W2.15 | Cleanup service: old containers/services, workspaces (`GitService.cleanupDeployment` has no caller), images by retention | M | W2.2 |

### UX details

- **Empty state** (service with no deployments): "Nothing deployed yet. Push to `main` or press Deploy" with the webhook status ("Webhook: connected / not reachable — fix").
- **Progress**: stage timeline with durations; live build log with ANSI; header chip "Deploying abc123 (by push, @octocat)".
- **Failure**: banner "Deploy failed at build: <first error line>. Still serving v41 (abc122)." with [View log] [Rollback not needed] [Retry]. The previous version staying live must be stated, because route flip happens only after success (`platform-routes-source.service.ts:219`).
- **Undo**: rollback dialog shows target commit/author/time and env diff; after rollback, offer "Redeploy latest". Cancel confirms and says what is aborted. Secret edits are write-only; show "Last changed by X, 3 min ago".
- **Preview**: deployment list groups previews; closing a PR shows "Preview removed".

### Acceptance criteria

1. Push a commit to the tracked branch of a fixture repo: a new deployment reaches `success` and the URL serves the new content within 90 s; GitHub (or Gitea) shows a commit status.
2. A request with a bad signature, a replayed delivery, and a push to another branch each result in **no** deployment (401 / `duplicate` / `skipped` respectively).
3. During a deploy that fails its health gate, `GET <url>` keeps returning the old content every second for the whole window (0 failed requests) and the deployment is `failed` with the health reason.
4. Rollback to deployment N-1 restores N-1 content in < 15 s without a build log line for `docker build`.
5. Changing an env var shows "redeploy needed"; the value never appears in any API response body, deployment log or job payload (grep the DB for the plaintext = no hits).
6. Opening a PR creates a distinct URL serving the PR's code; closing it removes route, DNS, container within 1 minute.
7. Cancel during build ends in `cancelled` and stays `cancelled`; the build process is gone.
8. A viewer on the project sees no Deploy/Rollback/Delete controls and gets 403 from the API for each.

### E2E outline

`deploy-and-ship.spec.ts` — fixtures: `gitHost` (Gitea with webhooks to the platform), `fakeGithubSigner` (posts GitHub-shaped deliveries with the real secret), `stack`.

1. Sign in as admin; create project `shop`; connect provider via PAT (App flow is covered in J3 where a public URL exists).
2. New service from `gitea/fixtures/web` branch `main`; assert detected builder and port; click Deploy; wait for `success`; assert URL returns `v1`.
3. Set env `GREETING=hi` (secret flag on); redeploy; assert page prints `hi`; assert API `service.findById` returns `***`, DB column ciphertext (via test-only SQL).
4. Push commit changing the page to `v2` to Gitea; assert new deployment appears **without clicking**, status `success`, URL returns `v2`.
5. Push `fail.txt`-marked commit that breaks `/health`; poll URL each 500 ms during the deploy, assert always `v2`; deployment `failed`, banner mentions "Still serving".
6. Rollback to v1 from the deployments table; assert URL returns `v1` and no `docker build` log line.
7. Open PR from branch `feature`; assert preview URL returns the PR content; close PR; assert URL 404 within 60 s.
8. Start a slow build, Cancel; assert `cancelled` after 10 s and `docker ps` shows no builder.
9. Replay step 4 delivery with same `x-github-delivery`; assert response `duplicate_delivery` and no new row. Send with wrong signature; assert 401.
10. Sign in as a `viewer` collaborator; assert Deploy/Rollback/Delete are absent and API returns 403.

---

## J3. Add a custom domain with HTTPS

### Ideal end state

Service → Domains → Add `app.example.com`:

1. The platform tells you where DNS lives (provider token connected → "Create the records for me"; otherwise exact copy-paste records).
2. A stepper shows each record with live status (found / missing / wrong value — and what we saw), auto-polling with backoff; verification completes on its own, no Verify button needed.
3. Certificate step: "Issuing… (HTTP-01 / DNS-01)", resulting in issued/expiry date, or a specific error (CAA, rate limit, proxied record, unreachable port 80).
4. Route goes live the moment verification passes (no redeploy), HTTP→HTTPS redirect and www↔apex toggle available; a domain inventory page lists every domain, verification, certificate expiry, bound service.
5. Removing the domain removes route (and records the platform created) and says what remains.

Acceptance: a domain whose records are correct is `verified` and serving valid HTTPS in <= 3 minutes (single-node `direct` edge) without a redeploy; an unverified or foreign domain can never be routed; platform hosts (`api.`, `web.`, `setup.`) cannot be claimed by a project.

### Current path, step by step

| # | Step | Code path | Status | Evidence |
|---|---|---|---|---|
| 1 | Find the UI | two pages: `/dashboard/projects/[id]/domains` (Add + remove + reachability probe) and `/dashboard/network/domains` (Add manual / via provider, Verify) | PARTIAL, inconsistent | `apps/web/src/app/dashboard/projects/[projectId]/domains/page.tsx`; `.../network/domains/page.tsx:58-60` |
| 2 | Add domain on the project page | success toast and close; the `verificationInstructions` returned by the API are discarded; row has no Verify and no instructions | BROKEN UX | `projects/[projectId]/domains/page.tsx:35-41`; `projects/_components/domains/ProjectDomainRow.tsx` (no verify action) |
| 3 | API returns instructions | records `_deployer-challenge` = `deployer-verification=<token>` (TXT) or `_deployer.<d>` → `verify.deployer.<token>.acme.` (CNAME) | BROKEN (mismatch) | `apps/api-services/services/project/src/modules/domain/services/domain-project.service.ts:70-85` |
| 4 | Verifier expects | TXT at `_deployer-verify.<domain>` with the bare token, or CNAME to `verify-<token>.deployer.io` (a domain nobody owns) | mismatch | `apps/api-services/shared/src/core/modules/domain/services/domain-verification.service.ts:72,94,129,234` |
| 5 | Press Verify | controller passes no user; service calls `assertProjectAccess(projectId, "verify")` so `requesterId === "verify"` ⇒ Forbidden for everyone, owner included | BROKEN | `domain-project.service.ts:176`; `.../controllers/project-domain.controller.ts:~67-72`; `shared/.../project-access.service.ts:33-40` |
| 6 | Auto-verify | hourly `setInterval`, selects `pending` only, first miss sets `failed` forever | BROKEN | `domain-verification.service.ts:27,163,259` |
| 7 | Bind to a service | `getAvailableDomainsForProject` lists only verified (so unreachable per step 5), but `addServiceDomain` itself checks neither `verified` nor that the service belongs to the project | MISSING enforcement | `shared/.../repositories/project-domain.repository.ts:116-136`; `domain-service.service.ts:62-110` |
| 8 | Bypass | free-text `service.customDomains` (wizard "Domains" step) is published as a public host with no verification | BROKEN (security) | `platform-routes-source.service.ts:233`; `apps/web/.../steps/StepDomains.tsx:145` |
| 9 | Route updates | hosts are read from `deployments.domainUrl`, frozen at deploy time; mapping changes call no `TraefikConfigRefresher` ⇒ a new domain works only after the next deploy; `basePath` and non-primary hosts ignored | BROKEN | `platform-routes-source.service.ts:228-229`; grep `ingressRefresher` finds callers in runtime deploy, fleet reachability, managed-web only |
| 10 | DNS records for the domain | lane DNS plane only handles `*.<lane domain>`; Cloudflare is the only adapter; custom domain A/CNAME never created; tunnel edge has one wildcard rule | MISSING | networking.md §1.4 `(audit)` |
| 11 | Certificate | ACME only on the `direct` edge; HTTP-01 per host; multi-node challenge may hit the wrong node; ACME email defaults to `admin@example.com` (rejected by Let's Encrypt); `provisionTlsCertificate` inserts a DB row only | BROKEN/PARTIAL | `packages/config/env/src/index.ts:255`; `shared/.../supervisors/platform/traefik-supervisor.service.ts:~399`; networking.md §1.4 `(audit)` |
| 12 | Cert status | no UI, no expiry data, no alerts | MISSING | web.md §6 `(audit)` |
| 13 | Authz | DNS record create/delete, tunnel and `getTunnelToken` use `requireAuth()` only; `reachability.check` is an SSRF primitive for any user | BROKEN (security) | networking.md §3.1,3.3 `(audit)` (not re-read) |

### Work items

| ID | Work | Size |
|---|---|---|
| W3.1 | Pass the real `requesterId` into `verifyProjectDomain` (controller + service) | S |
| W3.2 | One source of truth for verification instructions: `DomainVerificationService` generates them; `addProjectDomain` returns them; table, dialog and provider form render them. Drop the `deployer.io` CNAME scheme or switch to `_deployer-verify.<d> CNAME <token>.verify.<platform domain>` (a name the platform controls) | S–M |
| W3.3 | Verification worker: runs right after add, retries with backoff for `pending` and non-definitive `failed`, stores `lastCheckedAt`/`lastError`/what was seen; UI polls and shows per-record status | M |
| W3.4 | Enforce `verified` in `addServiceDomain`, in route generation and in the `customDomains` path (or delete `customDomains`); service ∈ project; global uniqueness of verified domains; reserved platform hosts | M |
| W3.5 | Build routes from live `service_domain_mappings` (+ verified) instead of `deployments.domainUrl`; refresh ingress on mapping change; support `basePath` and multiple hosts in `buildLaneTraefikConfig`; delete the legacy `DomainRoutingService` writers of `traefik_*` rows (entrypoints `web`/`websecure` do not exist in the lane ingress) | M–L |
| W3.6 | DNS automation: "Create records" through the DNS provider (Cloudflare now, adapter interface for others), correct targets (tunnel CNAME vs node A records), apex flattening note; manual instructions otherwise | M |
| W3.7 | Tunnel edge custom hostnames: per-hostname ingress rule + CNAME for zones the account owns | M |
| W3.8 | TLS: required ACME email (wizard + settings), HTTP-01 single-node, DNS-01/wildcard for multi-node via the DNS provider, shared ACME store; `domain_certificates` table (status, notAfter, lastError) fed by Traefik/ACME result or TLS probe; expiry alerts | L |
| W3.9 | Domain inventory page (cross-project) with verification, DNS, cert, bound service; redirect toggles (www↔apex, HTTP→HTTPS) | M |
| W3.10 | Authz: platform admin or project maintainer for DNS/tunnel endpoints; private-range/loopback blocking on `reachability.check`/`probePeer`; stop returning the tunnel token | M |
| W3.11 | Removal flow: remove route immediately, offer to delete records the platform created, keep cert until expiry | S–M |

### UX details

- **Stepper** with a persistent record table: columns type / name / value / status / "we saw". Copy buttons per cell. Status text e.g. "Wrong value: found `1.2.3.4`, expected `5.6.7.8`" or "Cloudflare proxy is on (orange cloud) — HTTP-01 needs DNS only".
- **Empty state** (no domains): "Your app is at `shop-web.<your-domain>`. Add your own domain to serve it as `www.example.com`."
- **Progress**: DNS check polls every 10 s with backoff; certificate step shows ACME phase and elapsed time; no spinner without text.
- **Failure messages** map ACME errors to causes (CAA record blocks `letsencrypt.org`, rate limit hit until <time>, port 80 unreachable from the Internet, DNS not propagated).
- **Undo**: Remove restores the previous primary host and tells which records remain at the DNS host; changing the primary domain shows the redirect effect first.

### Acceptance criteria

1. Adding a domain on **either** page shows the same instructions; correct records flip it to `verified` without pressing anything within 2 minutes of propagation.
2. `Verify` succeeds for an owner/maintainer and returns 403 for a viewer.
3. A domain in `pending`/`failed` never appears in `GET /traefik/config`; a platform host (`api.<domain>`) is rejected at add time.
4. Binding/removing a mapping changes routing within 10 s with no redeploy.
5. HTTPS handshake on the custom domain presents a certificate for exactly that name; `http://` redirects (301/308) to `https://`.
6. With no ACME email configured the UI blocks enabling public TLS with an explanatory message.
7. A viewer cannot call any DNS/Cloudflare/tunnel procedure (403) and cannot read the tunnel token.

### E2E outline

`custom-domain.spec.ts` — fixtures: `pebble` (ACME CA + challenge test server), `dns` (a small authoritative resolver the platform and the test both query; test mutates records through its API), `mockCloudflare` (implements the zones/dns_records/tunnels subset used by `cloudflare.controller.ts`), Chromium launched with `--host-resolver-rules="MAP *.e2e.test <node ip>"` and Pebble's root in the trust store.

1. Public edge configured to `direct` with ACME email set; deploy fixture service (from J2 fixture).
2. Add `app.e2e.test` on the project page; assert instructions panel opens with TXT `_deployer-verify.app.e2e.test`.
3. Assert status "waiting for DNS"; write the TXT record via `dns` fixture; assert status flips to `verified` ≤ 60 s with no click.
4. Assert certificate step shows issuing → issued with notAfter; `page.goto('https://app.e2e.test')` shows content, `securityDetails().issuer()` is Pebble.
5. `http://app.e2e.test` redirects to https.
6. Negative: add `api.<platform domain>` → rejected; add domain for which TXT never appears → stays pending, message names what it looked for.
7. Remove domain; assert `https://app.e2e.test` fails within 15 s.
8. Provider variant: with `mockCloudflare` connected, "Create records for me" creates TXT + A; assert the fixture saw both calls.
9. As viewer: assert domain add/verify controls hidden and `POST dns record` returns 403.

---

## J4. Debug a failing service (logs, metrics, exec, events, alerts, who-changed-what)

### Ideal end state

Service page header shows an honest status (Running / Degraded / Crash-looping / Stopped / Deploying / Failed), last deploy (who, when, commit), URL, replica health, and Restart / Redeploy / Rollback.

A "What's wrong" card appears when status is not healthy: "`web` exited with code 1, 3 restarts in 10 min. Last output: `BOOM: missing DATABASE_URL`" with [View logs] [Open shell] [Rollback] [Edit env].

Tabs: **Logs** (real stdout/stderr per replica, live tail, search, time range, download, kept after the container is gone), **Metrics** (CPU/memory/network, 1 h / 24 h history with limits drawn), **Events** (deploys, restarts, health transitions, scale, config changes with actor), **Shell** (role-gated, audited), **Alerts** (rules + channels, mute), **History** (who changed what).

### Current path, step by step

| # | Step | Code path | Status | Evidence |
|---|---|---|---|---|
| 1 | Notice something is wrong | global header "Live" chip reflects control-plane reachability, not services; no notifications; web push has no service worker | MISSING | `HeaderLiveStatus.tsx` `(audit)`; `apps/web/src/app/sw.ts` (bare precache, no push handler); no serwist in `next.config.ts` |
| 2 | Open the service | overview status badge `s.status ?? s.state ?? 'unknown'` — those fields do not exist on the entity, so always "unknown" | BROKEN | `apps/web/src/app/dashboard/projects/[projectId]/services/[serviceId]/page.tsx:150` |
| 3 | Why did it fail | no failure reason model; deployment row has status only | MISSING | `deployment-execution-workflow.service.ts:333-` (`persistDeploymentExecutionFailure`) stores a message string only |
| 4 | Service Logs tab | sentences synthesized from deployment/container/mesh state; code says "KNOWN GAP — these are not log lines" | FAKE | `.../services/[serviceId]/logs/_utils/service-activity.ts:44-55`; `logs/page.tsx:73-95` |
| 5 | Real log hooks | `useDockerContainerLogsStream` / `useDockerContainerLogsSnapshot` and the viewer components in `app/dashboard/docker/logs/_components` exist, local engine only | REAL, unwired | `apps/web/src/domains/docker/hooks.ts:1030,1044`; docker-cluster.md §1.1 `(audit)` |
| 6 | Build/deploy output | deployment logs viewer polls 4 s, 500 lines; build output not captured | PARTIAL | `deployment-logs-viewer.tsx:37-41`; `docker.service.ts:455` |
| 7 | Metrics | Monitoring page is a one-shot snapshot of `docker.container.list`; `useRealtimeMetrics` (90-point client history) is defined and used nowhere; backend stream polls docker stats every 400 ms | PARTIAL | `.../monitoring/page.tsx`; `apps/web/src/domains/docker/hooks.ts:703`; `runtime/.../docker-container-metrics-stream.service.ts` |
| 8 | Events | `/dashboard/docker/activity` is a real docker event feed but node-local and not service-scoped; `deployment.stream*` and `service.streams.query` are defined, consumed by nothing | PARTIAL | web.md §1 `(audit)` |
| 9 | Exec | container modal terminal + `/dashboard/docker/shell` are real; **every** docker procedure is `requireAuth()` only (a viewer can exec, kill, remove, read env); no audit; local node only | REAL, insecure | `apps/api-services/services/runtime/src/modules/docker/controllers/docker.controller.ts:31-413`; `apps/web/src/app/dashboard/docker/_components/docker-node-context.tsx:12-16` `(audit)` |
| 10 | Act: restart/stop | lifecycle actions call the local engine only; no mesh handler for actions | PARTIAL | `docker-containers-orchestrator.service.ts:121-168`, `docker-mesh-handler-registrar.service.ts:23-217` `(audit)` |
| 11 | Health probing | no scheduler or probes; `healthChecks`, `serviceHealthConfigs`, `healthCheckJobs` tables unused; health registry `changes$` has no subscriber; deploy gate path hard-coded `/health` | MISSING | observability.md §1 `(audit)`; `deployment-execution-workflow.service.ts:491` |
| 12 | Alerts / notifications | settings stored (`slackWebhookUrl`, `emailRecipients`, `notifyOn*`) and shown, nothing sends; identity `sendTestNotification` fabricates a delivery report | MISSING / misleading | observability.md §1,§3 `(audit)` |
| 13 | Who changed what | no audit log; `deployments.triggeredBy` is the only actor record; `core_event_logs` stores typed events without an audit contract | MISSING | `packages/nest/schema/src/global/platform/events.ts:37-72`; parity.md §1.1 `(audit)` |
| 14 | Multi-node | UI shows only the API-hosting node's containers; replicas elsewhere read as "no containers" | BROKEN in a cluster | `docker-node-context.tsx:12-16` `(audit)` |

### Work items

| ID | Work | Size | Depends on |
|---|---|---|---|
| W4.1 | **Real service logs**: tab built from `useDockerContainerLogsStream` per replica merged with `useDeploymentLogs`; follow/pause, search, level colouring, download; replace `projectServiceActivity`. First cut with existing hooks | S–M | — |
| W4.2 | **Keep logs after the container dies**: capture last N MB per replica into `service_logs` (ring) so a crashed replica's output survives `docker rm` | M | — |
| W4.3 | **Node-aware docker procedures**: add `nodeId` to logs/inspect/exec/actions, route over the existing mesh handlers; add the missing action handler | M–L | — |
| W4.4 | **Service status model**: derive from tasks/containers + last deployment (running, degraded, crash-looping, stopped, deploying, failed); expose through the BFF `serviceDetail` composer (`apps/api-services/bff/src/modules/shared/services/overview-composer.service.ts`); web adopts `domains/bff/hooks.ts` (written, unused) | M | — |
| W4.5 | **Failure explainer**: persist `failureKind`, exit code, OOM flag, last health response, last N log lines on the deployment/replica; render the "What's wrong" card | M | W2.4 |
| W4.6 | **Metrics history**: sample every 15 s (mesh agent or runtime), store ring + downsample (1 h at 15 s, 24 h at 1 min), service Metrics tab with limits drawn | M–L | — |
| W4.7 | **Events timeline** per service merging docker events, deployment events, health transitions, config changes (from `core_event_logs`) | M | F4 |
| W4.8 | **Exec hardening**: project maintainer+ or platform admin only; protected platform containers; per-session audit record (who, container, start/end); idle timeout; banner "This session is recorded" | M | F1, W6.8 |
| W4.9 | **Health probes**: scheduler honouring service `healthCheck*` fields, probe on the node that owns the service, store transitions; fix hard-coded `/health` | L | — |
| W4.10 | **Notifications (F4)**: dispatcher on the event bus; channels webhook, Slack/Discord, SMTP, web push; alert rules (service down, restart loop, deploy failed, cert expiring, node down); real `sendTestNotification`; header bell inbox; fix the service worker (register via serwist, add `push` + `notificationclick`, correct manifest) | L (webhook + Slack first: M) | F3, F4 |
| W4.11 | **Audit log / History tab**: append-only `audit_events` written by an ORPC middleware (procedure, actor, resource id, field-level diff for config entities with secret values redacted) + auth hooks; UI filter, export | M–L | F4 |
| W4.12 | **Service actions**: Restart (force-update), Stop/Start, Scale in the header; backend through Swarm `updateService`/`scaleService` (real calls exist in `docker.service.ts:2738-2806`, no caller) | M | F7 |
| W4.13 | Live updates: subscribe lists/overview to `deployment.streamQuery` and `service.streams.query` instead of focus refetch | M | — |

### UX details

- **Log viewer states**: "Container has not started yet" vs "No running replica — showing the last 200 lines from the previous container (exited 2 min ago, code 1)" vs "Logs unavailable: node `n2` is unreachable" (never an empty pane without explanation).
- **Failure copy**: lead with the cause, then actions, e.g. "Crash loop: exit code 137 (out of memory, limit 256 MB). [Raise limit] [View logs] [Rollback]".
- **Progress**: reconnect indicator on streams ("reconnecting… last line 12:04:11") instead of the single global "Live" chip.
- **Exec**: opening a shell on a non-owned service shows "Requires maintainer"; session list shows who is connected.
- **Alerts**: each rule shows last fired / last delivery result; a "Send test" button that really sends; mute with expiry.
- **Undo**: Restart is undoable only by redeploy — say so; Rollback from the failure card; alert mute auto-expires.

### Acceptance criteria

1. A service that prints `BOOM` to stderr and exits 1 shows status "Crash-looping" within 60 s, the card quotes `BOOM`, and the Logs tab contains the exact line (also after the container is removed).
2. Logs for a replica on node 2 render from node 1's UI.
3. Metrics tab shows >= 15 minutes of history after a page reload.
4. A viewer gets 403 on exec/kill/remove/env-read; a maintainer's shell session produces an audit entry with actor and container.
5. A configured webhook channel receives a signed JSON payload within 30 s of `service.down`, and a second delivery is not sent while it stays down (dedupe).
6. History tab lists "<user> changed env var `X` on `web` (production)" without the value.
7. No page in the journey uses `as any` for its mutations or polls where a stream exists.

### E2E outline

`debug-failing-service.spec.ts` — fixtures: `crashingApp` (image that logs `BOOM: missing DATABASE_URL` and exits 1 after 3 s unless `DATABASE_URL` is set), `webhookSink` (HTTP receiver recording requests), `mesh6` for the cross-node step.

1. As admin, deploy `crashingApp`; wait until the service badge reads "Crash-looping" (≤ 60 s).
2. Assert the explainer card contains `BOOM: missing DATABASE_URL` and exit code 1.
3. Open Logs; assert the line is present; `docker rm -f` the replica; reload; assert the line is still there.
4. Open Metrics; assert a chart with ≥ 2 points; wait 30 s, reload, assert history preserved.
5. Open Shell; run `env | grep DATABASE` against a *running* replica of a second fixture; assert output.
6. Configure webhook channel → `webhookSink`; click "Send test"; assert sink received a signed payload. Wait for the crash alert; assert exactly one delivery for the incident.
7. Edit env `DATABASE_URL=postgres://x` via the "Edit env" CTA; redeploy; assert status → Running and alert "resolved" delivered.
8. Open History; assert the env change entry with actor and no value.
9. Sign in as viewer in a second context; assert Shell tab disabled; API `container.exec` returns 403.
10. (mesh6 project) put a replica on node 2; assert its logs render from node 1's UI.

---

## J5. Add, drain, or replace a node in a multi-node cluster

### Ideal end state

Nodes → **Add node** (admin): choose worker/manager and labels (region, tenant); the dialog issues a single-use, 15-minute join grant and shows a one-liner (`curl -fsSL https://<platform>/join/<grant> | sh`) and a QR. The page then shows "Waiting for node… → mesh admitted → swarm joined → ready" live, no page change.

**Drain**: confirmation quantifies impact ("7 tasks will move; managers 3→2; quorum 2/3 stays"), blocks when quorum would be lost, shows tasks leaving with a progress bar, ends at "Safe to remove". **Remove**: leaves swarm, `docker node rm`, mesh revoke, DNS A records dropped, edge connector rescheduled, tunnel token rotated, all in one audited operation. **Replace**: wizard = add new node with the old one's labels → drain old → remove old. A dead node is shown as Down (from the engine), its tasks reschedule, and an alert fires.

Acceptance: node 2 joins in <= 3 minutes from running the one-liner; replicas of a 2-replica service survive draining node 1 with 0 failed requests; removing a node leaves no trace in roster, swarm, DNS or DB; the UI refuses to demote/drain the last manager.

### Current path, step by step

| # | Step | Code path | Status | Evidence |
|---|---|---|---|---|
| 1 | Find "Add node" | none; Network → Mesh explains that you run the wizard on the new machine and choose "Join an existing cluster" | MISSING | `apps/web/src/app/dashboard/network/mesh/page.tsx:116-127` |
| 2 | Get the platform onto the new machine | same as J1 steps 1–3 | BROKEN | J1 |
| 3 | Issue a join grant from the UI | `meshContract.issueJoinGrant` exists; web never calls it (wizard issues it server-side from the entered admin session) | REAL API, no UI | `packages/contracts/fleet/modules/mesh/index.ts:316,474`; grep `issueJoinGrant` in `apps/web/src`, `packages/ui` = none; `apps/api-services/shared/.../remote-initialization.service.ts` (`issueRemoteJoinGrant`) |
| 4 | Wizard remote mode | URL step → auth step → API `remoteAuth` → grant → mesh handshake → swarm join. Setup first founds a throwaway swarm; the API leaves it when it applies the grant (`entryModeFrom` joins only if payload has token + addrs, never true from the UI) | REAL, fragile two-phase | `apps/setup/src/modules/wizard/setup-gate.service.ts:255-297`; setup.md §3.9 `(audit)` |
| 5 | Mesh admission | signed roster CRDT, real; `declaredAddresses` never reach the agent; relay is a stub ⇒ NAT-on-both-sides pairs never converge | REAL / PARTIAL | networking.md §1.1, §3.8 `(audit)` |
| 6 | Swarm role decision | join grant decides manager vs worker with an odd-quorum rule | REAL | `packages/nest/swarm/src/services/swarm-join-grant.service.ts:94-206` `(audit)` |
| 7 | Node shows up | nodes list from mesh presence + fleet; but inventory forces `state: "active"` on every sweep so a crashed node stays "active"; `cluster_node_metrics` has no unique key (duplicate rows) | PARTIAL | docker-cluster.md §1.2, §3.5 `(audit)` |
| 8 | Drain / activate / pause | no contract procedure; the engine primitive exists and has no remote caller | MISSING | `packages/contracts/fleet/modules/cluster/index.ts:204-219` (only `updateNode` labels); `packages/nest/docker/src/services/docker.service.ts:3032` |
| 9 | Change role / ingress label | page calls `updateNode.mutate` immediately; the quorum-aware table and confirm dialog exist and are imported nowhere; the `control/worker` label has no scheduling effect | BROKEN (unsafe) | `apps/web/src/app/dashboard/cluster/page.tsx:63,82-86`; `cluster/_components/cluster-nodes-table.tsx` (dead) |
| 10 | Remove node | UI text: "Removing them needs an API that does not exist yet"; no `node rm`; mesh revoke exists and is real but cleans nothing else | MISSING | `apps/web/src/app/dashboard/nodes/page.tsx:135`; `.../network/_components/mesh-members-table.tsx:101`; grep `nodeRm\|node rm` in `packages`, `shared` = none |
| 11 | Workloads follow the node | default runner is the plain docker runner (node-local); swarm runner not selectable; images are not pushed to a registry, so a task rescheduled elsewhere cannot pull | BROKEN | J2 steps 9, 21; deployments.md §1 `(audit)` |
| 12 | Join secrets | worker **and manager** join tokens are returned to every authenticated user in the snapshot and swarm-config view; the web panel reads `view.joinTokens` | BROKEN (critical) | `packages/contracts/entities/src/entities/swarm/cluster.schema.ts:75`; `packages/nest/swarm/src/services/swarm-cluster.service.ts:165,208`; `swarm-participation.service.ts:426-445`; `apps/web/src/app/dashboard/cluster/_components/swarm-config-panel.tsx:94` |
| 13 | Authz on cluster/fleet | every `cluster.*` handler is `requireAuth()` only | BROKEN | `apps/api-services/services/fleet/src/modules/cluster/controllers/cluster.controller.ts:19-131` |
| 14 | Quorum safety | none in the product path; election is per-node SQLite CAS with constant metrics | BROKEN/facade | docker-cluster.md §1.2 `(audit)` |
| 15 | Manager-only operations | node/label updates run against the local engine; on a worker they fail; no routing to a manager | MISSING | docker-cluster.md §4 `(audit)` |

### Work items

| ID | Work | Size | Depends on |
|---|---|---|---|
| W5.1 | Remove `joinTokens` from `getSnapshot`, `streamSnapshot`, `getSwarmConfig`; expose only via an admin "issue join" procedure (the grant flow exists) | S | P0 #5 |
| W5.2 | `requirePlatformRole(["superAdmin","admin"])` on all `cluster.*` mutations and fleet capacity/allocation/admission resolution | S | F1 |
| W5.3 | **Add node dialog**: admin-only; calls `mesh.issueJoinGrant` with role + labels; shows one-liner + QR; grant status; live stages from mesh SSE + `cluster.streamNodes` | M | W1.2 |
| W5.4 | Installer **join mode** (`install.sh --join <bundle>`): bundle = mesh URL + grant + swarm hint; pre-flight; pulls mesh-agent + setup; no wizard needed | M | W1.2 |
| W5.5 | **Node lifecycle procedures** in the fleet cluster contract: `drainNode`, `activateNode`, `pauseNode`, `promoteNode`, `demoteNode`, `removeNode({force})`; quorum pre-check using the existing planner (`packages/nest/swarm` quorum planner); route to a manager over the mesh when the local engine is a worker; add `docker.getNode(id).remove` wrapper | M–L | F1 |
| W5.6 | **Drain progress**: tasks-per-node view (`cluster.streamTasks` exists) with "safe to remove" state | S–M | W5.5 |
| W5.7 | **Remove saga**: drain → demote if manager → `node rm` → mesh revoke → delete `node_network_config` row → drop DNS A records (direct edge) → reschedule edge connector / rotate tunnel token → audit entry; idempotent and resumable | M–L | W5.5, F4 |
| W5.8 | Use the guarded cluster table + confirm dialog on `/dashboard/cluster` (delete the unsafe inline table); make `deployer.node.role=control` a real placement constraint for user workloads | M | W5.5 |
| W5.9 | Truthful node health: map engine `Status.State` and `Spec.Availability`, stop forcing `active`, unique upsert for node metrics, real CPU/memory instead of mislabelled link metrics | M | — |
| W5.10 | **Replace node** wizard: add (copy labels/region) → wait ready → drain old → remove old, as a checklist with per-step status | M | W5.3, W5.7 |
| W5.11 | Swarm default runner (F7) + registry push/digest pull so tasks reschedule | L | F5 |
| W5.12 | Mesh: pass `declaredAddresses` to the agent; relay-over-session or an explicit "both sides behind NAT unsupported" pre-flight; salt retry on address collision; wire `leave` | M–L | — |
| W5.13 | Node-down/joined/drained notifications; backup of founder/roster/Postgres before removing the last manager | M / L | W4.10, P0 #10 |

### UX details

- **Empty state** on a one-node cluster: "Add a second node to run replicas and survive a server failure" + the join command inline.
- **Join dialog**: grant expires countdown, "Regenerate", revoke; stages checklist with timestamps; if nothing happens for 2 min, show the three likeliest causes (UDP 51820 blocked, clock skew, Docker < 24).
- **Drain confirmation** states counts: tasks to move, volumes that are node-local and will **not** move ("`db-data` lives only on this node"), manager count before/after; disabled with reason when quorum would break.
- **Failure**: "Cannot remove: node still hosts 2 tasks — drain first" with a button; engine errors translated, not pasted.
- **Undo**: Drain → "Re-activate"; Remove is final — require typing the node name; Replace keeps the old node until the new is ready.

### Acceptance criteria

1. As admin I can add a worker from the UI in <= 3 minutes after running the one-liner on a fresh VM; as a viewer, the Add/Drain/Remove controls are absent and the procedures return 403.
2. No API response or log line for a non-admin contains a join token.
3. Draining a node moves all its replicated tasks; a 2-replica HTTP service has 0 failed requests during the drain (probed at 10 req/s).
4. Demoting/draining/removing the last manager is refused with the quorum explanation.
5. After removal: node absent from `docker node ls`, mesh roster (state `left`/revoked), fleet servers list, DNS provider A records, `node_network_config`.
6. A node whose engine is stopped shows Down within 60 s (not "active") and an alert is sent.

### E2E outline

`node-lifecycle.spec.ts` — fixtures: `mesh6` (`infra/docker/compose/docker-compose.mesh-6.dev-supervised.yml`: six nodes as sibling containers), `nodeShell` (helper to `docker exec` into node N), `prober` (HTTP load generator recording failures), `mockCloudflare` for DNS/tunnel cleanup.

1. Sign in on node 1 UI; Nodes page shows 1 node + "Add a second node" empty state.
2. Click Add node (worker, region=eu); assert grant countdown and one-liner; run the one-liner in node 2 via `nodeShell`.
3. Assert stages tick (mesh admitted → swarm joined → ready) ≤ 180 s; node 2 appears with label region=eu.
4. Deploy 2-replica fixture service; assert one task on each node; start `prober`.
5. Drain node 1's worker pair target (node 2); assert confirmation dialog shows task count; confirm; assert tasks move, `prober` failures == 0, status "Safe to remove".
6. Try to demote the only manager; assert refusal text mentions quorum.
7. Remove node 2 (type its name); assert absent in UI, `docker node ls`, roster, DNS fixture; audit entry exists.
8. Stop node 3's Docker engine; assert Down within 60 s and webhook alert.
9. Replace flow: replace node 3 with node 4; assert checklist completes and labels copied.
10. As viewer: controls absent; `cluster.getSwarmConfig` response has no token fields (JSON schema assertion).

---

## J6. Team collaboration: invite, roles, approvals, audit

### Ideal end state

Settings → Members (admin): Invite by email + platform role + optional project grants → an email with a link (or a copyable link when SMTP is not configured) → invitee sets a password or passkey → lands on a dashboard scoped to what they can see. Project → Team: invite someone who has no account yet (pending invite, resend/revoke). Roles are explained by a permission matrix; the UI adapts (viewers see no destructive buttons and get "request access" empty states; non-members cannot see a project at all). **Approvals**: when a project requires approval for production, a production deploy (from UI, webhook or API) becomes `awaiting_approval`, notifies approvers, and runs only after a maintainer/owner approves (comment, expiry, no self-approval unless the sole owner). **Audit**: every mutation is recorded (actor, IP, resource, redacted diff), filterable, exportable, retained per policy; role change or ban revokes sessions immediately.

### Current path, step by step

| # | Step | Code path | Status | Evidence |
|---|---|---|---|---|
| 1 | Sign-up policy | `emailAndPassword: { enabled: true }` with no `disableSignUp`; only the web UI hides sign-up in production (build-mode check) | BROKEN (critical) | `packages/auth/src/server/auth.ts:117`; `apps/web/src/app/auth/_utils/dev-only.ts` `(audit)` |
| 2 | Platform invite (server) | `useInvite()` discards every option except duration, so `canCreateInvite` is never set; any session can create an invite for any role including `superAdmin`, token returned in the response | BROKEN (critical) | `packages/auth/src/server/plugins/index.ts:136-146`; `plugins/invite.ts:121,147,213,321` `(audit)` |
| 3 | Invite UI | none; `authClient.invite.*` unused; admin `createUser` endpoint is defined but no page calls it | MISSING | `apps/web/src/domains/admin/endpoints.ts:103`; grep `authClient.invite` in `apps/web/src` = none |
| 4 | Accept invite | no `/auth/invite` page; sign-in says "ask for an invitation" | MISSING | web.md §1 `(audit)` |
| 5 | Email delivery / reset / verify | no mail transport anywhere | MISSING | auth.md §1 `(audit)` |
| 6 | Project invite | requires an existing user (`NotFound` otherwise); membership is immediate (no pending state, no email) | PARTIAL | `project.service.ts:165-206` |
| 7 | Role hierarchy on project | `assertNotOwnerGrant` is defined and never called; invite/update accept `owner` via the role enum; a maintainer (admin access) can modify/remove other maintainers | BROKEN | `apps/api-services/services/project/src/modules/project/domain/project.entity.ts:~212`; `project.service.ts:165-228` |
| 8 | Visibility | `listProjects`, `getProjectById`, `listServices`, `getServiceById` (incl. env vars), streams, deployments, logs are not membership-scoped | BROKEN | `project.service.ts:63-73`; `service.service.ts:88-102` |
| 9 | Role-aware UI | only platform-role gating (`lib/access/platform-role.rules.ts`); no project-role awareness; viewers see Delete/Deploy/Rollback/exec | MISSING | web.md §3.7 `(audit)` |
| 10 | Approvals | `requireApprovalForProduction` is saved and resolved, and read by nothing that blocks a deploy; there is no `awaiting_approval` status or approver model | MISSING | `shared/.../configuration-resolver.service.ts:733,814`; `packages/contracts/common/src/platform-domain.schema.ts:4` |
| 11 | Audit | no table, writer or UI | MISSING | parity.md §1.1 `(audit)` |
| 12 | Session effect of role/ban | cookie cache keeps role/ban for up to 5 min; identity `setBanned` is a raw DB write that revokes nothing | BROKEN | auth.md §1 `(audit)` |
| 13 | Team page | shows `userId` instead of name/email | PARTIAL | `projects/[projectId]/team/page.tsx:86` `(audit)` |

### Work items

| ID | Work | Size | Depends on |
|---|---|---|---|
| W6.1 | P0 auth: `disableSignUp: true` (keep dev sign-up behind a dev-only flag), `canCreateInvite` = admin only, invited role <= caller role, token not returned to non-admins, fix null/undefined filters, atomic `validate`; add tests for each | S–M | P0 #3 |
| W6.2 | Members page + Invite dialog (email, platform role, optional project grants), pending list with resend/revoke/copy link, `/auth/invite?token=` accept page (password or passkey) | M | W6.1 |
| W6.3 | Mail transport (SMTP/Resend) with a "not configured" mode that surfaces copyable links; password reset + email verification | M | — |
| W6.4 | Project invites for non-users (pending row claimed on sign-up/accept); call `assertNotOwnerGrant`; add "cannot grant >= own role / cannot modify equal or higher"; ownership transfer operation | S–M | — |
| W6.5 | Authz policy layer (F1) and membership scoping on every list/get/stream (platform admins excepted) | L | P0 #5 |
| W6.6 | Project-role-aware UI: `useProjectPermissions(projectId)`, `<RequireProjectRole>` mirroring the existing platform components; hide/disable destructive controls; "You are a viewer" badge | M | W6.5 |
| W6.7 | **Approvals**: status `awaiting_approval`; `deployment_approvals(deployment_id, requested_by, decided_by, decision, comment, decided_at, expires_at)`; gate in `deployment.trigger` and webhook/system-actor path; approver rules; notification; approvals inbox + banner on service header; expiry | M–L | F3, W4.10 |
| W6.8 | **Audit log**: `audit_events` fed by an ORPC middleware (every mutation) + Better Auth hooks + terminal sessions; field-level diff with secrets redacted; `/dashboard/settings/audit` with filters, per-resource History tab, CSV/JSON export, retention setting | M–L | F4 |
| W6.9 | Revoke sessions on role change/ban in Better Auth and identity service; bypass the cookie cache for role-sensitive checks | S–M | — |
| W6.10 | Team page UX: name/email/avatar, last active, pending state, role descriptions, confirm role changes with before/after | S–M | — |
| W6.11 | 2FA completion (enrolment, challenge, backup codes) and an "require 2FA for admins" policy | M | — |
| W6.12 | Decide organizations (README §6.3). If single-tenant: document "workspace = platform" and delete org promises from docs; if not, a new L epic | decision | — |

### UX details

- **Invite dialog** shows a role table (what each role can do) and a live "this person will be able to…" sentence; errors are specific ("No account for that email — an invitation will be sent instead").
- **Pending state** everywhere (Members and Team): badge, resend, revoke, expiry date.
- **Approvals**: card "Deploy abc123 to production requested by @dev 2 min ago — commit range, env changes — [Approve] [Reject]"; requester sees "Waiting for approval from maintainers (expires in 23 h)"; rejected shows the comment.
- **Audit rows** read as sentences ("Alice changed env var `DATABASE_URL` on `api` (production)") with an expandable redacted diff; values never displayed.
- **Undo**: revoke invite; role change shows "Undo" for 10 s (writes the inverse change and an audit entry); audit itself is immutable.
- **Empty states**: non-member project URL → "You don't have access. Ask an owner" (not a leak of existence); no members → "Invite your first teammate".

### Acceptance criteria

1. `POST /api/auth/sign-up/email` returns 4xx in production config; creating an invite as a non-admin returns 403; an admin cannot invite a role above their own.
2. An invited user with no prior account can accept via emailed (or copied) link, sets a password, and sees only projects they were granted.
3. A non-member gets 404/403 on `project.findById`, `service.findById`, `deployment.list`, logs and streams for a project they are not in.
4. A viewer sees no Delete/Deploy/Rollback/Exec controls; the same actions return 403 via API.
5. With `requireApprovalForProduction` on, a production deploy from UI **and** from a webhook stays `awaiting_approval` until a maintainer approves; the requester cannot approve their own (unless sole owner); approval triggers the build.
6. Every mutation in the journey produces exactly one audit row with actor, resource and redacted diff; audit export matches the on-screen filter.
7. Demoting or banning a user terminates their sessions within 5 s.

### E2E outline

`team-collaboration.spec.ts` — fixtures: `mailpit` (SMTP sink + API), `stack`, two or three Playwright browser contexts (`admin`, `dev`, `viewer`).

1. Admin: Members → Invite `dev@example.test` as `operator` with project grant `deployer` on `shop`; assert pending row.
2. Read the invite email from `mailpit`; `dev` context opens the link, sets password; assert dashboard shows only `shop`.
3. Admin invites `viewer@example.test` (no account yet) from the project Team page as `viewer`; assert pending; accept in `viewer` context.
4. `viewer`: assert no Deploy/Delete/Shell controls; API calls return 403; direct URL to another project shows the no-access state.
5. Project settings: enable "Require approval for production". `dev` triggers a production deploy; assert status `awaiting_approval` and no build log.
6. Admin (approver) opens banner → Approve with comment; assert deployment proceeds and reaches `success`; assert `dev` cannot approve own request.
7. Push via webhook fixture to a production-bound branch; assert it too becomes `awaiting_approval`.
8. Admin demotes `dev` to `viewer`; `dev` context's next API call returns 403 within 5 s without re-login.
9. Open Audit; filter by project `shop`; assert rows for invite, role changes, deploy request, approval, demotion; export CSV and compare row count.
10. Negative: unauthenticated `POST /api/auth/sign-up/email` → 4xx; non-admin `invite/create` → 403.

---

## 7. Quick wins (< 1 day each)

Ordered by journey impact. "P0" marks items that are also in the audit README P0 list.

| # | Win | Where | Journeys | Notes |
|---|---|---|---|---|
| 1 | Domain Verify: pass the real requester | `project-domain.controller.ts:~67-72`, `domain-project.service.ts:176` | J3 | unblocks the whole domain flow; add a controller test |
| 2 | Show verification instructions returned by `addProjectDomain` (post-add panel) on the project domains page and add a Verify button | `projects/[projectId]/domains/page.tsx:35-41`, `ProjectDomainRow.tsx` | J3 | pairs with #1 |
| 3 | PR → service: use the existing `findServiceBySourceUrl` instead of `full_name` | `fleet/.../github.webhooks.controller.ts:138-140`, `github-apps.repository.ts:255` | J2 | port of monolith fix `apps/api/.../github.webhooks.controller.ts:212-222`; preview still needs W2.10 |
| 4 | Admin bootstrap default `never`; remove `adminadmin` fallbacks | `apps/api/src/core/admin-bootstrap/admin-bootstrap-policy.ts:~101`, `api-services/shared/.../default-admin.bootstrap.ts:48,50` | J1 J6 | P0 #2 |
| 5 | `disableSignUp: true` (dev behind a flag) and pass `canCreateInvite` | `packages/auth/src/server/auth.ts:117`, `plugins/index.ts:136-146` | J6 | P0 #3 |
| 6 | Strip `joinTokens` from snapshot/swarm-config responses | `swarm-cluster.service.ts:165,208`, `swarm-participation.service.ts:426-445`, `swarm-config-panel.tsx:94` | J5 | P0 #5 |
| 7 | `requirePlatformRole(["superAdmin","admin"])` on docker exec/terminal/kill/remove and all `cluster.*` mutations | `docker.controller.ts:240-290,…`, `cluster.controller.ts:19-131` | J4 J5 | one `.use()` per handler; add a 403 test per controller |
| 8 | Remove the `nginx:alpine` fallback so a missing image **fails** with a message; default builder to `dockerfile` when a `Dockerfile` exists | `docker-runtime-runner.service.ts:38`, `swarm-runtime-runner.service.ts:99`, `deployment.service.ts:457` | J1 J2 | P0 #7, first half |
| 9 | Rollback must not lie: until W2.2, fail with "not supported" instead of marking `success`; in the UI pick the previous successful deployment and send `targetDeploymentId` | `deployment.service.ts:1396-1411`, `deployments/page.tsx:138-144` | J2 | stops a silent no-op |
| 10 | Real service logs first cut: replace `projectServiceActivity` with `useDockerContainerLogsSnapshot` + `useDeploymentLogs` | `logs/page.tsx`, `logs/_utils/service-activity.ts`, `domains/docker/hooks.ts:1030,1044` | J4 | local node only; label it |
| 11 | Build output into deployment logs: pass `onProgressLine` from `buildImage` to `insertLog` | `docker.service.ts:455` (`followStream` already takes the callback, `:1152`), `deployment-artifact-builder.service.ts:~175` | J1 J2 J4 | big debuggability gain for little code |
| 12 | Service overview status from the latest deployment instead of phantom fields | `services/[serviceId]/page.tsx:150` | J4 | or use BFF `serviceDetail` |
| 13 | Env "Config" link: pass environment id | `configuration/environment/page.tsx:165-166` | J2 | |
| 14 | Seed default environments in `createProject` | `project.service.ts:75-100` | J1 J2 | also fixes "No environments defined" |
| 15 | Docker runner: attach to the platform overlay when `networkMode` unset; stop prior containers of the same service after the new one is healthy | `docker-runtime-runner.service.ts:60,73` | J1 J2 | stopgap until F7 |
| 16 | Wire `ClusterNodesTable` (quorum confirm) into `/dashboard/cluster`, delete the inline table | `cluster/page.tsx:63-86` | J5 | |
| 17 | Require `DEPLOYER_TRAEFIK_ACME_EMAIL` when a public TLS lane is enabled; no `admin@example.com` default | `packages/config/env/src/index.ts:255` | J3 | |
| 18 | Use `projects/_utils/trigger-source.ts` in the deploy page and drop `as any` | `deployments/page.tsx:96-114` | J1 J2 | file is written and unused |
| 19 | Show the computed lane URL (`<service>-<project>.<lane domain>`) next to a deployment/service | `deployment-detail.tsx:60`, lane config | J1 | |
| 20 | Team page: show email/name instead of `userId`; call `assertNotOwnerGrant` on invite/update | `team/page.tsx:86`, `project.service.ts:165-228` | J6 | |
| 21 | Delete the `custom domain` free-text path or force it through verification | `platform-routes-source.service.ts:233`, `StepDomains.tsx:145` | J3 | |

---

## 8. Which P0 items block which journey

Legend: **●** hard blocker (journey cannot be completed correctly or safely), **○** weakens it. Numbers are the audit README §4 P0 list; P1 numbers are prefixed.

| P0 item | J1 install | J2 ship | J3 domain | J4 debug | J5 nodes | J6 team |
|---|---|---|---|---|---|---|
| 1 Rotate/remove committed secrets (tracked `200`, `.env.prod`, `PG`, `api.log` still in `git ls-files`) | ○ | | | | | ○ |
| 2 Kill backdoors (default admin, master token) | ● | | | | | ○ |
| 3 Close sign-up and invites | ○ | | | | | ● |
| 4 Lock `/setup/*` + claim token | ● | | | | ○ | |
| 5 Central authorization layer | ○ | ● (reads/env) | ● (DNS/CF) | ● (exec/kill) | ● (join tokens, cluster) | ● (scoping) |
| 6 Injection (unzip, tar, branch, labels) | | ● (upload, branch option) | | | | |
| 7 Honest deploys | ● | ● | | ● | ○ | |
| 8 One topology (monolith vs tier) | ● | ○ | | | ● | |
| 9 Migrations fatal + lock | ○ | | | | | |
| 10 Backups | ○ | | | | ○ (founder removal) | |
| 11 Reproducible install / images | ● | ○ | ○ (ACME email) | | ● (new node install) | |
| 12 Green gate | ○ | ○ | ○ | ○ | ○ | ○ |
| P1 13 Webhooks & previews | | ● | | | | |
| P1 15 Swarm default runner + registry | | ○ | | ○ | ● | |
| P1 16 Env/secrets | | ● | | | | ○ |
| P1 17 Notifications | | | ○ (cert expiry) | ● (alerts) | ○ | ● (approvals) |
| P1 18 Health monitoring | | ○ | | ● | ○ | |
| P1 19 Domains | | | ● | | | |
| P1 20–21 Cluster ops, mesh gaps | | | | | ● | |
| P1 22 Auth completeness (mail, invite UI) | ○ | | | | | ● |
| P1 24 Frontend fixes | ○ | ● | ○ | ● | ● | ● |

Reading it: **J1** and **J5** are gated by the installer/topology items (#8, #11); **J2** by honest deploys + webhooks + secrets; **J3** by authz + domain correctness; **J4** by build-log/status honesty and notifications; **J6** by auth P0s and the authorization layer.

---

## 9. Audit claims re-verified

### Confirmed in code today

- `nginx:alpine` fallback in both runners (`docker-runtime-runner.service.ts:38`, `swarm-runtime-runner.service.ts:99`); builder returns the null fallback (`deployment-artifact-builder.service.ts:65-67`).
- Rollback UI omits `targetDeploymentId` (`deployments/page.tsx:141` vs `crud.ts:233-236`); services-fork rollback completes without invoking a runner (`deployment.service.ts:1396-1411`).
- Cancel is a DB flip with no guards (`deployment.service.ts:566-623`); queue is an in-process `Map` (`deployment-queue-lifecycle.service.ts:44-45`); reconcile only handles `building` (`deployment-queue-reconciliation.service.ts:78`).
- GitHub webhook: push skipped (`github.webhooks.controller.ts:78`), placeholder service id (`:138-140`), secret key with no writer (`github-apps.repository.ts:175-186`), HMAC over re-serialised JSON (`github-webhook-auth.middleware.ts:188`).
- Domain verification: requester passed as `"verify"` (`domain-project.service.ts:176`); instruction/verifier mismatch; failed rows never retried.
- Admin bootstrap default `always` with `adminadmin` fallback; no setup claim token; sign-up open; invite options dropped (`plugins/index.ts:136-146`).
- Join tokens in cluster snapshot; no drain/promote/remove contract; guarded cluster table dead.
- Service logs fake; service status always "unknown"; env "Config" link bug; project/service reads unscoped; no default environments; `assertNotOwnerGrant` uncalled; approvals unenforced; project deploy page is the only deploy entry.
- Web push: `sw.ts` is a bare precache, no serwist integration in `next.config.ts`.

### Stale or wrong in the audit

| Claim | Reality |
|---|---|
| setup.md §3.8: `deployer-bff` and `svc-bff` both run; `provision_api` step creates a second BFF | Removed: grep for `provision_api`, `BffServiceProvisioner`, `deployer-bff` in setup, shared, bff = no hits; `docs/API-CUTOVER-STATUS.md` §0b documents the removal |
| parity.md §1.3 Rollback = REAL, Cancel = REAL, Retry = REAL | Rollback is invalid from the UI and a no-op in the live tier; cancel does not cancel; retry drops env and plan (`deployment.service.ts:932-950`) |
| parity.md §1.3 GitHub webhooks (push, PR previews) = REAL; Preview environments = REAL; ZIP upload = REAL | webhooks always 401 and push is skipped; previews never build; no upload UI (deployments.md is right, parity.md is wrong) |
| web.md §2 "What works end to end": trigger → logs → retry/rollback/cancel/delete | trigger yields an `nginx:alpine` success; rollback body invalid; see J2 |
| networking.md §1.4 says the Domains table shows the correct TXT name | true only on `/dashboard/network/domains`; `/dashboard/projects/[id]/domains` shows no instructions and no Verify |
| docs/feature-gap-catalogue D-1 "no rollback flow" (called false by parity.md) | the monolith has one; the live tier has a record-only flow. Neither claim is right for the product |
| Several deployments.md items marked BROKEN | already fixed in the **monolith** tree (uncommitted): push trigger source, PR→service resolution (`apps/api/src/modules/deployment/triggers/*`, `apps/api/.../github.webhooks.controller.ts:212-222`). The live tier lacks them; the work is a port plus the system actor |

### New findings (not in any audit)

1. Deployment `environment` is a strict 4-name enum (`environment.schema.ts:60` → `crud.ts:93`) while the UI and environments feature advertise free-form names.
2. Ingress hosts are frozen at deploy time from `deployments.domainUrl` (`platform-routes-source.service.ts:228-229`) and no mapping change refreshes ingress; consequence: a custom domain needs a redeploy; with no mapping the UI shows no URL although the lane route exists (`:236`, `domain-routing.service.ts:143-145`).
3. `service.customDomains` bypasses domain verification and becomes a public host (`platform-routes-source.service.ts:233`).
4. Retry drops `runtimeConfiguration` (env vars) as well as `executionPlan` (`deployment.service.ts:932-950`).
5. Fake rollback rows are silently ignored by routing because they carry no `containerName` (`platform-routes-source.service.ts:224-225`), so a "rollback success" changes nothing the user can see.
6. The GitHub App manifest flow needs a reachable public URL (`github-account.controller.ts:201-217`): on a fresh VPS the PAT/deploy-key path must be the first-run default, and J2 depends on J3's public address.
7. `buildImage` already has a per-line progress mechanism (`docker.service.ts:1152`); build logs are plumbing, not research.
8. Unused assets that shorten the work: BFF screen procedures + `apps/web/src/domains/bff/hooks.ts`, `useRealtimeMetrics`, `projects/_utils/trigger-source.ts`, `PreviewEnvOverlayService`, `SwarmComposeRealizerService`, `WebhookIdempotencyService.claim()`, guarded cluster table, admin `createUser`, `mesh.issueJoinGrant`, swarm service scale/remove/rollback wrappers (`docker.service.ts:2738-2806`).
9. Production compose builds the API image from source on the VPS (`docker-compose.prod.yml:40`), incompatible with a 5-minute install regardless of other fixes.
10. No Playwright or browser e2e exists anywhere in the repo (no `playwright` dependency in any `package.json`); API e2e are Vitest + testcontainers (`apps/api/src/e2e`, `apps/api-services/bff/src/e2e`).

---

## 10. Shared e2e harness (F8) and suggested sequencing

### Harness

- New workspace `apps/e2e` (Playwright Test). One project per journey, tagged `@nightly` for J1/J5 (need VM or DinD) and `@pr` for the rest.
- `stack` fixture drives `bun scripts/compose.ts --file docker-compose.services.dev-supervised.yml` (tier profile) and completes setup through the API so non-J1 specs start signed in; J1 uses the real installer.
- Support containers (one compose file): `gitea` (git host + webhooks), `pebble` + challenge test server (ACME), a scriptable authoritative DNS, `mailpit` (SMTP + API), `mock-cloudflare` (the endpoints `cloudflare.controller.ts` uses), `webhook-sink` (alert receiver). No real GitHub/Cloudflare/Let's Encrypt in CI.
- J5 uses `infra/docker/compose/docker-compose.mesh-6.dev-supervised.yml` plus `apps/mesh-agent/scripts/e2e-netns.sh` patterns for NAT.
- Rules: selectors by role/label (the web already has 451 `aria-*` usages), trace on first retry, per-journey time budget asserted as a test (J1 <= 5 min), video only on failure.

### Sequencing (one team)

| Phase | Weeks | Contents | Journeys unblocked |
|---|---|---|---|
| 0 | 1 | Harness skeleton + quick wins 1–9, 14, 16, 17 | prevents regressions; J3 verify works; P0 #2/#3/#5 slices |
| 1 | 2–5 | F2 honest deploy (W2.1, W2.12, W2.4, W2.5, W2.2), W2.11 (encryption + masking), W4.1/W4.4/W4.5, F1 core | J2 (without webhooks), J4 core |
| 2 | 4–8 | F5 + W1.1–W1.7 installer/images/claim/address, W3.2–W3.5 + W3.8 domains/TLS | J1, J3 |
| 3 | 6–10 | F3 + W2.8–W2.10 webhooks/previews, F4 + W4.10/W4.11/W6.8 notifications + audit, W6.1–W6.7 team/approvals | J2 full, J4 alerts, J6 |
| 4 | 8–13 | F7 + registry, W5.3–W5.10 node lifecycle, W4.6/W4.9 metrics + probes, W5.12 mesh gaps | J5, J4 full |

### Decisions the operator must make first (they change the plan)

1. Installer script vs CLI (J1, J5): script first is cheaper and the CLI can wrap it.
2. Organizations in or out (J6): if out, "team" = platform roles + project roles and the docs/AGENTS.md promise must be deleted; if in, add an L epic.
3. Relay vs documented NAT limitation (J5): the mesh-first principle favours relay; until then add an honest pre-flight.
4. Which backend survives (J1, J5): everything above assumes the BFF tier and deleting `apps/api`.
5. Single- vs multi-tenant: decides whether quotas/billing appear in J6; this report assumes single-tenant.
