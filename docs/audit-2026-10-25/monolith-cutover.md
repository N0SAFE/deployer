# apps/api cutover audit (read-only)

Paths relative to /home/sebille/Bureau/projects/tests/deployer/v3. Method: file listings, `diff -rq` (with import/comment lines ignored), and targeted `diff -u` reads. I did not run builds, tests or lint. The compile verdict below comes from reading imports, not from a compiler. Rate limit cut the first run; the report covers what was read, and gaps are flagged "NOT VERIFIED".

## Status update 2026-10-27

Cutover checklist progress (the findings below are the 2026-10-25 audit and are kept as written):

| Step | State |
|---|---|
| 2 drizzle toolchain into `packages/nest/schema` | done (auth:generate dropped on purpose; mirror dies with `apps/api`) |
| 3 `backfill-env-secrets` | superseded by `reseal-secrets --seal-plaintext`; migration 0040 journaled |
| 4 builder strategy registry | done, wired and tested in runtime |
| 7 e2e harness / vitest no longer requires `apps/api` | done (harness in `shared/src/e2e-harness/vitest`); not yet checked with `apps/api` absent |
| 1 topology | done (`docs/qa/api-services/topology.md`) |
| 9 compose default, 10 images, 11 `apps/setup` | done except the unified `Dockerfile.prod` / `docker-compose.deployer.yml` (decision needed) and the mesh-6 rigs, which keep the monolith config until the mesh e2e port; `Dockerfile.api.prod` fixed and verified with real `svc-bff` and `svc-runtime` images |
| 5 trigger registry + system actor | done (`ARCH-015`): registry in runtime, fleet relays with a signed system-actor claim, PR serviceId fixed; not run against a live stack |
| 6 analytics download + offline OpenAPI | done: the handle's `/content` route never existed in the tier (the monolith's REST controller was dropped), now a contracted `analytics.getReportContent` returning a `File`; `generateOpenApiSpec()` shared by the BFF endpoint and `bun run openapi:generate` (BFF), 304 paths |
| 12 scripts/tooling | done except `knip.config.ts`'s `apps/api` entry (goes with step 14): `check-di-graph.ts` retargeted to the tier (7 roots, new rules: shared must not import an app, an app must not import a peer app; negative-tested), `verify-mesh-master-decision.ts` (also fixed: stale constructor and a stale expectation), `check-swarm-cli-lock.sh` (now fails on a missing path instead of passing over nothing), `diagnose-build.ts`, dependabot dirs; `sync-api-vitest-aliases.py` deleted. Found: `DEPLOYER_VERSION` resolved to `0.0.0` in every tier process (wrong path), fixed with a test |
| 8 e2e port | done (`e2e-port-plan.md`): 6 mesh/BFF specs ported, 7 dropped, 2 replaced by boot e2e, user/analytics/push unit specs rewritten. Step 7 had to be finished first: the BFF could not boot in e2e. Every app's e2e now passes |
| 13 docs and references | done except what step 14 must remove (see next row). Moved/rewritten: `apps/api-services/shared/AGENTS.md` (supervisors swarm-only, edge providers, boot model: the monolith AGENTS rules that still hold, paths checked), `apps/api-services/docs/e2e-testing.md` (replaces `E2E_HANDBOOK`/`E2E_TESTING_STRATEGY`, rewritten for the tier), `bff/README.openapi.md`. Dropped (git history keeps them): `ARCHITECTURE.md` and `AGENTS.md` of the monolith (the tier has its own), `docs/{sub-app-architecture,HANDOFF-ORCHESTRATION-REFACTOR,CURRENT-ARCHITECTURE-AND-NEXT-STEPS}.md` (the sub-app pipeline is gone), `DEV-TOKEN-AUTH.md` (the `DEV_AUTH_KEY` plugin became the master-token one), `E2E_FINDINGS`/`E2E_TEST_STRATEGY` (monolith discoveries), `src/system/*` docs. Fixed: dependency-builder's `api` profile still resolved to `@deployer/api` (now the six tier apps, spec rewritten), `Dockerfile.api.cli.dev` deleted (unreferenced, monolith), builder AGENTS examples, compose comments, workflow check, root AGENTS files, doc-site pages (apps/api/src paths remapped to where the file lives now; dated records under `docs/feature-status` and audit reports deliberately left as written) |
| 14 | DONE 2026-10-27: `apps/api` deleted. Recoverable: commit `6f5059d8` holds its last working tree (`git show 6f5059d8:apps/api/<path>`). Done on the user's go-ahead to retire the mesh-6 rigs rather than re-point them: `docker-compose.mesh-6.dev.yml` and `docker-compose.mesh-6.dev-supervised.yml` and the six `dev:mesh*` scripts removed, `docker:build` and `prod*` re-pointed at `docker-compose.prod.yml` (`setup-prod`, `build-svc-*`), `prod:api:run` removed (its container no longer exists), `common/api/docker-compose.config.dev.yml` removed. Also removed: the `knip` entry, the `"monolith"` `TableOwner`, the eslint carve-out wording; `scripts/test-copilot-setup.ts`, the tier/contracts AGENTS and the testing instructions point at the tier. Verified after: `bun install` clean, DI graph PASS, swarm lock OK, root and services compose render, `nest-schema` ownership spec 13 passed, dependency-builder 40 passed, type-check counts unchanged (bff 5, shared 15, identity 3, runtime 20, setup 0). NOT replaced: a multi-node mesh dev rig (`NET-107`). Remaining mentions of `apps/api` are comments and historical reports (`dead-code-audit-report.md`, `repository-enhancements/`, `docs/feature-status/`), left as written |

