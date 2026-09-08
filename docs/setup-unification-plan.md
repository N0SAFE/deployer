# Setup Behavior Unification — Proposal & Enhancement Plan

> **Status:** Partially implemented — see [Implementation status](#implementation-status-) below
> **Audience:** core architecture, infra, web auth
> **Related:** [`docs/setup-lifecycle-complete.md`](./setup-lifecycle-complete.md) (current behavior reference)

This document proposes a **unified provisioning model** replacing today's overlapping
env-gated branches. It is deliberately concrete: each section names the current files/functions,
the problem, and the target design, so the plan can be executed incrementally without a big-bang
rewrite.

---

## Implementation status ✅

| Step (§9) | Status | Notes |
|---|---|---|
| 1 — `ProvisioningPolicy` + boot log | ✅ done | `core/setup-dev/provisioning-policy.ts`; logged in OrchestratorService + SetupDevService |
| 2 — `ensureDefaultAdmin` result contract, no swallow | ✅ done | `default-admin.bootstrap.ts` returns `created\|promoted\|existed\|failed` |
| 3 — Case 0 probe failure fatal | ✅ done | fatal when `fatalIfUnreachable` (compose/explicit + SETUP_AUTO) |
| 4 — real `hasUsers` (cached probe) | ✅ done | cached background probe in `InitializationService` |
| 5 — `ADMIN_BOOTSTRAP` + alias deprecation | ✅ done | schema + policy; alias warns |
| 6 — `resumePipeline` extraction | ✅ done | `runReadyPipeline` used by both ready branches |
| 7 — web `/setup` mode-aware + admin status | ⛔ not started | web only; not required for boot correctness |
| 8 — CLI/docs/.env reconciliation | 🟡 partial | `.env`/`.env.example` reconciled; CLI alias + one-shot containers deferred |
| 9 — env schema validation (full policy matrix + conflict checks) | 🟡 partial | `ADMIN_BOOTSTRAP` added; conflicting-combo rejection not added |

---

## 1. Problem statement

Today, "how does the app come up" is the **product of at least seven independent switches**:

| Switch | Default (dev compose) | Default (prod compose) | Actual use |
|---|---|---|---|
| `MANAGED_GLOBAL_DB_ENABLED` | `true` | unset | Forces Case A shortcut (bypasses wizard) |
| `SETUP_AUTO` | `${SETUP_AUTO:-false}` (via `.env`) | `true` | Auto-triggers wizard / explicit-URL persist |
| `SETUP_AUTO_DATABASE_URL` vs `SETUP_DATABASE_URL` | — | — | Two names for the same concept (legacy alias) |
| `ENABLE_DEV_BOOTSTRAP` | `true` (compose) | unused | Dev gate for `ensureDefaultAdmin` |
| `ENABLE_SEEDING` | `false` (`.env`) | `true` opt-in | Prod gate for `ensureDefaultAdmin`; **dev-dead** |
| `DEFAULT_ADMIN_EMAIL/PASSWORD/NAME` | `admin@admin.com/adminadmin` | same | Admin credentials |
| `NODE_ENV` | `development` (Dockerfile) | `production` | Routes entire phase-0 + admin gate |

The observable consequences (all encountered in the last commit cycle):

1. **Same symptom, three different root causes:** "setup not needed + no default user" was
   (a) the design of `MANAGED_GLOBAL_DB_ENABLED` (wizard skipped), (b) a silent
   `ensureDefaultAdmin` failure (`drizzle(pool)` without `schema`), and (c) `NODE_ENV`
   misconfiguration in `.env`. No single decision point surfaces which one occurred.
2. **`ENABLE_SEEDING` is dead in dev** while the old `api-db-seed-dev` one-shot containers
   were removed — the concept of "seeding" is now three different functions
   (`seedInitialData`, `ensureDefaultAdmin`, `CliAuthService.ensureDefaultAdminUser`) with
   subtly different gates.
3. **State truthiness is guessed, not checked:** `hasUsers` is hardcoded; `setup_done` +
   reachable-but-empty Postgres is treated as "configured".
4. **Failure modes are inconsistent:** Phase-0 Case 2 throws (fatal), Case 0 logs-only,
   `ensureDefaultAdmin` swallows, wizard SETUP_AUTO `exit(1)`, web middleware fails-open.
5. **CLI surface drifted** from documentation (`setup` vs `setup-db`, one-shot containers
   gone, etc.).

---

## 2. Target model: one `ProvisioningPolicy`, one boot decision

### 2.1 Single policy object

Replace the scattered `process.env.SETUP_AUTO` / `MANAGED_*` reads with a single derived
object built **once** at boot (`core/setup/provisioning-policy.ts`):

```ts
export type ProvisioningPolicy = {
  mode: 'compose_managed' | 'explicit_url' | 'managed' | 'manual'; // see §2.2
  dbSource: 'compose' | 'env_url' | 'docker_container' | 'supervisor';
  expectsWizard: boolean;        // would a human wizard ever be shown?
  adminPolicy: 'always' | 'when_empty' | 'never';
  fatalIfUnreachable: boolean;   // Phase-0 probe failure policy
};
```

Resolution precedence (replacing the scattered `if` chains in `setup-dev.service.ts`):

```
1. MANAGED_GLOBAL_DB_ENABLED=true        → mode=compose_managed  (URL assembled from MANAGED_*)
2. SETUP_AUTO=true && explicit URL set   → mode=explicit_url     (URL from SETUP_AUTO_DATABASE_URL ?? SETUP_DATABASE_URL)
3. SETUP_AUTO=true && no URL             → mode=managed          (wizard spawns container / supervisor owns it)
4. otherwise                             → mode=manual           (fully human-driven wizard)
```

Every branch of the orchestrator, `SetupDevService`, and `SetupWizardService` reads this
policy object instead of touching env directly. The policy is **logged as one line** at boot:

```
[ProvisioningPolicy] mode=compose_managed dbSource=compose expectsWizard=false adminPolicy=always fatalIfUnreachable=true
```

This alone removes the "same symptom, three causes" ambiguity — the boot log states the
decision, and the admin bootstrap adds its own result line (§3.2).

### 2.2 Mode semantics (mapped 1:1 to today's cases)

| Mode | Today's case(s) | After unification |
|---|---|---|
| `compose_managed` | §4.1 / §4.9 (Case A, mesh-6) | Wizard never shown; not a "setup needed" state; admin = `always`; probe failure = **fatal** (today it is logs-only — bug) |
| `explicit_url` | §4.2 / §4.9 (Case B) | Same as compose_managed but URL from env; probe failure = fatal (already today) |
| `managed` | §4.3 / §4.7 (Case C, prod) | Wizard runs but auto-triggers; admin seeded only when DB empty; supervised vs container-owned depends on `NODE_ENV` |
| `manual` | §4.4 (Case D) | Wizard human-driven; admin seeded only when DB empty (or via post-wizard bootstrap) |

---

## 3. Unify admin creation

### 3.1 Single `DefaultAdminService`

Today: three implementations with duplicated "Better Auth signUp + promote + emailVerified"
logic. Target: one `DefaultAdminService` (in `core/modules/auth`, exported app-wide) with:

```ts
ensureAdmin(opts: { connectionString: string; force?: boolean }): Promise<EnsureDefaultAdminResult>
```

- **Synchronous with the pool pattern already in `default-admin.bootstrap.ts`.**
- **Always returns a result**, never silent: `{ created | promoted | existed | skipped | failed: { error } }`.
- Callers decide failure policy — the service never swallows:
  - orchestrator `bootstrapSeededAdmin` → `failed` is now a **WARN + surfaced in lifecycle
    detail**, and (configurable) a hard fail for `mode !== 'manual'`.
  - wizard `seed_initial_data` → keep as today (step failure propagates).
  - CLI `create-default-admin` → same service, same result handling.

### 3.2 Admin gate consolidation

Replace `ENABLE_DEV_BOOTSTRAP` **and** `ENABLE_SEEDING` with one switch + derived defaults:

```
ADMIN_BOOTSTRAP=auto   # auto = mode-based default (see matrix)
ADMIN_BOOTSTRAP=true   # force always
ADMIN_BOOTSTRAP=false  # never
```

Mode-based default matrix (replaces today's dev/prod split):

| Mode | Default `ADMIN_BOOTSTRAP` | Rationale |
|---|---|---|
| `compose_managed` / `explicit_url` | `auto` → **always** | No wizard ever runs → admin must exist |
| `managed` | `auto` → **when_empty** | Wizard seeds on empty DB only |
| `manual` | `auto` → **when_empty** | Same |

Keep `ENABLE_DEV_BOOTSTRAP`/`ENABLE_SEEDING` accepted as aliases (deprecated, log a warning)
for backward compat with `.env.prod`.

---

## 4. Make state truthful

### 4.1 Real `hasUsers`

`InitializationService.getSetupState()` should answer `hasUsers` from an actual
`SELECT 1 FROM "user" LIMIT 1` against `databaseUrl` (with a short timeout, defaulting to
`false` on failure) instead of `config != null`. Cheap (one query) and makes the snapshot
contract meaningful.

### 4.2 `setup_done` = config **and** reachable **and** has-tables

Define a single `isNodeConfigured(config, probeResult)` used by the orchestrator heal logic,
`getSetupState`, and `node-startup-check`:

- `setup_done` + empty URL → corrupt (reset, as today).
- `setup_done` + unreachable DB → degraded: expose state `completed` with
  `detail:'unreachable'` instead of a hardcoded "configured".
- `setup_done` + reachable + 0 tables → `awaiting_db_config` (needs wizard/heal) — this
  closes the Case A "fresh but empty global-db" loophole by forcing the wizard when the
  compose-managed DB is empty (or, per policy, auto-seeding it).

### 4.3 Consistent failure policy

Document and enforce one matrix for "DB unreachable at boot":

| Mode | Behavior |
|---|---|
| `compose_managed` / `explicit_url` | **Fatal** (probe failure = boot failure) — today Case 0 is the odd one out |
| `managed` + `SETUP_AUTO` | **Fatal** (already: `exit(1)` on aborted/error) |
| `manual` | Non-fatal; keep wizard alive for the human |

Implementation: `SetupDevService` CASE 0 reuses the same `probe()` throw path as CASE 2.

---

## 5. Eliminate env duplication & doc drift

1. **One URL variable.** Deprecate `SETUP_DATABASE_URL`; keep as fallback read with a
   `DeprecatedEnvWarning` log. Canonical: `SETUP_AUTO_DATABASE_URL`.
2. **Reconcile `.env`.** Remove the stale `SETUP_AUTO=false` comment block that contradicts
   both the value and the code; add explicit `ADMIN_BOOTSTRAP`, `NODE_ENV` doc; delete the
   non-existent `bun --bun src/cli.ts setup` reference (replace with `setup-db`).
3. **CLI alignment.** Rename/add a `setup` alias for `setup-db` (or update the doc); keep
   `node-startup-check` as the entrypoint contract; run `create-default-admin` through
   `DefaultAdminService` (§3.1).
4. **One-shot containers.** Either re-add `api-db-migrate-dev` / `api-db-seed-dev` as compose
   profiles driven by the same `DefaultAdminService` + migrator (for ops who want explicit
   jobs), or delete the stale comments — pick one and update `docker/compose` accordingly.
5. **Env schema.** Centralize every switch in `@repo/env` (`apiEnvSchema`) so Zod validates
   the **whole** policy surface at boot and rejects unknown/conflicting combos
   (e.g. `MANAGED_GLOBAL_DB_ENABLED=true` **and** `SETUP_AUTO_DATABASE_URL` set → warn or
   hard error), instead of silently letting branch order decide.

---

## 6. Make the wizard surface mode-aware

`SetupWizardService` and the web `/setup` page should render based on `ProvisioningPolicy`:

- `compose_managed` / `explicit_url` → web **redirects to sign-in** (as today) but the API
  `/setup/state` also reports `state: 'completed'` **plus** `adminStatus` (from
  `DefaultAdminService` result cache) so "setup not needed + no admin" becomes a visible,
  debuggable state instead of a silent one.
- `managed` → wizard auto-triggers (today) but shows a distinct "Auto-provisioning" screen
  with option to **abort and go manual**.
- `manual` → current wizard, unchanged.

Similarly, the **web fail-open timeout** (`WithSetup`, 3 s) is fine for availability but must
log at WARN with the error — today a timed-out status check is invisible, which masks API
breakage behind "no redirect happened".

---

## 7. Phase-0 / orchestrator consolidation

1. **Fold `SetupDevService` into the policy-driven resolver.** Keep the separate headless
   Nest context (it is clean), but the branch body becomes a single `ProvisioningPolicy.resolve
   + apply()` call, removing CASE ordering bugs (doc §4.6 "corrupt" handling stays).
2. **Single "continue after setup" path.** Today `waitForSetupAndContinue` and the two
   in-line `databaseUrl` branches each re-implement: verify → migrate → admin → bridge →
   mesh → main. Extract `resumePipeline(status)` used by all three.
3. **Move `bootstrapSeededAdmin` onto the same path as wizard seeding** — the orchestrator
   should call `DefaultAdminService` with `policy.adminPolicy` in the *one* `resumePipeline`
   step, not in two bespoke spots.
4. **`hasUsers`/admin status caching:** `DefaultAdminService` returns a result the
   orchestrator publishes to the lifecycle detail + `/setup/state`, so ops can see
   "admin: created@09:41:02" in logs and UI.

---

## 8. Telemetry & observability

- Boot **decision log** (§2.1) — one line with the full policy.
- **Stage timings** around the four pipeline stages (resolve / verify+migrate / admin /
  mesh-init) using the existing `AppLifecycleService`, already wired — extend the message to
  include policy + admin result.
- `node-startup-check` already returns a rich JSON — extend it with `policy` + `adminStatus`
  so entrypoint scripts (and ops) see the same truth as the runtime.
- Add a **self-heal probe**: on every boot, if `policy.ensureAdmin('always')` and the admin
  check fails, log EXACT diagnostics (connect? schema? secret? duplicate?) — the three
  "same symptom" root causes become distinguishable log lines.

---

## 9. Migration path (incremental, no big bang)

| Step | Change | Risk |
|---|---|---|
| 1 | `ProvisioningPolicy` object + full boot decision log; keep existing branches internally | Low (pure refactor + log) |
| 2 | Fix `ensureDefaultAdmin` schema (done) + return-result contract; stop swallowing | Low |
| 3 | Make Case 0 probe failure fatal (align with Case 2) | Medium (behavior change on broken compose DBs — desired) |
| 4 | Real `hasUsers` query; `isNodeConfigured` truth function | Low |
| 5 | `ADMIN_BOOTSTRAP` switch + alias `ENABLE_*` deprecation warnings | Medium (env migration; `.env.prod` kept working) |
| 6 | `resumePipeline` extraction; remove duplicated orchestrator branches | Medium (covered by existing e2e: `apps/api/src/e2e/setup-workflows/*`) |
| 7 | Web `/setup` mode-aware rendering + admin status surfacing | Low |
| 8 | CLI/docs/.env reconciliation; one-shot container decision | Low |
| 9 | Env schema validation of the full switch matrix | Low |

Every step keeps the existing e2e suites green:
`apps/api/src/e2e/setup-workflows/{startup-lifecycle,tiered-startup-flow,setup-flow-all-scenarios,app-bootstrapping*}.e2e-spec.ts`
and the unit specs in `core/modules/setup/services/__tests__/*`, which already encode the
four boot scenarios — extend them with the policy-matrix cases as steps land.

---

## 10. Definition of done

- One boot log line that lets anyone predict/verify behavior from single source (policy).
- Admin bootstrap: one service, no silent failures, gate = `ADMIN_BOOTSTRAP` matrix.
- State snapshot: truthful (`hasUsers` queried, `setup_done` ≠ configured-without-tables).
- Dev/prod/manual/remote/mesh-6 all documented against the same policy table in
  `setup-lifecycle-complete.md`, with no `.env` comment drift.
- No environment variable has two names in use (legacy alias → warning only).