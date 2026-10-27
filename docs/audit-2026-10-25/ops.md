# Ops / Production-readiness / Quality audit — deployer v3 (branch rewrite-v3, 2026-10-25)

Method: files read directly (Read/Grep). Docs, plans and comments were treated as claims, not facts. Items marked **UNVERIFIED** were not exercised at runtime. Paths are relative to `/home/sebille/Bureau/projects/tests/deployer/v3`.

Caveat on my own run: I ran `bun run lint:check` once in `apps/api-services/bff`. It **auto-fixed 6 files** (see finding R-14) and I reverted those 6 files with `git checkout`. Working tree is otherwise as found (about 2860 changed entries).

---

## 0. Repo state in one paragraph

The repo is in the middle of a monolith → BFF + 5 services split. `apps/api` (803 src files, 176 spec files) still ships, and `apps/api-services/{shared,bff,services/*}` is the new tier. The two are **diverged copies of the same code**: `diff -rq apps/api/src/core apps/api-services/shared/src/core` differs in dozens of files. `docker.repository.ts` is 4290 lines in the monolith and 4286 in `services/runtime`. `deployment.service.ts` is 2508 and 2479 lines. Git shows 2861 changed entries (1677 modified, 1060 deleted, 124 untracked). Whole new contract packages (`packages/contracts/{bff,fleet,health,identity,project,runtime}`) are still untracked. The last commit is `b990e8dc`.

---

## 1. Inventory (REAL / PARTIAL / MISSING)