## 1. Compile status of apps/api

- It does NOT compile as-is. `apps/api/src/app.module.ts:18,25,28,69` import `@repo/nest-lifecycle`, `@repo/nest-database-core/database-connection`, `@repo/nest-schema/global` and `@repo/nest-supervisor-core/supervisors.module`. Grep over the whole of `apps/api/src` finds `@repo/` only in that one file. No `@repo` scope exists in `node_modules`, and the packages are `@deployer/*`.
- All 29 other `@deployer/*` packages imported by apps/api exist under `packages/` (checked one by one). So the fix is 4 import lines. Effort: S.
- `apps/api/dist/app.module.js` is stale and has the same bad imports. `apps/api/nest-cli.json` still lists a library project `api-contracts` at `../../packages/api-contracts`, which does not exist.
- The monolith is a non-bootable fallback today. The audit's claim holds.

## 2. Consumers of apps/api (what breaks on `rm -rf apps/api`)

Hard code dependencies. These break tests, CI or builds, not just docs:
1. **`tooling/vitest/src/service.ts:37-47,71,214-215`**. `resolveWorkspacePaths()` throws unless `apps/api` exists, and it is used by every service/bff vitest config. The e2e `globalSetup` and `setupFiles` point at `apps/api/vitest.global-setup.e2e.ts` and `vitest.setup.e2e.ts`. Those import `vitest.shared-postgres.e2e.ts`, `vitest.teardown.e2e.ts` and `src/e2e/utils/shared-api-runtime`. The harness is half-forked: `apps/api-services/shared/src/e2e-harness/shared-api-runtime` exists, but the four vitest.*.ts files and the shared-Postgres container logic exist only in apps/api. Effort: M.
2. **`.github/workflows/deploy.yml:57`**. The release version is read with `jq .version apps/api/package.json`. Effort: S.
3. **`infra/docker/builder/deployer/Dockerfile.prod:61,177,231-232`**. It runs `turbo prune @deployer/api @deployer/web`, builds `@deployer/api` and copies `apps/api/dist`. Effort: M.
4. **`infra/docker/builder/api/Dockerfile.api.prod`**. Defaults are `PRUNE_SCOPE=@deployer/api` and `APP_DIR=apps/api`. It is parameterised, so the bff and svc builds already work through args. It also has the `HEALTHCHECK localhost:3001/health` problem (BFF is 3005, services 3101-3105). Effort: S.
5. **`infra/docker/compose/`**:
   - `docker-compose.dev.yml:62` defines `api-dev`, extending `common/api/docker-compose.config.dev.yml:27`, which sets `APP=@deployer/api`. The root `docker-compose.yml` includes `docker-compose.dev.yml`, so the DEFAULT `docker compose up` runs the monolith.
   - `docker-compose.dev-supervised.yml:234` sets `APP=@deployer/api` and `:113` sets `DEPLOYER_API_IMAGE`.
   - `docker-compose.prod.yml:40-58` has `build-api` using Dockerfile.api.prod with the monolith default.
   - `common/api/docker-compose.config.prod.yml` is monolith-only.
   - The `services.dev*.yml` files and `common/api/docker-compose.config.services.yml` are already on bff + svc-*. They reference `apps/api/AGENTS.md` only in comments.
   - Effort: M.
