# api-services hardening — phase report

**Date**: 2026-10-13
**Scope**: `apps/api-services/{bff,services/*,shared}`, `packages/nest/*`, `tooling/*`
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
| `@repo/` residual scope | present in `packages/contracts` | **0** |

Baseline note: the six api-services apps reported exit 127 on lint (a missing `eslint`
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

**Decisions recorded** (`docs/qa/api-services/boundaries.md`): `identity` may read
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
| 7.4 — doc drift (`apps/api/*` → `apps/api-services/*`) | done, 13 references across 7 files |
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
9. **The `@repo/` scope rename had missed `packages/contracts`** (23 files).

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
