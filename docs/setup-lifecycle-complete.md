# Setup & Boot Lifecycle — Complete Reference

> **Status:** Canonical reference (keep in sync with code changes)
> **Scope:** `apps/api/src/main.ts`, `core/orchestrator`, `core/setup-dev`, `core/modules/setup`,
> `sub-apps/setup-wizard`, `sub-apps/mesh-initializer`, `apps/web` (setup gate), `docker/compose`, CLI
> **Last verified:** 2026-09-07 (commit `3872255d`)

This document describes **every** way the platform can come up — fresh install, restart,
degraded state, dev compose stack, production self-supervised stack, mesh remote join,
multi-node mesh dev cluster, and CLI-only bootstrap. It is written so that a reader can
predict the exact boot outcome for any env + SQLite state combination.

---

## 1. Core model: the local SQLite `node_config` row

The **single source of truth** for setup state is one row in the local SQLite database
(`apps/api/src/config/drizzle/local/schema/node-config.ts`, file `/app/data/local.db` in
containers). Everything downstream — the global Postgres pool factory, the setup wizard,
the mesh initializer — reads from this row.

Key columns (semantics that matter):

| Column | Meaning |
|---|---|
| `nodeId` | Random UUID generated on first provisioning. **Not** derived from env. |
| `strategy` | `'local'` (node owns/points at a Postgres) vs `'remote'` (node joined a mesh and uses the mesh owner's DB). |
| `setupState` | `not_started` \| `setup_in_progress` \| `setup_done` \| `upgrade_pending` \| `upgrade_in_progress` \| `upgrade_failed` |
| `databaseUrl` | The **mandatory** Postgres URL. `setup_done` without a non-empty `databaseUrl` is treated as **corrupt** and re-provisioned. |
| `databaseProvisioning` | `'local'` (this node spawned a Docker Postgres container, supervised by `GlobalDbSupervisorService`) vs `'external'` (compose-managed or operator-supplied — never supervised). |
| `configuredAt` | ISO timestamp of when setup completed. |
| `meshUrlsSnapshot` | Peer URLs discovered at join time; survives restarts. |
| `meshSharedSecret` / `peerServiceToken` | Remote-join credentials (token has expiry). |
| `deployerVersion` | Version at setup time (used by `node-startup-check` for upgrade gating). |

**Invariant:** *the global Postgres is mandatory in every mode. There is no "no-database"
boot.* A `setup_done` row with an empty `databaseUrl` is always reset (see §4.3).

The state snapshot exposed to the web lives in
`packages/contracts/entities/src/entities/setup/state.schema.ts`
(`SetupStateSnapshot`: `state`, `needsSetup`, `hasUsers`, `bootstrapStrategy`,
`availableStrategies`, `currentStep`, `progressPercent`, `steps`, `completedAt`).

> ⚠️ **Known quirk:** `hasUsers` is **hardcoded** (`true` whenever a config exists,
> `false` otherwise) — it never queries Postgres. It is not load-bearing for any gate today
> (web uses `needsSetup`), but it is misleading.

---

## 2. Boot anatomy

`bun dev` in `apps/api` runs `src/main.ts`:

```
main.ts
├─ PHASE 1: bare Express gateway on API_PORT (CORS → /health → …)
├─ PHASE 2: NestFactory.create(OrchestrationModule)  → app.init()
│   └─ OrchestratorService.onApplicationBootstrap()  → sub-app pipeline
└─ PHASE 3: signal handlers
```

The orchestrator pipeline (`core/orchestrator/orchestrator.service.ts`):

```
runDbResolver()          // headless SetupDevModule context (dev only logic, see §3)
writePlatformConfigs()   // Traefik dynamic config so api.*/web.* are reachable even pre-DB
stale-config guard       // setup_done + empty URL → reset to not_started
load config + refreshManagedDatabaseUrl()
        │
        ├── databaseUrl exists ──► isConfigured? ── no ──► tryHealFromGlobalDb
        │                              │ yes                     │ healed? ── yes ─┐
        │                              ▼                         └ no ──► wizard   │
        │                         ensureDatabaseAvailable                        │
        │                         runGlobalMigrations()                           │
        │                         bootstrapSeededAdmin()   ← admin creation       │
        │                         lifecycle READY                                  │
        │                         emitSetupWizardBridge ──► mesh-initializer ──► main-app
        │
        └── no URL ──► env URL present? ── yes ──► tryHealFromGlobalDb(envUrl)
                          │ no / heal failed              │ healed ──► same main flow
                          ▼                               └ no ──► wizard
                     startSetupWizard()   (port 3010)
                     waitForSetupAndContinue()  ← event-driven via InitializationService
```

The three sub-apps are:

| Sub-app | Port | Role |
|---|---|---|
| `setup-wizard` | 3010 | Serves `/setup/*` ORPC surface; drives local/remote initialization; fires `SetupWizardBridge` when done |
| `mesh-initializer` | 3011 | Discovers/joins mesh peers, persists `meshUrlsSnapshot`, fires `MeshInitializerBridge` |
| `main-app` | 3012 | Full `AppModule` (all feature routes); becomes the fallback target |

Cross-sub-app communication is via static bridge classes (`SetupWizardBridge`,
`MeshInitializerBridge`) — no forwarded DI providers.

> **First-boot event-persistence race (fixed 2026-09-07):** the setup wizard emits
> progress/log events *while* `LocalInitializationService` runs the global migrations that
> create the `core_event_logs` audit table (migration `0006`). Previously a flush hitting that
> table before it existed **dropped the batch and logged a huge error** (`relation
> "core_event_logs" does not exist` with thousands of serialized params). `BaseEventService`
> persistence is now resilient: failed batches are re-queued and retried with backoff until
> the table exists (audit events are always kept, bounded by a 10k cap), and failures log a
> single compact WARN. The wizard stream works in-memory regardless (see
> `setup-event.service.ts` / `packages/nest/events/src/base-event.service.ts`).

---

## 3. Phase-0 dev bootstrap (`SetupDevService`)

`core/setup-dev/setup-dev.service.ts` runs **only when `NODE_ENV !== 'production'`**, inside
a throwaway NestJS context. Its job: make sure a Postgres URL exists in SQLite *before* the
gateway pipeline reads it. Branch order (first match wins):

| Case | Condition | Behavior |
|---|---|---|
| **0** | `MANAGED_GLOBAL_DB_ENABLED=true` (compose-managed dev stack) | Resolve compose URL (`MANAGED_GLOBAL_DB_HOST/PORT/USER/PASSWORD/NAME`), probe once (unreachable → log-only). **Persist the URL as a SETUP CANDIDATE** — `setupState` stays `not_started`, `configuredAt` omitted — so the node still runs the real setup against it. Never downgrades an already-`setup_done` node. |
| **1** | `databaseUrl` already in SQLite | Log `♻️ Database URL already in node_config` and skip (whether that URL is a candidate or a completed config — the orchestrator decides). |
| **2** | `SETUP_AUTO=true` **and** `SETUP_AUTO_DATABASE_URL` (or legacy `SETUP_DATABASE_URL`) is non-empty | Probe URL. Reachable → persist as **setup candidate** (`not_started`, no `configuredAt`). **Unreachable → throw** (fatal; orchestrator re-raises in SETUP_AUTO mode). |
| **3** | `SETUP_AUTO=true`, no URL | Persist **nothing** — the setup wizard will auto-provision a Docker Postgres container (§4.4). |
| **fallback** | everything else (`SETUP_AUTO` not true) | Persist nothing → wizard runs in manual mode. |

> **Candidate semantics (2026-09-07):** a *provided* database (compose-managed or explicit
> URL) is **not** a completed setup — the schema/migrations and the initial admin may still be
> missing. Phase 0 therefore persists the URL WITHOUT setting `setup_done`/`configuredAt`.
> `LocalInitializationService` then treats that candidate as its default database
> (instead of spawning a second container), so selecting the default "managed" path in the
> wizard uses the provided DB.
>
> **Provisioning policy (2026-09-07):** the boot decision is a single derived object
> (`core/setup-dev/provisioning-policy.ts`) logged as `[ProvisioningPolicy] …` at boot
> (in both `OrchestratorService` and `SetupDevService`). It resolves the mode
> (`compose_managed` / `explicit_url` / `managed` / `manual`), the provided URL, the admin
> bootstrap decision (§5) and whether an unreachable probe is fatal. A compose-managed DB is
> **fatal** when `SETUP_AUTO=true` (aligned with explicit-URL mode) and **logs-only** when
> `SETUP_AUTO=false` (the human wizard stays alive to fix it).

---

## 4. The complete case matrix

Conventions for the tables below: rows in **SQLite** are from `node_config`; "fresh" means no
row at all; "empty DB" means Postgres reachable but `information_schema.tables` empty.

### 4.1 Case A — Composition-managed dev stack, first boot (the common "dev" case)

Trigger: `docker compose -f docker-compose.yml up` (includes
`docker/compose/docker-compose.dev.yml`), `MANAGED_GLOBAL_DB_ENABLED=true`,
`SETUP_AUTO` defaulting to the `.env` value.

1. `global-db` + `redis` start first (`depends_on: service_healthy`).
2. `SetupDevService` CASE 0 persists the compose URL **as a setup candidate**
   (`not_started`, no `configuredAt`) → `needsSetup=true`.
3. Orchestrator: URL present but not configured → `tryHealFromGlobalDb`:
   - compose DB is fresh/empty (0 tables) → heal fails → **setup wizard starts**;
   - DB already has tables (reused volume) → heal writes `setup_done` and the direct
     path runs (migrations → `bootstrapSeededAdmin` → main-app).
4. With `SETUP_AUTO=true` (`.env` default): the wizard sub-app **auto-triggers** local
   initialization against the **provided URL** — `LocalInitializationService` falls back to
   the persisted candidate when no explicit URL is submitted — and runs migrations →
   seeds the default admin → registers the node → fires the bridge → mesh-init → main-app.
5. Manual (`SETUP_AUTO=false`): the wizard UI shows; the local Database step defaults to
   "Managed PostgreSQL", which server-side resolves to the **provided** compose DB
   (no second container is spawned); the account step then completes migrations + admin.
6. Web: `WithSetup` sees `needsSetup=true` during setup (redirects to `/setup`); after
   completion `needsSetup=false` and sign-in works with the created admin.

Outcome: setup is **actually performed** (schema + admin user), never declared done just
because an env var pointed at a Postgres.

> If the admin creation used to fail silently, the cause was `drizzle(pool)` created
> **without** `{ schema: globalSchema }` (Better Auth: *The model "user" was not found in
> the schema object*). Fixed in `ensureDefaultAdmin`; the wizard path is also now
> idempotent (existing email → promote).

### 4.2 Case B — Dev, SETUP_AUTO=true + explicit URL (no compose-managed DB)

- `MANAGED_GLOBAL_DB_ENABLED` unset/false; `SETUP_AUTO=true`;
  `SETUP_AUTO_DATABASE_URL` or `SETUP_DATABASE_URL` set.
- `SetupDevService` CASE 2 probes the URL: reachable → persist as **setup candidate**
  (`not_started`, no `configuredAt`) → same wizard path as Case A (auto-init or manual)
  against that URL. Unreachable → **process refuses to boot** (fatal).
- The **mesh-6** dev cluster (§4.9) sets `MANAGED_GLOBAL_DB_ENABLED=true` too, so it runs
  through Case A's candidate path (the explicit `SETUP_DATABASE_URL` matches the composed URL).

### 4.3 Case C — Dev, SETUP_AUTO=true, no URL → wizard auto-provisions Postgres

- `MANAGED_GLOBAL_DB_ENABLED` unset/false, `SETUP_AUTO=true`, no explicit URL.
- `SetupDevService` CASE 3 persists nothing.
- Orchestrator: no URL in SQLite, no env URL → `startSetupWizard()`.
- `SetupWizardService.onModuleInit` (sub-app) sees `SETUP_AUTO=true` and **auto-triggers**
  local initialization using `DEFAULT_ADMIN_*` (or built-in defaults):
  1. `LocalInitializationService.initialize`:
     - `provision_database` → **spawns a `postgres:16-alpine` Docker container** via
       `PostgresContainerService` (host port auto-assigned, VOLUME
       `deployer_postgres_data`), or probes an operator-supplied URL.
     - `ensure_empty` → if 0 tables: `run_migrations` (Drizzle global migrations) →
       `seed_initial_data` (creates admin through Better Auth `signUpEmail` +
       promote `superAdmin`). **If tables already exist: migration + seed are skipped.**
     - `register_node` → persists `setup_done` with `databaseProvisioning='local'`.
     - `finalize`.
  2. On `completed` (stream): fire `SetupWizardBridge` → mesh-init → main-app.
  3. On `aborted`/`error`: **`process.exit(1)`** — SETUP_AUTO must never degrade into a hang.
- Result: setup **is** needed (wizard page briefly) — but the wizard runs itself, the user
  doesn't fill a form.

### 4.4 Case D — Dev, SETUP_AUTO=false / unset → fully manual wizard

- `SetupDevService` fallback persists nothing.
- Wizard sub-app serves `/setup/*`; `SetupWizardService` does **not** auto-trigger; it
  subscribes to the stream and waits for a human.
- User flow: `/setup` → choose strategy (`local` vs `remote`) → fill account form
  (local) or mesh URL + remote auth (remote) → `probeDatabase`/`probeMesh` pre-flight →
  `triggerInitialize` → SSE `getInitializeStream` progress → `completed` → bridge →
  mesh-init → main-app.
- Web gates (see §6) redirect everything to `/setup` until done.

### 4.5 Case E — Restart of an already-configured node

- SQLite has `setupState=setup_done` + non-empty `databaseUrl`.
- `SetupDevService` CASE 1: skip (dev only). Orchestrator: `refreshManagedDatabaseUrl`
  (re-reads the current mapped port when `databaseProvisioning='local'` and Docker recreated
  the container — host port drift heal) → configured → verify → migrations → admin no-op
  (`ensureDefaultAdmin` idempotent: existing user → ensure `superAdmin`, else untouched) →
  mesh reconnect (`InitializationService.onModuleInit` reconnects to `meshUrlsSnapshot`
  with persisted `peerServiceToken`) → main-app.

### 4.6 Case F — Degraded/corrupt SQLite states

| SQLite state | Behavior |
|---|---|
| No row at all | Wizard (manual or SETUP_AUTO auto-provision). |
| `setupState=setup_done` + **empty** `databaseUrl` | Orchestrator stale-config guard **resets to `not_started`** → re-provision. |
| `databaseUrl` present but `setupState` ≠ `setup_done` (`not_started`/interrupted) | `tryHealFromGlobalDb`: probe DB; if reachable **and** has ≥1 table → rewrite row to `setup_done` and continue the main flow; else → wizard. |
| `configuredAt` present but empty URL (partial write) | Treated as unconfigured — wizard re-provisions. |

### 4.7 Case G — Production compose stack (`docker-compose.prod.yml`)

- `api-prod`: `NODE_ENV=production`, `SETUP_AUTO` default `true`, **no** `MANAGED_*` flags →
  the API **supervises every dependency at runtime** (`GlobalDbSupervisorService` spawns
  Postgres, Redis, Traefik, local SQLite, managed web).
- `SetupDevService` is skipped (production guard) → no Phase-0 injection; the URL is resolved
  by the **wizard path**: `SETUP_AUTO=true`, no URL in SQLite → wizard auto-provisions a
  supervised Postgres container (same as Case C, but `databaseProvisioning='local'` and the
  supervisor owns the lifecycle).
- Admin creation gate differs from dev:
  `bootstrapSeededAdmin`: `NODE_ENV=production` → enabled only when
  `ENABLE_SEEDING === 'true'` (opt-in, set in `.env.prod`). The wizard path seeds the admin
  inside `seed_initial_data` on an empty DB regardless.

### 4.8 Case H — Remote / edge node join (mesh strategy)

1. Wizard "remote" branch: user enters a mesh URL, authenticates against the remote node
   (`setup.remoteAuth` → session cookie / token).
2. `InitializationService.runRemoteFlow`:
   - `reachability_check` — probe mesh URL.
   - `RemoteInitializationService.initialize`:
     - `mesh_handshake` — `issueRemoteJoinGrant` (auth'd) → `bootstrap()` → receives
       `nodeId`, `databaseUrl` (the **mesh owner's** DB), `peerServiceToken`,
       `meshSharedSecret`.
     - `version_check` — semver against remote: local **behind** → join **blocked**; local
       **ahead** → join allowed with warning.
     - `register_node` — collect peer URLs.
     - `finalize` — persist `strategy='remote'`, `databaseProvisioning='external'`,
       token + secret + `meshUrlsSnapshot`.
3. `waitForSetupAndContinue` verifies the completed setup carries a real `databaseUrl` or
   **fails hard**.
4. Every subsequent restart: `onModuleInit` reconnects to persisted mesh peers using the
   persisted token (falls back to token-less public ping if token gone).

### 4.9 Case I — Mesh-6 dev cluster (`docker-compose.mesh-6.dev.yml` / `-supervised`)

- Six `api-N` services, each extending the common dev base, **sharing one compose-managed
  `global-db`** via `SETUP_DATABASE_URL=postgresql://deployer:deployer@global-db:5432/deployer`,
  with `SETUP_AUTO=true` (added so first boot auto-provisions against the shared DB
  instead of waiting at a wizard).
- Each node runs Case A's candidate path (managed DB). Because they share the same
  Postgres, node 1 migrates + seeds on an empty DB; nodes 2–6 find tables and
  **skip migration/seed** (`ensure_empty` returns non-empty → skip). Seeding is now
  **idempotent** (existing email → promote to super-admin), so concurrent first boots
  against the same DB cannot fail on a duplicate user.
- Tip: only the primary (`api-1`, port 3301) should be treated as the seed node for
  first-time setup — the rest converge against the same database.

### 4.10 Case J — CLI-only bootstrap (no HTTP wizard)

Commands (`apps/api/src/cli`, run as `bun --bun src/cli.ts <cmd>`):

| Command | Purpose |
|---|---|
| `setup-db [--url=…]` | Persist a DB URL into SQLite (`--url` wins over `SETUP_DATABASE_URL`; fails with help text if neither). |
| `migrate` | Apply global Postgres migrations against the resolved URL (`node_config` → `SETUP_DATABASE_URL`). |
| `seed` | Seed workspace data (local variant seeds the default admin through `CliAuthService`). |
| `create-default-admin` | Ensure the default admin exists. **Changed in `3872255d`:** missing `DEFAULT_ADMIN_EMAIL` now **gracefully skips** instead of failing env validation; missing password → generated + logged by the service. |
| `reset` | Reset local node config (back to first-boot state). |
| `node-startup-check` | Exit-code contract (0 ready · 1 version mismatch · 2 never started · 3 interrupted · 4 failed/upgrade-failed) for entrypoint scripts; also guards Swarm CLI-lock violations. |

> ⚠️ **Doc drift:** the `.env` comment still references `bun --bun src/cli.ts setup` — that
> command does **not** exist. The real "points a URL at the app" command is `setup-db`.

---

## 5. Admin user creation — the paths (and when each fires)

All go through the **Better Auth service-side API** (`auth.api.signUpEmail`) then
promote to `superAdmin` + `emailVerified=true` (single source of truth for password hashing /
credential issuer — hardcoding would break `INVALID_EMAIL_OR_PASSWORD`).

| # | Code path | Fires when | Failure behavior |
|---|---|---|---|
| 1 | `LocalInitializationService.seedInitialData` (wizard local init) | DB was empty during local initialization against a provided DB (Cases A/B/C/D) or a provisioned container; **idempotent** (existing email → promote) | Propagates → step fails → aborted event → SETUP_AUTO exits |
| 2 | `ensureDefaultAdmin` (`core/setup-dev/default-admin.bootstrap.ts`) via `OrchestratorService.bootstrapSeededAdmin` | Ready DB URL, **after migrations**; gate = **ProvisioningPolicy admin decision** (§3): `ADMIN_BOOTSTRAP` + deprecated aliases (Cases A/B/E/G-healed) | **Non-silent since 2026-09-07** — returns `created\|promoted\|existed\|failed`; on `failed` when the decision requires the admin, the orchestrator **fails the boot** (no more orphaned installs) |
| 3 | `create-default-admin` CLI / `CliAuthService.ensureDefaultAdminUser` | Operator-initiated | Exit code / logged |

**Admin gate (`ADMIN_BOOTSTRAP`, resolved by `provisioning-policy.ts`):**

| Value | Behavior |
|---|---|
| `auto` (default) | mode-based: `compose_managed`/`explicit_url` → **always**; `managed`/`manual` → **when_empty** |
| `true` | always ensure the default admin after migrations |
| `false` | never auto-create (wizard/CLI only) |

Deprecated aliases honoured **only** when `ADMIN_BOOTSTRAP` is unset (and warn):
`ENABLE_DEV_BOOTSTRAP` (dev), `ENABLE_SEEDING` (prod).

Env that feeds admin creation: `DEFAULT_ADMIN_EMAIL` (default `admin@admin.com`),
`DEFAULT_ADMIN_PASSWORD` (default `adminadmin`), `DEFAULT_ADMIN_NAME` (wizard auto-trigger
only), `DEV_AUTH_KEY`, `AUTH_SECRET`/`BETTER_AUTH_SECRET`.

---

## 6. Web-side gating

| Surface | Behavior |
|---|---|
| `middlewares/WithSetup.ts` (Next middleware) | Calls `setup.getState` (3 s timeout; on timeout/error it **fails-open** and skips the gate). `needsSetup=true` → everything except `/setup/*` redirects to `/setup?redirectTo=…`. |
| `app/setup/page.tsx` | Calls `setup.getState`; `needsSetup=false` → `redirect(AuthSignin)` (you cannot visit `/setup` on a configured node). Else renders `<SetupWizard/>`. |
| `app/auth/signin/page.tsx` | `SetupGate` leaf: `needsSetup=true` → `router.replace(/setup)` with spinner overlay. |
| `app/auth/signup/page.tsx` | Same gate (redirects to `/setup` when needed). |

---

## 7. Contradictions & traps discovered (as of `3872255d`)

1. **`MANAGED_GLOBAL_DB_ENABLED=true` no longer auto-completes setup** (changed 2026-09-07):
   providing a DB only persists a *setup candidate* (`not_started`, no `configuredAt`); the
   real setup (migrations + admin) runs against it through the wizard / auto-init. The old
   missing-admin bug (`drizzle(pool)` without `{ schema: globalSchema }`) is fixed in
   `ensureDefaultAdmin`, and seeding is now idempotent.
2. **Case 0 probe is now fatal when `SETUP_AUTO=true`** (aligned with Case 2) and logs-only
   when `SETUP_AUTO=false` — driven by `ProvisioningPolicy.fatalIfUnreachable`
   (changed 2026-09-07).
3. **`ENABLE_SEEDING` / `ENABLE_DEV_BOOTSTRAP` are now deprecated aliases** of
   `ADMIN_BOOTSTRAP` (changed 2026-09-07); an alias used without the canonical switch logs a
   warning.
4. **`.env`/`.env.example` reconciled**: `SETUP_AUTO` comment now matches the value, the
   stale `setup` CLI reference and the one-shot-container comment were removed, and
   `ADMIN_BOOTSTRAP` is documented.
5. **`hasUsers` is now truthful** (cached background probe of the `user` table, changed
   2026-09-07) instead of a hardcoded guess.
6. **`ensureDefaultAdmin` is non-silent** (changed 2026-09-07): returns
   `created|promoted|existed|failed`; the orchestrator fails the boot when an admin is
   required but cannot be created.
7. **Two orchestrator branches share one `runReadyPipeline`** (changed 2026-09-07): the
   local-config and env-healed branches both converge on the same verify → migrate → admin →
   bridge → mesh → main sequence, and both call the policy-gated admin bootstrap.
8. **Still open:** web `/setup` is not mode-aware yet; CLI `setup` alias + one-shot
   containers deferred; env-schema conflict rejection (e.g.
   `MANAGED_GLOBAL_DB_ENABLED=true` with `SETUP_AUTO_DATABASE_URL`) not yet added.