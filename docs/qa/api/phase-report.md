# api hardening — phase report

**Date**: 2026-10-13
**Scope**: `apps/api/{bff,services/*,shared}`, `packages/nest/*`, `tooling/*`
**Ground rules applied**: no compatibility layers (old versions deleted in the same
change set), one conventional commit per change, tests pass before commit, short
comments, no scripts that must be re-run by hand.

---

## 1. Baseline vs final

| | baseline | final |
|---|---|---|
| `bun run check` | 145/185 tasks, exit 127, 8m13s | see §6 |
| service suites green | 0 of 6 (all six failed to start) | 5 of 6 fully green |
| boundary violations | unmeasured (no rule existed) | **0** across all five services |
| duplicated vitest config | 6 × 143 lines = 858 lines | 6 × 8 lines = **48 lines** |
| `@deployer/` residual scope | present in `packages/contracts` | **0** |

Baseline note: the six api apps reported exit 127 on lint (a missing `eslint`
declaration) and their suites could not start at all, so "0 of 6 green" is the honest
starting point rather than a regression.

---

## 2. Phases

### Phase 1 — correctness bugs

| item | change | evidence |
|---|---|---|
| 1.1 service-client cache key | keyed by (service, **contract**) via `Map<string, WeakMap<contract, client>>`; previously the 2nd bind to a service silently received the 1st contract's client | new spec proves it; **25/25** pass |
| 1.2 outbox concurrent dispatch | replaced `findDue` + `findOne` re-read with an atomic `UPDATE … SET state='dispatching' … FOR UPDATE SKIP LOCKED … RETURNING *`; added `event_id` + `locked_until` columns, a claim index and a partial unique index; `dispatchPending` processes the claimed rows directly | race probe against real Postgres: **OLD 40 deliveries / 20 duplicates, NEW 20 claimed / 0 duplicates**. Migrated DB: 5 claimed, 0 double-claimed, 5 reclaimed after lease expiry, duplicate `event_id` → unique violation |
| 1.3 connection pool sizing | `GLOBAL_DB_POOL_{MAX,MIN,IDLE_TIMEOUT_MS,CONNECTION_TIMEOUT_MS}` in `@deployer/env`; pool reads them; `min` clamped to `max` | defaults 10/0 keep the 8-pool fleet at 80 of Postgres' 100; **90/90** env tests |

The Phase 1.2 schema was verified end-to-end: **all 40 migrations apply in order**, and
`drizzle-kit` still sees the identical **92-table** schema.

### Phase 2 — boundaries, made physical and enforced

The registry (`TABLE_OWNERSHIP`, `SHARED_TABLES`) was documentation; nothing stopped a
service importing another owner's table.

**What was built:**

1. **Ownership is now the directory.** `packages/nest/schema/src/global/<owner>/` holds
   each owner's tables. `src/global/index.ts` remains the union barrel, so the Drizzle
   config and migrations are untouched — verified: `db:generate` reports *no schema
   changes*, and no migration file was produced.
2. **A custom lint rule**, `deployer-schema/boundary`, checks the imported **symbols**
   against the registry. A path rule cannot express this: `project/deployment.ts` exports
   `projects` (readable by runtime and identity) *and* `webhooks` (project-only).
3. **No codegen and no script to remember.** The rule reads the registry from disk, so
   claiming a table or granting a shared read is picked up by the next lint.

**Decisions recorded** (`docs/qa/api/boundaries.md`): `identity` may read
`deployments`/`services`/`projects` for analytics; `runtime` may read
`environments`/`projects`; `INFRASTRUCTURE_TABLES` was added for tables with several
writers (the event outbox); tests are exempt from the rule.

**Enforcement caught real violations** that no review had:

- `runtime` reads `resource_ownership_index` (fleet-owned) — found only once symbol-level
  checking replaced counting.
- **`project` imported fleet's `ProvidersModule` and two Cloudflare provider services.**
  These never resolved: the service tsconfig maps `@/*` to its own `src/*`, and an earlier
  **vitest alias pointed `@/` at `apps/api/src`**, so the imports silently loaded the
  monolith's copy and the suite passed. Fixed by reaching fleet through
  `providersContract` via the shared `ServiceClient` (a new `DnsProviderGateway`).
  Effect: `project` 64 → 35 type errors (remainder pre-existing), suite from 4 failing
  files to **8/8 files, 127/127 tests**.

### Phases 6 and 7 (partially complete)