| Capability | Status | Evidence |
|---|---|---|
| Health / liveness endpoint | REAL | `apps/api/src/main.ts:51-53` `/health` answers before Nest boots and is dependency-free |
| Readiness endpoint | REAL | `apps/api/src/main.ts:70-100` `/health/ready` via `READINESS_PROBE`, 503 while starting |
| Graceful shutdown | REAL | `main.ts:130-230`: drain HTTP, `app.close()`, 30s force-exit timer, SIGINT/SIGTERM/uncaught/unhandled. Swarm `stopGracePeriodSeconds` 60 for Postgres (`postgres-service.provisioner.ts`) |
| Process-level hardening in image | PARTIAL | API image: `USER nestjs`, HEALTHCHECK (`Dockerfile.api.prod:371-389`). Web/doc: `USER nextjs`, HEALTHCHECK, dumb-init. Setup image: no USER, no HEALTHCHECK in Dockerfile (compose has one). Unified deployer image: no USER, no HEALTHCHECK (`builder/deployer/Dockerfile.prod:303-306`). Mesh agent: no USER, no HEALTHCHECK |
| Env validation | PARTIAL | Zod schemas in `packages/config/env/src/index.ts` (878 lines) and `apps/setup/src/config/env/env.schema.ts`. Security-critical vars are all `optional()`: `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `DEV_AUTH_KEY`, `DEFAULT_ADMIN_PASSWORD` (`index.ts:188-193`). No min length, no format check, no production-required refinement |
| Secrets encrypted at rest | PARTIAL (defective) | AES-256-GCM + per-value scrypt in `packages/nest/schema/src/codecs/codec-registry.ts:41-110`. Applied to env vars, GitHub app secrets, DNS creds, cluster secret material, webhook secrets, GitLab token. **Key derivation is broken (R-02)**. No key id/versioning, no rotation tool |
| Auth (Better Auth) | PARTIAL | `packages/auth/src/server/auth.ts`. Passkey, TOTP, API keys, device auth, multi-session present. **Open sign-up with client-settable role (R-01)**, static master token (R-05) |
| Rate limiting | PARTIAL / near MISSING | Custom in-memory limiter used on only 2 routes: health (`apps/api/src/modules/health/controllers/health.controller.ts:41`) and platform app-instance register (`platform.controller.ts:41`). Nothing on login, webhooks, setup, uploads, deploy triggers. Better Auth built-in limiter left at defaults. Traefik rate-limit middleware exists in the library only |
| CORS | REAL | `apps/api/src/core/utils/cors.utils.ts`, `app.config.ts:64-100`: allow-list with credentials, token path reflects origin without credentials. Sound design |
| Security headers (CSP, HSTS, XFO, nosniff) | MISSING | No `helmet`, no `headers()` in `apps/web/next.config.ts`, no CSP anywhere in app code. Only Traefik middleware-library definitions (`traefik-middleware-library.service.ts`), not applied to the platform's own routes |
| Webhook verification (GitHub) | PARTIAL | `apps/api-services/services/fleet/.../github-webhook-auth.middleware.ts:80-165`: fails closed, uses `@octokit/webhooks-methods` timing-safe verify. But HMAC is computed over `JSON.stringify(input.body)` (re-serialised, not raw bytes) at line ~178, idempotency is an in-memory Map, and it uses a single global secret `getWebhookSecret()` |
| Webhook verification (GitLab) | MISSING | `gitlab-provider` schema exists (`schema/src/global/fleet/gitlab-provider.ts`); no GitLab webhook handler or `X-Gitlab-Token` check found in api-services |
| Input validation | PARTIAL | Zod contracts via ORPC everywhere. `bodyParser:false` and no explicit body-size limit anywhere (`app.config.ts:55`, grep for `limit:`/`express.json` found none) |
| Command / path injection | PARTIAL | Mesh agent and setup use `Bun.spawn([cmd, ...args])` with no shell (good, `mesh-agent/src/command-runner.ts`). **`git.service.ts:135` `execSync(\`unzip -q "${filePath}" ...\`)` and tar path traversal (R-06)** |
| SSRF controls | MISSING | No URL allow/deny logic found for git clone URLs (`git.service.ts:33` clones whatever URL, on the API host), webhooks, or provider URLs. `ext::`/`file://` are blocked by simple-git defaults only |
| Docker socket exposure | PARTIAL (high-risk by design) | Mounted read-write into the setup container, the API swarm service (`api-service-provisioner.service.ts:323`), the BFF and every service-tier task (`services-tier-provisioner.service.ts:428`, shared mount list), and the bootstrap ingress (`:ro`, which does not restrict a socket). The public-facing BFF therefore holds host-root-equivalent power |
| Docker secrets / secret passing | MISSING | No Swarm secrets usage. Secrets go as plain env: `POSTGRES_PASSWORD=` (`postgres-service.provisioner.ts:137`), BFF env (`bff-service.provisioner.ts:85`), Redis `--requirepass` as a command arg, Traefik ingress token as a CLI arg (`traefik-supervisor.service.ts:~382`). All readable with `docker service inspect` |
| TLS / ACME | PARTIAL | Traefik ACME + HTTP→HTTPS redirect implemented (`traefik-supervisor.service.ts:393-401`). `DEPLOYER_TRAEFIK_ACME_EMAIL` defaults to `admin@example.com` (`packages/config/env/src/index.ts:255`). acme.json is a node-local volume while Traefik runs `mode: global`, so each node does its own HTTP-01 and issuance (LE rate-limit risk, no shared store) |
| Backup / restore (DB, state, volumes) | **MISSING** | `grep pg_dump|pg_restore|wal-g|pgbackrest` over apps/packages/infra/scripts: zero hits. Only Traefik config file backups exist. Postgres is one replica, no placement constraint, local volume (`postgres-service.provisioner.ts:133-160`). Node SQLite (`local.db`), Redis AOF, acme.json, mesh identity (`/var/lib/deployer-mesh`) are also unbacked |
| Upgrade / migration path | PARTIAL | Drizzle migrations 0039/0040 exist; `0040` needs a manual app-side backfill (`db:backfill:env-secrets`) or every environment becomes unreadable (`migrations/global/0040_...sql`). No documented rolling upgrade, no pre-upgrade backup, no version-skew policy between monolith / BFF / services images. `deployer-version.ts` has a range parser, usage not verified |
| Logging | PARTIAL | `packages/infrastructure/logger` has a redact-path list (password/token/secret and `*.x` wildcards, `index.ts:180-191`). 28 raw `console.*` calls in api-services+setup runtime code; web middleware debug-logs request headers incl. cookies (`WithHeaders.ts`, gated by a debug logger). No log shipping/aggregation, no request-id propagation verified |
| Metrics / tracing | MISSING | No Prometheus endpoint, no OpenTelemetry. `system-metrics` module is about node capacity, not platform telemetry |
| CI | PARTIAL | `.github/workflows/ci.yml`: setup → declarative-routes → lint+type-check (`--affected`) → build → test → e2e → readiness gate. Bun pinned 1.4.3, frozen lockfile. **Stale env block (DIRECTUS_*, `API_PING_PATH: /server/health`) at ci.yml:127-129, 237-239, 341-343**. No coverage run, no knip, no `bun audit`, no image build/scan, no compose validation, no `check-env`. Third-party actions pinned by tag, not SHA. Dependabot present (`.github/dependabot.yml`) |
| CD / release | PARTIAL (stale) | `deploy.yml` builds one "unified" image (`builder/deployer/Dockerfile.prod`) to GHCR on `v*` tags. It is not gated on CI, takes its version from `apps/api/package.json` (the monolith to be removed), prints a wrong compose path `infra/infra/docker/...`. CI never builds or publishes the images the real prod flow needs (api, bff, 5 services, web, doc, setup, mesh-agent). No SBOM/signing/scan |
| Prod compose | PARTIAL / likely broken | `infra/docker/compose/docker-compose.prod.yml` builds only `build-api`, `web-prod`, `doc-prod`, `setup-prod`. **No `mesh-agent` image build** (only dev-supervised compose files reference `Dockerfile.mesh-agent`) although setup defaults `MESH_AGENT_IMAGE=deployer-mesh-agent:latest`. No BFF/services images in prod (only `docker-compose.services.dev-supervised.yml`) |
| `deploy.sh` | STALE | 584 lines, hard-coded "The Gossip Club", installs nginx + certbot, `sed`s placeholder secrets into `.env.prod`, writes `/etc/nginx/sites-available/gossip-club`. Unrelated to the Swarm/Traefik/setup architecture; still at repo root. Also `apt-get upgrade -y` on the host and `curl` of docker-compose binary with no checksum |
| Root `docker-compose.yml` | REAL (dev only) | `include: infra/docker/compose/docker-compose.dev.yml`, so a bare `docker compose up` starts dev, not prod |
| Knip / dead-code | PARTIAL | `knip.config.ts` workspace-aware, `bun knip` scripts present; not in CI or `bun check --no-script`. `dead-code-audit-report.md` is dated 2026-07-17, predates the api-services split (it audits `apps/api/src/core/modules/sub-app-*` etc.) and is stale |
| Unit tests | REAL | Cached `.turbo/turbo-test.log` (2026-10-24): api 176 files / 1839 pass / 12 todo; api-services/shared 80 files / 940; runtime 32 / 288; fleet 18 / 142; project 9 / 139; identity 4 / 64; bff 5 / 36; health 1 / 6; setup 13 / 141; web 63 / 425; mesh-agent 2 / 25. All green in the logs |
| E2E | PARTIAL | 27 `*.e2e-spec.ts` in `apps/api/src/e2e` (4893 lines, Testcontainers Postgres + Traefik) and equivalent dirs in each service. No browser e2e (no Playwright/Cypress config anywhere). `E2E_FINDINGS.md` is a March 2026 design note (Testcontainers `signal-exit` fix, oRPC-client style), not a list of defects |
| Coverage gates | MISSING (ineffective) | Root `vitest.config.mts` and `apps/api/vitest.config.mts:82-89` put thresholds under a `global:` key, which Vitest does not treat as the global thresholds (it is read as a glob pattern). No CI step runs coverage anyway |
| Type/lint gate | FAILING (stale evidence) | `.turbo` logs from 2026-10-18: `bun check --no-script` errors api 95, bff 65, shared 50, runtime 43, fleet 26, project 20, setup 19, identity 13, health 13; lint 1180 errors in `apps/api`, all other apps exit 1. My live run today: bff `bun check --no-script` clean (0 errors in 284 files) but `lint:check` exits 1 |
| Docs site (`apps/doc`) | PARTIAL | 91 MDX pages, 0 tests. Mostly design specs/plans. Missing: backup/restore, upgrade, troubleshooting, runbooks, security hardening, API reference for operators. `production-deployment.mdx` describes platform services as "NOT scheduled on Swarm" and uses `infra/infra/...` paths, contradicting the code, where setup schedules api/bff/services/Postgres/Redis/Traefik as swarm services. Root `README.md` is still the "Next.js + NestJS Turborepo Template" text |
| Dependency hygiene | PARTIAL | Catalogs in root `package.json` (TypeScript ^7.0.2, ESLint ^10, Vite ^8, Next ^16.1.2, better-auth pinned 1.7.7). Workspace refs use `"*"`. `bunfig.toml` has a typo `prefere = "offline"` (ignored). Base images pinned by tag only (`oven/bun:1.4.3-alpine`), not digest; `cloudflare/cloudflared:latest`, `nginx:alpine`, `redis:7-alpine`, `postgres:16-alpine` floating minors; `bun install -g turbo@^2` unpinned in Dockerfiles. Local Bun is 1.4.4 vs 1.4.3 in CI |
| Repo hygiene | POOR | See §3 R-12 |

---

## 2. What works (verified in code)

- Boot sequencing: probes answer before Nest init; liveness has no dependency; readiness is a separate port-resolved probe (`main.ts`).
- Graceful shutdown is thorough and bounded; Postgres service uses `stop-first` plus a 60s grace period and `dnsrr` to avoid VIP problems, with an explanatory rationale in code. Postgres is not published on a host port.
- Traefik: pinned `v3.6.10`, HTTP→HTTPS redirect and ACME resolver, global mode with a host-mode port plan, rollback `failureAction`.
- Setup wizard ingress binds `127.0.0.1` only (`bootstrap-ingress.service.ts:73`), a good default for an unauthenticated wizard.
- Mesh agent: state files `0600` with atomic rename (`state-store.ts:25`), WireGuard config `0600`, no shell, `timingSafeEqual` for mesh HMACs (`packages/auth/src/mesh/index.ts:94`, `mesh-trust.service.ts:71`, `ingress-provider-token.ts:45`).
- CORS decision logic is carefully reasoned (cookie-bearing cross-origin requests from untrusted origins get no CORS headers).
- GitHub webhook handler fails closed on missing secret/signature.
- Encryption design (GCM, random salt/IV, auth tag, boot-order fail-fast) is structurally right; the key input is what is wrong.
- Dockerfiles: multi-stage, `turbo prune`, BuildKit secret mounts for Turbo tokens (never in layers), non-root runtime for API/web/doc.
- Test volume is substantial and green in the last cached run (about 4,000+ unit tests); web has a `describePageStates` harness for empty/error/loading screens.
- Dependabot configured; husky pre-push runs `bun run check --affected`.

---

## 3. Broken / risky (ranked)

### CRITICAL

**R-01 Open self-registration with a client-settable `role` (likely privilege escalation to superAdmin). UNVERIFIED at runtime.**
`packages/auth/src/server/auth.ts:117-119` sets `emailAndPassword: { enabled: true }` with no `disableSignUp`. `auth.ts:~138-146` declares the `role` additional field with `input: true`. There is no `databaseHooks`/before-hook rejecting `role` on sign-up (grep over `packages/auth/src/server`). `apps/web/src/app/auth/_utils/dev-only.ts:2-8` states there is "no server-side sign-up enabled flag" and gates only the sign-up *link* by build mode. An unauthenticated `POST /api/auth/sign-up/email` with `"role":"superAdmin"` is the first thing to test on a dev stack. Fix both: disable public sign-up (invite plugin already exists) and set `input: false`.

**R-02 The "encrypted at rest" key is empty for any non-hex `AUTH_SECRET`.**
`apps/api/src/config/drizzle/schema-codecs.ts:37-46` (and the copy in `api-services/shared/src/config/drizzle/schema-codecs.ts`) does `Buffer.from(process.env.AUTH_SECRET, "hex")`. The schema accepts any string (`index.ts:188`). I confirmed with Node: `Buffer.from('QgafJQw3O/k1gambz7YGKjtj5ZZe0dnL/WlSw4PtMDc=','hex').length === 0`, which is the exact `AUTH_SECRET` in `.env.example:174`; the `.env.prod.example` placeholder also yields 0 bytes. With a 0-byte key, scrypt output depends only on the stored salt, so all stored ciphertexts (env vars, GitHub private keys, DNS creds, cluster secret material) are decryptable by anyone holding the DB. The same secret doubles as the Better Auth secret (no key separation) and any rotation of it makes all stored secrets unreadable (no key id, no re-encrypt tool). Also non-production silently uses `scryptSync("temporary-fallback-key","salt",32)` (source-known).

**R-03 No backup or restore for any stateful component.**
Postgres (global state), node SQLite, Redis AOF, acme.json, mesh identity/roster and uploads have no backup job, no restore procedure, no doc. Postgres is single-replica with empty `placementConstraints` and a node-local named volume: a reschedule onto another node starts an empty database ("data loss" with no error). HA does not exist.

**R-04 Production path is not reproducible from the repo.**
`docker-compose.prod.yml` produces api/web/doc/setup images only. The mesh-agent image (required by setup) and BFF/service images (needed for the target architecture) are built only by dev-supervised compose files; CI/CD publishes a different artifact (the unified `deployer` image) that the swarm flow does not consume. `deploy.sh` is a different product's script. A fresh VPS install cannot be done from docs + repo as written.

### HIGH

**R-05 Static "master token" login enabled by config alone.** `packages/auth/src/server/plugins/masterTokenAuth.ts`: `Authorization: Bearer <DEV_AUTH_KEY>` or cookie `dev-auth-key` injects a synthetic session for `DEFAULT_ADMIN_EMAIL` on **every** endpoint. Enabled whenever `DEV_AUTH_KEY` and the admin email are set (`auth.ts:~178`), regardless of `NODE_ENV`; the file comment says "should only be true in development". Comparison is `token !== devAuthKey` (not constant-time, line ~148). `.env.example:197` ships `DEV_AUTH_KEY=dev-secret-key-change-me` with a matching admin email; `.env.prod.example` comment suggests "or set same as AUTH_SECRET". `loginAsPlugin` is gated on `NODE_ENV === "development"` at its own level but enabled via `!!DEV_AUTH_KEY` here. Gate on `NODE_ENV !== production` or remove.

**R-06 Archive extraction: command injection and Zip-Slip.** `apps/api-services/shared/src/core/modules/git/git/services/git.service.ts:133-135` builds a shell string `unzip -q "${filePath}" -d "${extractPath}"` via `execSync` (shell). The tar path (`extractTar`, lines ~150-185) does `path.join(extractPath, header.name)` with no containment check, so `../` entries write outside the workspace. Used by `deployment-artifact-builder.service.ts:107` for uploaded artifacts, running inside the API/runtime process that has docker.sock. Same code is duplicated in `apps/api`. `git.cloneRepository` runs a clone of an arbitrary URL/branch on the control-plane host (SSRF/argument-injection surface; `--branch` value unchecked for leading `-`).

**R-07 Docker socket (rw) in every tier app, including the public BFF.** Any RCE/SSRF-to-exec in BFF/services equals root on every node (Swarm manager API). The services tier gets the full socket via one shared mount list. Consider a socket proxy with an allow-listed API, or restrict the socket to `svc-runtime` and the supervisors.

**R-08 Secrets visible in swarm specs and CLI args.** DB password, auth secret, Redis password, ingress provider token are env/args (`docker service inspect`, `ps`). `MANAGED_GLOBAL_DB_PASSWORD` defaults to the literal `"deployer"` (`index.ts:340`); Redis has no password by default.

**R-09 Rate limiting is absent on the sensitive surfaces** (sign-in, sign-up, password reset, passkey, TOTP, webhooks, setup, uploads, deploy triggers, API keys). The only limiter is in-memory and keyed on the first `x-forwarded-for` hop (spoofable unless Traefik overwrites it). No lockout; no body-size caps.

**R-10 No security headers on web, doc or API.** Absence of CSP/HSTS/frame-ancestors/nosniff; `images.dangerouslyAllowSVG: true` in `next.config.ts:193`; the web proxy `/api/nest/:path*` rewrite forwards arbitrary paths to the API root (`next.config.ts:126-135`). `typescript.ignoreBuildErrors` defaults to `true` unless `CHECK_ON_BUILD=true` (`next.config.ts:105,139`), so production web images can ship with type errors.

**R-11 Quality gate is red and mostly unenforced.** Last logs show 95 type errors in `apps/api` and 345+ across the tier; lint failing everywhere (1180 errors in api). Per the 2026-10-25 cutover doc the remaining ones are in `*.spec.ts` mocks, but that gate (`bun check --no-script` / CI `type-check`) still fails. Coverage thresholds are mis-shaped; coverage and knip are not in CI. The bff-run shows `lint:check` also exits 1 today.

### MEDIUM

**R-12 Repo hygiene and secrets in git.**
- `200` (tracked, commit `f9522f7d9`) is a curl cookie jar containing a **live-format Better Auth `session_token` and `session_data` for `admin@admin.com`, role superAdmin, domain `.deployer.localhost`**, expiry 2026-10-29. Dev-only host, but it is a committed credential; rotate and `git rm`.
- `.env.prod` is tracked despite being in `.gitignore` (only a `git rm --cached` fixes that); values are placeholders but it names a real domain (`the-gossip-club.sebille.net`) and sets `ENABLE_SEEDING=true`.
- Tracked junk: `api.log`, `PG` (empty), `temp.txt`, `test.txt`, `ts-output.txt`, `300`, `800`, `tmp/*` (18 files), `.tmp/local.db*` (3 SQLite files), `FULL_MESH_HISTORY.md` (548 KB), `apps/doc/CPU-*.cpuprofile.txt` (368 KB), `apps/web/animate-pulse`, `check-manifest4.py`, `list-shells.py`, `apps/web/redoc-static.html`, output dumps in `apps/api/*-output.txt`, `scripts/__pycache__/` untracked. Many are staged for deletion (1060 `D` entries) but uncommitted.
- Local: `tmp/` 29 MB (ignored), `graphify-out/` 1014 MB (ignored).
- The cleanup and the migration are one giant uncommitted diff (2861 entries). Commit hygiene: no rollback point for the split.

**R-13 Duplicate code tiers.** `apps/api` vs `apps/api-services/*` duplicate core/shared modules (differing in dozens of files); every security fix (R-06, R-09) must be applied in both until the monolith is retired. The cutover doc itself says the monolith is still the default ingress backend.

**R-14 `lint:check` is not read-only.** `bun lint` auto-fixes by default. In bff it rewrote 6 files, converting `export interface X extends FlatLeaves<…> {}` into `export type X = {} & FlatLeaves<…>`, which conflicts with the same-named `@Injectable() class X` (declaration merging). So the "check" gate can silently mutate or break sources, and AGENTS.md's claim that `lint:check` is non-mutating is false. CI lint results are therefore not trustworthy.

**R-15 Webhook idempotency and signing.** In-memory dedupe (lost on restart, per-instance); HMAC over re-serialised JSON can mis-verify for payloads where GitHub's byte stream differs from `JSON.stringify` output (escaping/number formats) → false rejections; checking "duplicate" occurs before signature verification (harmless but order should be sig first).

**R-16 ACME defaults and multi-node certs.** Default contact `admin@example.com` (invalid for LE), node-local acme.json in a global service (every node re-issues), no staging toggle seen.

**R-17 Non-root image vs docker.sock access (UNVERIFIED).** `USER nestjs` (uid 1001) in the API image with the host socket bind-mounted; no `user`/`groups` in the service specs (grep of both provisioners found none). Unless the socket is world-writable, calls fail with EACCES. Needs a runtime check. `/app/data` ownership for a named volume is also not prepared in the image (only `uploads` is chowned).

**R-18 Hard-coded infra identifiers.** `docker-compose.deployer.yml` defaults `CLOUDFLARE_TUNNEL_ID` and hostname `deployer.sebille.net`; `cloudflared:latest`; the token is written into a config file inside the container via heredoc.

**R-19 Docs contradict code.** README is template text; `production-deployment.mdx` says platform services are not Swarm-scheduled; `infra/infra/docker` paths in docs and deploy.yml summary; CI env block is Directus-era.

### LOW

- `bunfig.toml` `prefere = "offline"` typo; `globalStore = true` with a Docker `BUN_INSTALL_GLOBAL_STORE=0` workaround.
- `apps/web/next.config.ts:100` `console.log(workspaceTranspilePackages)` in config, and the transpile list filters `@repo/*` though packages are `@deployer/*` (so it returns an empty list silently).
- Unified entrypoint builds Next.js at container start (`entrypoint.prod.ts`), slow and fragile.
- `graphify-out/.graphify_uncached.txt` is tracked.
- `.github/instructions.backup-20260825/` backup dirs committed.

---

## 4. Production-readiness checklist

### P0 (blockers, do before any real deployment)
1. **Close sign-up and role injection** (R-01): `emailAndPassword.disableSignUp: true` (use invite flow), `role.input: false`, add a before-hook that strips `role`, add an e2e test that asserts `POST /api/auth/sign-up/email` with `role` yields 403/ignored.
2. **Fix the encryption key** (R-02): require `ENCRYPTION_KEY` (separate from auth secret), 32 bytes hex validated by Zod with a production refinement; HKDF from it, not `Buffer.from(…,'hex')` of a free-form string; store a key id in the ciphertext (`v1:kid:…`); ship `rotate-secrets` CLI; backfill/re-encrypt existing rows. Treat all currently stored secrets as exposed and rotate them.
3. **Gate or remove the master token** (R-05) in non-development; use `timingSafeEqual`; make `DEV_AUTH_KEY` forbidden when `NODE_ENV=production` in the Zod schema.
4. **Backups** (R-03): scheduled `pg_dump` (or WAL archiving) of global DB to off-node storage, plus SQLite, acme.json, mesh identity; a `deployer backup` / `restore` command; a tested restore drill; pin Postgres to a labelled node or use a replicated/managed DB.
5. **One reproducible prod path** (R-04): build and publish all images (api or bff+services, web, doc, setup, mesh-agent) from CI with immutable tags; make `docker-compose.prod.yml` (or the setup CLI) consume them; delete or rewrite `deploy.sh`; retire the unified deployer image or make it real.
6. **Fix archive handling** (R-06): use a library with entry-path containment and size/entry limits; never build shell strings; validate git URLs/branches (`--` separators, scheme allow-list, no private IP ranges).
7. **Make the quality gate trustworthy** (R-11, R-14): make `lint:check` non-mutating, get type-check and lint to zero, add the gate to branch protection, add a deploy workflow dependency on CI success.

### P1
8. Security headers (CSP, HSTS, XFO/frame-ancestors, nosniff, Referrer-Policy) on web/doc/API via Next `headers()` and a Traefik middleware applied to platform routes; turn off `dangerouslyAllowSVG`; make `CHECK_ON_BUILD` default true for prod builds.
9. Rate limiting: Better Auth `rateLimit` with a shared store (Redis/DB) plus strict rules for sign-in/sign-up/reset/2FA; limiter on webhook/setup/upload/deploy routes; trusted-proxy handling for `x-forwarded-for`; global body-size limits.
10. Docker socket mediation (R-07): a proxy allowing only the Swarm/container calls needed; remove the socket from BFF and non-runtime services; verify non-root access mechanism (R-17).
11. Swarm secrets (R-08): move DB/Redis/auth secrets to Docker secrets/`*_FILE` envs; no default `deployer` DB password; require Redis password.
12. Webhooks: verify against the raw body, persist delivery ids in Postgres/Redis, per-provider secret lookup, implement GitLab verification.
13. Env schema hardening: required-in-production refinements for `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `DEFAULT_ADMIN_PASSWORD` (min length, not `adminadmin`), `ACME_EMAIL`; reject placeholder values; run `check-env` in CI.
14. Retire the monolith duplication: finish the cutover, delete `apps/api` core copies, move shared code to one package; commit the migration in coherent chunks.
15. Purge committed secrets: `git rm` the `200` cookie file, `git rm --cached .env.prod`, remove tracked `.tmp/local.db*`; add `.gitignore` entries; run a secret scanner (gitleaks) in CI and over history.

### P2
16. Observability: `/metrics` (Prometheus), OpenTelemetry traces with request id through BFF→services, structured JSON logs with redaction tests, log forwarding/retention config, alert rules (queue stuck, DB down, cert expiry).
17. Supply chain: pin actions by SHA, pin base images by digest, pin `turbo`, add Trivy/Grype image scan, SBOM + cosign signing, `bun audit` in CI, Renovate/Dependabot grouping.
18. Coverage: fix threshold shape (`thresholds: { lines: 75 }`), run `test:coverage` in CI, add per-package floors starting with security-critical modules (auth, secret codec, webhook, git, docker repository).
19. Browser e2e (Playwright) for sign-in, create project, deploy, rollback, role gating; contract tests between BFF and services.
20. Docs: replace README, write operator runbooks (install, backup/restore, upgrade, rotate secrets, node join/leave, disaster recovery), fix stale paths, archive plan documents out of the published site.
21. ACME: real contact email required, staging toggle, shared cert store or single ACME terminator.
22. Repo cleanup: delete junk listed in R-12, split `docker.repository.ts` (4.3k lines), `docker.service.ts` (3.3k), `deployment.service.ts` (2.5k).

---

## 5. Enhancements

- Replace the in-memory dedupe/limiter with a small shared store abstraction (Redis already deployed) so multi-replica API/BFF behave consistently.
- Add `HEALTHCHECK`/`healthcheck` to mesh agent, setup (Dockerfile) and Traefik service spec (currently `healthcheck: null`).
- Add `resourcesLimits/Reservations` (currently `{}`) to platform services so a runaway build cannot starve Postgres or the API.
- Run builds (git clone, `docker build`) in an isolated builder (separate service/runner node, rootless BuildKit) rather than in the API process with the socket.
- `scryptSync` per decrypt on every read is CPU-heavy and blocks the event loop; derive a data key once (HKDF) and use per-record random IV, caching the key.
- CI: split into reusable jobs, cache the Turbo remote cache, add a nightly full (non-affected) run, add a matrix for prod-compose smoke test (`docker compose -f ... config` + boot + `/health/ready`).
- Move `.github/instructions.backup-*` and `tmp/` content out of the repo; fix `AGENTS.md` claims to match tooling.
- Version policy: stamp each image with build SHA + semver, expose `/version`, enforce version-skew checks between BFF and services at startup.
- `knip` and `check:di-graph` in CI as non-blocking, then blocking.

---

## 6. New capabilities recommended

1. **Backup/restore subsystem** (`deployer backup create|list|restore|verify`), encrypted archives to S3/SFTP, scheduled by the supervisor, with pre-upgrade automatic snapshot and restore drills.
2. **HA data tier**: Patroni/repmgr-style Postgres replication or managed DB integration; Redis Sentinel or AOF+snapshot export; documented RPO/RTO.
3. **Upgrade orchestrator**: staged rolling upgrade (setup → migrations with lock → services → BFF → web), health-gated with automatic rollback, migration dry-run and backup gate, release channel manifest.
4. **Key management**: key ring with rotation, optional KMS/Vault/sops backend, per-secret re-encryption job, audit trail on secret reads.
5. **Audit log + security events**: immutable record of logins, role changes, secret reads, deploys, exposed to admins and exportable.
6. **Policy layer for deploys**: allow-listed registries/git hosts, network egress rules for builds, resource quotas per project, image vulnerability gate (`deployment-trust-gate` exists as a doc; verify implementation).
7. **Docker API proxy / capability broker** so only `svc-runtime` can mutate containers; the rest request actions via an internal authenticated RPC.
8. **Operator CLI doctor**: `deployer doctor` checking secrets strength, open ports, cert expiry, disk, swarm quorum, mesh health, backup recency.
9. **Telemetry stack bundle**: optional Prometheus + Grafana + Loki services provisioned by the platform with default dashboards and alerts.
10. **Status/uptime page + notification channels** (push exists; add email/Slack/webhook alerts for deploy failures and node loss).