6. **Root `package.json`**:
   - `:314` has the `@deployer/api` script runner.
   - `:289` is `docker:build:api`.
   - `:251` is `dev:api:run`.
   - `:261` is `check-env:api`.
   - `:299-311` are `prod:api*`, which in fact point at the mesh-6 compose.
   - Effort: S.
7. **`tooling/dependency-builder/src/services/application-detector.service.ts:76`**. `PROFILE_TO_WORKSPACES.api = ['@deployer/api']`. Effort: S.
8. **`scripts/`**. Effort: M overall (the DI-graph script is the largest part).
   - `check-di-graph.ts:21` hard-codes `apps/api/src`.
   - `verify-mesh-master-decision.ts:12` imports from `../apps/api/src/core/modules/swarm`.
   - `check-swarm-cli-lock.sh:11-12`, `diagnose-build.ts:225-379`, `sync-api-vitest-aliases.py`.
   - `check-service-surface-parity.py` and `gen-bff-delegation.py`: NOT VERIFIED whether they read apps/api.
9. **`knip.config.ts:13`** has an `apps/api` entry. Effort: S.
10. **`apps/setup`**. Effort: M.
    - `api-service-provisioner.service.ts` is the "shape A" path: `DEPLOYER_API_IMAGE`, the `deployer-api` swarm service, and `apiServiceName()` in `config/api-address.ts:59`.
    - `api-address.ts` defaults to `deployer-api`, and `SETUP_API_URL` defaults to `api-dev:3005`. The `deployer-api` default is stale for the tier; the real switch is `DEPLOYER_API_TARGET` (`services-tier-provisioner.service.ts:302`).
    - `ingress-handover.service.ts` and `wizard.controller.ts` talk to `/setup/trigger`, `/setup/stream`, `/setup/done` on the API backend. Those routes now live in the BFF.
11. **`apps/mesh-agent`**. Only `src/__tests__/doors.spec.ts:17` uses `deployer-api` as a fixture. S.
12. **`apps/web`**. No import of apps/api. `src/test-support/fixtures/docker.ts` has `name: 'deployer-api'` (fixture). Comments mention `api-dev:3005` (`lib/redirects.ts`, `lib/setup-url.ts`). `vitest.*.e2e.ts` mention apps/api only in comments. S.
13. **Packages**. Only comments reference apps/api, in `nest-schema` (`ownership/table-ownership.ts:19-45`, the `"monolith"` TableOwner member), `nest/nodes`, `nest/env`, `nest/events` and `tooling/eslint/src/nestjs.ts:70`. S.
14. **Docs**. About 15 `apps/doc/content/docs/**` pages, `FULL_MESH_HISTORY.md` (e2e paths `apps/api/src/e2e/mesh-workflows/`), the root `AGENTS.md` ("API (apps/api)", auth-generate, api-db) and `.github/instructions`. M.
15. **Reverse direction: no code in apps/api-services, apps/setup or apps/web imports from apps/api.** Verified by grep.