| item | status |
|---|---|
| 6 — boot snapshot gated behind an explicit env flag | done |
| 6 — outbox claim indexes | done in Phase 1.2 (the claim query's index is exactly the one added) |
| 6 — N+1 audit | audited; the one candidate is a Docker-API fallback loop bounded to ≤2 candidates, not a DB N+1 |
| 7.1 — `dev:services[*]` root scripts | already present, verified |
| 7.3 — shared vitest config factory | done: **858 → 48 lines** |
| 7.4 — doc drift (monolith `apps/api/*` → tier paths) | done, 13 references across 7 files |
| 7.5 — delete junk from `apps/api` | done, 10 unreferenced scratch files (~692KB) + gitignore patterns |

---

## 3. Bugs found while doing the above (all fixed)

These were not in the plan; they blocked it.

1. **22 files imported `@deployer/api-contracts`**, a package that does not exist — every
   service e2e suite failed at collection. Repointed to `@deployer/<owner>-contracts`.
2. **The contract packages' wildcard export** (`./*` → `./*.ts`) does not resolve a
   directory's `index.ts`, so `@deployer/fleet-contracts/modules/providers` is not
   importable even though the file exists. Use the package root.
3. **Nine files the service split never moved**: `providers/code/shared/{code-provider.interface,code-provider-registry.service,code-provider-conformance.spec}.ts`,
   the four `*-source-provider.service.ts`, `providers/base/*`, and
   `platform/controllers/{platform-console,setup-done}.controller.ts`. Copied from the
   monolith, scope-normalised; the two SSR controllers were **not** moved after all — the
   BFF already owns them and the views they need.
4. **`fleet`'s `app.module.ts` imported six `*DomainModule` names** that the modules do
   not export (they export `*Module`).
5. **`GithubWebhookDispatchService` could not construct** — `DomainRoutingService` was not
   in `ProvidersModule`'s imports.
6. **`manager.ts` used the `Bun` global** (`Bun.write`), which does not exist under Node,
   so `configureTraefikPathsForE2E` threw on every Node-run e2e.
7. **Three runtime specs imported the raw harness** rather than the app-local
   `@/e2e/runtime` wrapper, and threw `rootModuleLoader is required`.
8. **Six cross-service `@/modules/providers` imports** (see Phase 2).
9. **The `@deployer/` scope rename had missed `packages/contracts`** (23 files).

---

## 4. The `splitting` question (corrected mid-task)

I initially disabled esm code splitting globally to fix dropped `export *`. **That was
wrong** — splitting is a trigger, not the cause — and I reverted it. The real cause: when
a module is reachable from two entrypoints, bun hoists it and emits the entry **without
its re-exports**, silently (`result.success` stays true; the `.d.ts` is built separately,
so types still resolve).

Correct fixes, both in place:

- `packages/auth/src/index.ts` self-imports by package name instead of a relative path, so
  each module has one reach — verified: `PluginWrapperRegistry` present, exports 14 → 85,
  **with splitting on**.
- `@deployer/contracts-entities` is the only package genuinely broken by it (it loses
  **283 of 678** exports), so it alone opts out: `splitting: false`. The other 22 packages
  measured identical either way.

---

## 5. Deliberately not done

- **Phase 3** (shrink `shared` to a platform kernel) — a large structural move whose target
  owners need confirmation. Not started rather than half-done.
- **Phase 4** (a `createServiceModule(...)` factory and the internal-identity token). The
  identity design changes the trust model between services and is worth deciding
  explicitly; the Q&A file records the `project → fleet` call that it affects.
- **Phase 5** (the 315 generated delegations — generic forwarder vs documented gateway).
  Explicitly an `[ASK]`.
- **Phase 8** — the BFF contract test that samples delegated procedures. This is the test
  that would have caught the Phase 1.1 bug, so it is the highest-value remaining item.
- **Analytics as an event-fed read model** — its stated target; needs an analytics event
  pipeline.

---

## 6. Verification

Commands and their results are recorded per commit. The invariant used throughout:
`drizzle-kit` must still see the **identical 92-table schema**, and it does.

`bun run check` final result is appended below when the run completes.

---

## 7. State at end of the follow-up session

### Suites

| app | result |
|---|---|
| `identity` | **64/64** |
| `project` | **127/127** |
| `fleet` | **142/142** (18/18 files) |
| `health` | **6/6** |
| `bff` | **36/36** |
| `runtime` | 273 passing, 2 e2e files blocked (below) |

### Bugs fixed in this session

1. **The e2e harness never forwarded real request headers.** `overrideProvider(REQUEST)`
   substitutes one static object for the whole test module, so any middleware reading a
   header off `context.request` saw the synthetic bootstrap request instead of the
   caller's — a token-authenticated route 401'd while the same call made directly on the
   service succeeded. Fixed by copying the live request's headers onto the override per
   request. The set is **replaced, not merged**: merging carried the previous caller's
   token into the next request, so a "rejects a missing token" case passed when it should
   have failed.
2. **The two 401 paths in `requireAppInstance` shared one message.** "Missing or invalid
   X-App-Instance-Token" made a client that omitted the header indistinguishable from a
   revoked token — in a log and in an e2e run. Split into "Missing … header" and
   "Invalid …: no active instance matches it", which is what located bug 1.
3. **Local SQLite migrations could not survive a concurrent boot.** `isMigrationApplied`
   then `INSERT` is a check-then-act with no claim, so two suites sharing the default DB
   path both recorded the same row and the loser threw
   `UNIQUE constraint failed: local_migrations.name`, aborting its boot with the schema
   unapplied. The insert is now `INSERT OR IGNORE`, and a transaction that fails on DDL
   re-checks the state table and skips if the other process won.
4. **`DatabaseModule` imported the wrong `LocalDatabaseModule`.** It imported
   `@deployer/nest-database-local`'s class — a bare `@Module({})` that registers nothing —
   instead of the shared wrapper that calls `forRootAsync` with the path and migrations
   directory. The file's own comment already warned about exactly this trap for
   `forRoot`. Nothing migrated, so `LocalDatabaseLifecycleService.onModuleInit` never ran.
5. **No service root module registered the local database at all.** Shared modules read
   `node_config` (mesh config, the health disk indicator, `node-status`), so the apps
   booted and failed at first read from a module naming neither the table nor the missing
   registration. Added the node-state module to the runtime root.

### The runtime e2e blocker: resolved, and it was four separate bugs

The two specs failed with `no such table: node_config`. Chasing it properly found
four independent defects, each of which would have hidden the next:

1. **The `bun:sqlite` shim was not faithful.** `bun:sqlite`'s `.get()` returns
   `null` on no match; `node:sqlite`'s returns `undefined`. Since `bun:sqlite` types
   it `Row | null`, every caller writes `row !== null` — and under `undefined` those
   checks INVERT. The local-migration state check
   (`SELECT 1 FROM local_migrations WHERE name = ?`) therefore reported all 13
   migrations as **already applied against an empty table**, so the schema was never
   created. This was the root cause of `no such table`.
   Fixed by making the shim return `null`, plus a regression test
   (`apps/api/src/vitest-shims/bun-sqlite.spec.ts`) that was verified to FAIL on the
   buggy version and pass on the fix.

2. **The legacy backfill fired on one table.** `backfillAppliedMigrationsIfSchemaExists`
   checked only that `node_config` existed, then recorded every migration as applied
   **without executing any of them**. Any half-migrated database passed that check and
   was then permanently un-migratable. It now requires *every* table the migration set
   creates to be present; anything less falls through to the transactional runner.

3. **Migration `0002` had two `ALTER TABLE` statements with no
   `--> statement-breakpoint` between them.** The loader splits on that marker, so the
   whole file was one statement and only the first `ALTER` ran — `mesh_urls_snapshot`
   was never added, and migration 0004 (which rebuilds `node_config` including that
   column) then failed with `no such column: "mesh_urls_snapshot"`.
   `bun:sqlite` tolerated the multi-statement string; `node:sqlite` did not, which is
   why this only appeared under the shim. Marker added; it is the only file affected.

4. **The upload source provider ignored a root-level `uploadPath`.**
   `uploadSourceContextSchema` declares `uploadId`/`uploadPath` at BOTH the root and
   inside `customData`, but the provider read only the nested copies — so a caller
   following the documented root-level shape was told its bundle "was not found",
   naming a field it had supplied. Both copies (runtime and fleet) now prefer the
   nested value and fall back to the root.

5. **Two e2e specs contended for one SQLite file.** Each spec boots a full Nest app,
   and both resolved `NODE_LOCAL_DB_PATH` to the same `/tmp/deployer-<svc>-e2e-local.db`.
   SQLite allows one writer, and the losing migration failed with `database is locked` —
   running the specs serially passed, so the collision was reproducible rather than flaky
   in the ordinary sense. The harness DOES build an isolated database per runtime, but for
   SQLite it does so through `NODE_LOCAL_DB_PATH`, and that value is cached when the
   contract graph is first imported — before the harness runs. The e2e project is now
   `fileParallelism: false` (the unit project stays parallel, and Postgres is unaffected
   because the harness creates a database per runtime there). `BEGIN IMMEDIATE` was tried
   first so the lock is taken up front where `busy_timeout` applies, and the busy timeout
   raised to 15s; neither is sufficient on its own because a whole app boot can outlast any
   timeout, so serialising the e2e project is the actual fix.

**Result**: `runtime` **32/32 files, 288/288 tests**, and all six suites green —
**663 tests**, verified across two consecutive runs (`identity` 64, `project` 127,
`runtime` 288, `fleet` 142, `health` 6, `bff` 36). Supporting packages: `database-local`
4, `nest-env` 10, `nest-schema` 36, `config-eslint` 6, plus the shim regression test 4.