## 3. Parity matrix (apps/api → new tier)

Legend: IDENT = same apart from import-alias and `interface`→`type` style; DIV = diverged; MISSING = absent from new tier.

### Modules (`apps/api/src/modules/*`)

| Old module | New location | Verdict | Evidence |
|---|---|---|---|
| analytics | identity/modules/analytics | DIV + 1 MISSING | `api/src/modules/analytics/controllers/analytics-download.controller.ts` (`GET api/analytics/reports/:id/download`, AuthGuard) has no counterpart. No `AnalyticsDownload` reference in `apps/web` or the new tier. Lost, unless the oRPC `downloadReport` envelope's URL is unused. |
| cluster | fleet/modules/cluster | IDENT (1 file differs) | diff -rq: only the module/import diff |
| deployment | runtime/modules/deployment | **DIV, monolith newer in 2 places** | see below |
| docker (52 files) | runtime/modules/docker | IDENT-ish (21 files differ, sampled style/alias) | same file set |
| domain | project/modules/domain | IDENT | file set equal |
| fleet | fleet/modules/fleet | IDENT (7 differ, `interface`→`type` sampled) | `fleet-rollback.service.ts` diff is only `interface`→`type` |
| health (7 files) | health/modules/health (2 files) | **Intentionally reduced** | monolith has indicators, repositories, services, `health.module.spec.ts`. The new service is process+DB probes only; `health.controller.ts:71` `supervisors: []`. Roll-up lives in BFF `modules/health`. The monolith's health_checks / service_health_configs repositories and services are gone (tables are owned by `health` but unused). NOT VERIFIED whether those features were ever user-facing. |
| permission | identity/modules/permission | IDENT | |
| platform | fleet/modules/platform + bff/modules/console | DIV | `setup-done.controller.ts` → `bff/modules/console/controllers/setup-done.controller.ts`. `platform-console.controller.ts` (`@Controller("manage")`, SSR) → BFF console, per the prior audit "likely dead SSR". |
| project | project/modules/project | DIV (new has `domain/` dir) | 10 files differ; NOT VERIFIED beyond file set |
| providers (34) | fleet/modules/providers (34) + runtime/modules/providers (8) | DIV | `github.webhooks.controller.ts`: **monolith newer** (routes unmatched events through `DeploymentTriggerRegistryService`, `:77-110`; still only logs "no system actor"). Fleet has the placeholder `serviceId` TODO at ~l.138. |
| provider-schema | fleet/modules/provider-schema | IDENT | |
| push | identity/modules/push | IDENT (specs only in old) | |
| reachability | fleet/modules/reachability | IDENT | |
| runners | runtime/modules/runners | IDENT (3 differ) | |
| service | project/modules/service | IDENT/DIV | 5 differ; new adds `preview-topology.resolver` / `service-network.service` usage; NOT VERIFIED which side is newer |
| setup | bff/domains/setup | IDENT | same 4 src files + 3 specs |
| test | bff/domains/test | IDENT scaffold | |
| user | identity/modules/user (+`domain/`) | DIV (new richer) | old specs (user.controller/service/repository/module) were NOT ported: identity user has 0 specs |

Deployment module, details:
- `api/src/modules/deployment/builders/{builder-registry.service.ts, base/builder-strategy.interface.ts, strategies/{buildpack-family,docker-compose,dockerfile}-builder.strategy.ts}` do NOT exist in the runtime service. The runtime copy of `deployment-artifact-builder.service.ts` still uses the old if-chain. The monolith's version states that the old chain threw "Dockerfile not found" for nixpacks/buildpack/railpack. **So a real build-correctness fix exists only in apps/api.** Effort to port: M.
- `api/src/modules/deployment/triggers/*` (`api-trigger.source`, `github-push-trigger.source`, registry + spec, `base/`) has no counterpart. There is no `DeploymentTriggerRegistry` anywhere under `apps/api-services`. In practice the monolith only computes the trigger and logs it (no actor), so the practical loss is the plumbing, not working auto-deploy. Port: M (the webhook is in fleet, the registry would be in runtime, so it needs a service-to-service call, which has its own auth gap).
- About 20 other deployment files differ (queue worker, lifecycle, execution workflow, read-model projector, stream bridge). NOT VERIFIED which side is newer. Runtime has `preview/` and 16 specs vs 17.

### Core (`apps/api/src/core` → `apps/api-services/shared/src/core`)
- Every monolith core file exists in shared (diff -rq "Only in" shows no monolith-only files). Shared adds `__tests__` and docs. 351 files differ in raw diff and about 156 after ignoring import and comment lines. Mostly `interface`→`type` and import consolidation.
- **Shared newer** (examples):
  - `bootstrap-orchestrator.service.ts` resolves the DB URL through `resolveManagedGlobalDbUrl` (fixes the swarm-vs-compose DB split).
  - `local-event-outbox-dispatcher.service.ts` has `claimDue` and `eventId` dedup. It still only calls `markSent`, so there is no publisher.
  - `default-admin.bootstrap.ts` and `platform-names.ts` have small fixes.
- **Monolith newer in core: none found** in the files read. NOT VERIFIED for the other ~150 differing files (mesh/*, domain/*, reachability/*, auth/orpc/*).
- `config/`: all of `apps/api/src/config/drizzle/global/` is MISSING in shared. It is the stale migration mirror: journal ends at 0038 under a different tag than the canonical package dir. Intentionally dropped, but the generation toolchain goes with it (see §6).

### CLI (`apps/api/src/cli`)
| Command | New |
|---|---|
| migrate, create-default-admin, node-startup-check, setup-db, reset, seed | present in `bff/src/cli/commands` |
| **backfill-env-secrets** (`apps/api/src/cli/commands/backfill-env-secrets.command.ts`, 93 lines) | **MISSING** in the BFF CLI (no match for "backfill" in `bff/src/cli*`). Migration 0040 is not in the journal, so env-var values stay unencrypted-on-read-failure until this runs. |

### Other
- **OpenAPI doc generation**:
  - `apps/api/src/openapi.ts` plus `scripts/generate-openapi.ts` (`appContract` → JSON) has no counterpart script. The BFF serves `/openapi.json` live (`bff/src/modules/docs`). `apps/web` `openapi:yaml` is an unrelated zod-to-openapi route doc. CI references `apps/web/openapi-docs.yml`, not apps/api. Offline spec generation is lost (S to port).
  - `@scalar/nestjs-api-reference` is listed only as a dependency of apps/api. The BFF `/reference` is a plain table, which is a downgrade.
- **SSR views**: `apps/api/src/views` vs `bff/src/views`. 3 pages (`login`, `manage-web-app`, `setup-done`) differ. Whether the BFF actually serves them is UNVERIFIED (no `RenderModule`, per the prior audit). Intentionally "likely dead".
- **SSE/WebSocket**: `@Sse`/`@WebSocketGateway` appear only in `setup.module.ts` comments (both trees). Streams are oRPC event iterators in deployment/docker/mesh, which exist in both. Nothing is monolith-only.
- **Schedulers (`@Cron`)**: none in apps/api/src (grep). Supervisors are in shared.
- **Core modules (edge, admin-bootstrap, readiness, orpc, middlewares)**: all present in shared (see above). The BFF also hosts BootstrapModule and the supervisors.
- **e2e**: 21 `*.e2e-spec.ts` in apps/api vs 5 in the new tree. Missing in the new tier:
  - all 11 mesh-workflow specs,
  - `module-contract-surfaces`, `module-http-guards`,
  - `deployment-workflows/support`, `setup-workflows` (2 specs + support),
  - `traefik-routing`, `debug-compile-full`,
  - `auth-workflows` exists in the BFF.
  - The new tier has roughly 5 e2e files for 6 processes. That is a big test-coverage loss, not a runtime loss. Port: L.
- **Unit specs**: 153 in apps/api vs a lower per-service total; known missing counterparts include the user specs (4), `analytics`/`push`/`service` specs, `health.module.spec`, `github-source-provider.service.spec`.
- **Docs in apps/api**: `ARCHITECTURE.md`, `AGENTS.md`, `docs/`, `README.openapi.md`, `src/e2e/E2E_*.md`. They hold knowledge worth moving (E2E_HANDBOOK, strategy).

## 4. Data and migration ownership
- Canonical journal: `packages/nest/schema/migrations/global/meta/_journal.json` (0000-0039); the local SQLite journal is applied at init. The runtime reads this directory.
- `apps/api/drizzle.config.ts:10` writes to `./src/config/drizzle/global/migrations`, the stale mirror (journal ends `0038_breezy_absorbing_man`). `packages/nest/schema` has no drizzle config (only `scripts/` and the `pkg-build` config). **Deleting apps/api deletes the only `db:generate` toolchain.** The local config (`drizzle.config.local.ts`) already targets the package dir. The mirror was modified 2026-10-25, so someone is still using it.
- Boot-time migration runner: `BootstrapOrchestratorService` in the BFF (shared core) plus the setup wizard. Service processes only preflight. The monolith ran the same code in-process.
- Only apps/api: `auth:generate` script (`auth generate --config src/auth.ts` → `packages/nest/schema/src/global/auth.ts`). `apps/api/src/auth.ts` is untracked (not in git).
- `TableOwner` still has `"monolith"` (`table-ownership.ts:45`), and the eslint rule in `tooling/eslint/src/nestjs.ts:70` has monolith carve-outs. Both are clean-up after deletion, plus a chance to tighten per-service DB roles.

## 5. Features that would be LOST if apps/api were deleted today
1. Builder strategy registry (nixpacks/buildpack/railpack dispatch fix) in deployment.
2. Deployment trigger registry and the `ApiTriggerSource` / `GithubPushTriggerSource` sources, plus the webhook controller's routing into it.
3. Analytics report download endpoint (`GET /api/analytics/reports/:id/download`).
4. `backfill-env-secrets` CLI command (blocks the env-var encryption migration).
5. Drizzle generation toolchain, `auth:generate`, and the offline OpenAPI generator script.
6. The vitest e2e harness (shared Postgres container, global setup/teardown) and 16 e2e specs, including all mesh workflows.
7. Docker-compose dev default (`api-dev`), the `deployer-api` swarm provisioning path (shape A), the Dockerfile default scope, and the deploy-workflow version source.
8. Health indicators/repositories/services (reduced intentionally, but then dead tables remain).
9. Scalar API reference UI (dependency only; UNVERIFIED whether it was wired in main.ts).
10. Doc and handbook content in apps/api (`ARCHITECTURE.md`, `E2E_*.md`).

## 6. Ordered cutover checklist
| # | Step | Depends on | Effort |
|---|---|---|---|
| 1 | Decide the final topology (kill shape A and shape C; single `DEPLOYER_API_TARGET=svc-bff`) and record it | none | S |
| 2 | Move `drizzle.config.ts`, `db:generate/push/studio` and `auth:generate` into `packages/nest/schema` (out = canonical dir), delete the stale mirror, journal or delete 0040, regenerate snapshots | 1 | M |
| 3 | Port `backfill-env-secrets` to the BFF CLI and fix `looksEncrypted` | 2 | M |
| 4 | Port the builder strategy registry to `runtime/modules/deployment/builders` (+ spec) | none | M |
| 5 | Port the trigger registry and webhook routing, add a system-actor concept (the real blocker for auto-deploy), and fix the fleet webhook `serviceId` placeholder | 4 | L |
| 6 | Port the analytics download controller (identity) and decide on the offline OpenAPI script (BFF or `packages/contracts`) | none | S |
| 7 | Extract the e2e harness into a package or `apps/api-services/shared`: `vitest.global-setup/teardown/shared-postgres` and the `shared-api-runtime` fork; fix `tooling/vitest/src/service.ts` so it no longer requires `apps/api` | none | M |
| 8 | Port or consciously drop the 16 e2e specs (mesh-workflows first) and the missing user/analytics/push/service specs | 7 | L |
| 9 | Re-point compose: make `docker-compose.services.dev.yml` the default in the root `docker-compose.yml`; remove `api-dev`, `build-api`, `DEPLOYER_API_IMAGE`, `common/api/*.dev|prod.yml` | 1, 7 | M |
| 10 | Re-point images: `builder/deployer/Dockerfile.prod`, `Dockerfile.api.prod` defaults and healthcheck; `deploy.yml` version source (use root or a dedicated package) | 9 | M |
| 11 | `apps/setup`: remove `ApiServiceProvisioner` shape A, `apiServiceName`, and `api-dev`/`deployer-api` defaults; target `svc-bff` | 1, 9 | M |
| 12 | Scripts/tooling: `check-di-graph.ts` (retarget to bff + services), `verify-mesh-master-decision.ts`, `check-swarm-cli-lock.sh`, `diagnose-build.ts`, `sync-api-vitest-aliases.py`, `application-detector` profile map, `knip.config.ts`, root `package.json` scripts | 7, 9 | M |
| 13 | Move still-useful docs, run `grep -r "apps/api"`, update AGENTS.md and the doc site | 2-12 | M |
| 14 | `git rm -r apps/api`; drop the `"monolith"` TableOwner and the eslint carve-out; tighten ownership | 1-13 | S |
| 15 | Optional but advised first: fix the 4 `@repo/*` imports (S) just to get one last green run of apps/api e2e as a baseline against the new tier | none | S |

Estimated total: about 2-3 weeks of one engineer. The long poles are 5 and 8.

## 7. New capabilities the microservice and mesh architecture enables

Grounded in what exists: `packages/nest/service-client` (per contract registry), `packages/nest/supervisor-core` (supervisors + event bus), `packages/nest/events` (outbox), `packages/nest/schema/src/ownership/table-ownership.ts` (ownership by symbol), `apps/api-services/shared/src/server` (bootstrap, preflight, `service-health.ts`), `apps/mesh-agent`, `ServicesTierProvisioner` (`apps/setup/.../services-tier-provisioner.service.ts`).

| # | Capability | Design sketch | Prerequisites | Priority |
|---|---|---|---|---|
| 1 | Isolate the docker.sock holder | Only svc-runtime (docker domain) and the supervisor host mount the socket; everything else loses `appMounts` (see `services-tier-provisioner.service.ts:395-430`). Add a narrow socket proxy (read-only except runtime). Cuts the blast radius of any BFF/identity bug. | Move the swarm and supervisor ownership out of the BFF into fleet/runtime; fix the non-root vs socket permissions | High |
| 2 | Independent scaling and rolling deploy per service | Per-service replicas and `start-first` with real readiness; runtime scales for builds, identity for read traffic | Externalise in-process streams (outbox publisher, LISTEN/NOTIFY or Redis, which finally gives the phantom Redis dependency a purpose); leader election for migrations and supervisors; real HEALTHCHECK per app | High |
| 3 | Event outbox consumers | Make `LocalEventOutboxDispatcherService` publish (today only `markSent`) to named consumers: identity (notifications/push), health (SLO feed), audit. `eventId` dedup and `claimDue` already exist | A subscriber registry and consumer cursors; remove the in-memory projector cursor in runtime | High |
| 4 | Per-service Postgres roles from the ownership registry | Generate `GRANT` per owner from `TABLE_OWNERSHIP`; each service connects with its own role. Turns convention into a boundary and exposes cross-ownership writes (auth tables written by BFF) | Resolve shared tables and the BFF auth writes; per-service DB URL in preflight | High |
| 5 | Service identity / signed actor claim | BFF signs an actor claim and services verify it; background callers get a service token. Fixes the anonymous svc-project to svc-fleet DNS call and webhook/trigger actor gap (needed for item 5 in §6) | Single client stack (`ServiceClient` vs `service-client`) | High |
| 6 | Per-service SLOs and health dashboards | `svc-health` becomes the SLO aggregator: consumes outbox/metrics events, stores latency and error budget per procedure; BFF roll-up already probes `/health/ready` | Replace `supervisors: []` stub; request-id propagation; metrics from service-client | Medium |
| 7 | Canary / blue-green of the platform itself | Tier provisioner already creates `svc-*` with named services. Run `svc-X-canary`, shift the BFF `ServiceClientRegistry` address by percentage (or per user), and compare errors before promoting | Registry address override per request; health gate; rollback via provisioner | Medium |
| 8 | Per-node services | Mesh-agent plus swarm placement: run svc-runtime per node as a sidecar for local docker, with fleet routing via `meshInternal` (`mesh.controller.ts:552-603`, not delegated by the BFF today) | Route `meshInternal` through the BFF or a direct ingress rule; replace `StubMeshNodeCaller`; one home for `MeshCoreModule` | Medium |
| 9 | Plugin services | A service implementing a published contract (providers: git, DNS, builders, runners) registered in a catalog; the BFF delegation proxy loads contract leaves at runtime (`service-client/contract-leaves.ts`). Builder/runner strategy registries (see §6 step 4) become remote | Generic contract-driven proxy replacing the 315 generated forwarders; plugin auth; schema versioning | Medium (strategic) |
| 10 | Multi-region / multi-tenant control plane | One BFF per region with the shared fleet mesh; ownership registry decides who may write which table | Mesh CRDT primitives exist (`lww-map`, HLC, fencing token in `core/modules/mesh/shared/primitives`) | Low |
| 11 | Rate limiting and bulkheads per service | Timeouts, retries and circuit breakers in the BFF registry; per-service concurrency caps | None | High (cheap, fixes today's hang risk) |
| 12 | Independent release cadence and contract versioning | Version contracts per package (`@deployer/*-contracts`); compatibility check in CI via the parity script (`check-service-surface-parity.py`) | Wire the parity script and generator drift check into CI | Medium |

## 8. Risks
- Deleting before step 7 breaks every service's `vitest` config at load (`resolveWorkspacePaths` throws), so no test runs at all.
- Deleting before step 2 removes the only migration-generation path; the schema package is then unmaintainable without hand-written SQL (0039/0040 were already hand-written, with 0040 not journaled).
- Steps 4 and 5 carry a behaviour risk: the monolith copy is newer in places, and a naive "new tier wins" merge would silently drop the builder fix.
- The default dev workflow is still the monolith (root compose). Switching it changes every developer's loop; the services profile needs a validation run first. NOT VERIFIED here: I did not boot either stack.
- "Likely identical" verdicts for about 150 differing core files and about 60 module files rest on spot checks (bootstrap, outbox, default-admin, edge-provider, fleet-rollback, runners, webhooks controller). Run a full semantic diff of mesh/*, domain/*, auth/orpc/* and deployment/{queue,services,mesh} before deletion.
- Working tree is a huge uncommitted restructure (about 1060 deleted files under apps/api). Commit or branch before deleting anything so the monolith is recoverable from history.
- Security gaps in the new tier (anonymous setup surface, "logged in not allowed" authorization, anonymous service-to-service calls) are not closed by the cutover; the monolith has the same global-guard-only model, so they are not regressions, but cutover makes them the only line.
