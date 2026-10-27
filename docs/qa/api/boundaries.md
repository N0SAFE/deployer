# Q&A — api: Cross-Service Table Boundaries

**Module**: api
**Category**: boundaries
**Last updated**: 2026-10-13
**Status**: decided and implemented.

---

## Context

The registry at `packages/nest/schema/src/ownership/table-ownership.ts` declares which
service owns each table. Checking each service's schema imports against it found:

| service | unowned READ |
|---|---|
| `identity` | `deployments`, `deployment_rollbacks`, `projects`, `services` |
| `runtime` | `environments`, `projects`, `resource_ownership_index` |
| `fleet` | `preview_environments` |
| `project`, `health`, `bff` | — |

Enforcement then exposed registry facts that were wrong or missing:

- **The `github_*` / `gitlab_apps` tables** were registered `runtime`-owned but are used only
  by `fleet`. They are `fleet`.
- **`preview_environments`** is written by `fleet` (lifecycle) and read by `runtime`, so it is
  multi-writer, not `runtime`-only.
- **`local_event_outbox`** is a transactional outbox: `project`, `runtime` and `shared` all
  write to it when they publish a domain event, so a one-writer rule cannot describe it.

---

## Decisions

### Q1 — `identity` reading `deployments` / `services` / `projects`

**Decided**: add `identity` as a declared READER of these in `SHARED_TABLES`, with the reason
recorded (and `identity` as a reader of `deployment_rollbacks` too).

The analytics reports are `count()` / `group by` aggregations over other services' rows. An
event-fed read model is the better long-term shape but cannot cover history that predates the
pipeline, so a report could not be run over past data. A cross-service contract call was
rejected because aggregations would pull unbounded rows onto the wire.

The boundary stayed meaningful: `identity` gained READ, never WRITE.

### Q2 — `runtime` reading `environments` and `projects`

**Decided**: add both to `SHARED_TABLES` with `writer: "project"` and `runtime` as a reader,
and grant `runtime` a read of `resource_ownership_index` (fleet-owned).

This is the same decision already taken for `services`; splitting the rule — "services is
readable, environments is not" — would be arbitrary. Denormalising `projectId`/`environmentId`
onto `deployments` was rejected: it duplicates a name that then has to be kept in sync.

### Q3 — how the boundary is enforced

**Decided**: ownership is **physical**, and the rule validates imported **symbols**, not paths.

- Schema files live under `packages/nest/schema/src/global/<owner>/`. `src/global/index.ts`
  stays a union barrel so migrations and the monolith are unaffected.
- The two mixed files were split by owner (`deployment.ts`: three owners, 13 tables;
  `github-provider.ts`: two owners); single-owner files were moved unchanged.
- Enforcement is a custom ESLint rule (`deployer-schema/boundary`, shipped by
  `@deployer/config-eslint`) that reads `TABLE_OWNERSHIP` / `SHARED_TABLES` **at lint time** and
  validates each imported symbol against them.

  Why not `no-restricted-imports`: one schema file can export tables with different owners
  (`global/project/deployment.ts` holds `projects`, readable by runtime and identity, next to
  `webhooks`, which is project-only). A path rule bans whole directories only, so it would either
  allow too much or forbid the reads the registry grants.

  Why reading the registry instead of generating a list: a schema edit then needs **no codegen,
  no regeneration step and no config change**. (An earlier attempt generated per-owner barrels
  from the registry; it was discarded because it required running a script after every schema
  change.)

- Unowned access is reported per symbol, naming the fix: claim the table, or declare a shared
  read with a reason.

**Rejected**: one schema package per service. 19 cross-owner foreign keys exist — e.g.
`deployments` (runtime) references `services` (project) — so per-service schema packages would
have to import each other, which is worse coupling than the directory split removes. It would
also break `packages/auth`, which sits below the services and needs the auth tables, and
`apps/api`, which reads every table until it is retired.

### Q4 — e2e fixtures that seed across owners

**Decided**: exempt `**/e2e/**` and `**/*.spec.ts` from the rule.

A fixture that exercises a deployment flow must create a whole aggregate
(project → service → deployment). Forcing that through the owning service's API would make the
fixture depend on other services being up, which is the coupling fixtures exist to avoid.
Seeding is a test concern; the exemption is explicit so it reads as a decision, not a hole.

---

## Verification

- `@deployer/nest-schema`: 36/36 tests, 0 type errors, build clean.
- `drizzle-kit` sees the **identical 92-table schema** through the restructured union barrel
  (`bun run db:generate`: no schema changes in `apps/api`) and no migration file was produced —
  the restructure is behaviour-preserving.
- The rule was probed with a file importing own / shared / platform / infrastructure / auth /
  unowned symbols: it flagged exactly the unowned import and allowed the rest.
- No unowned table references remain in any of the five services.

---

## DECIDED — `project` reaches fleet's DNS provider facts through the contract

**Q**: `apps/api/services/project` imports fleet's provider code directly:

```
src/modules/project/project.module.ts:14          ProvidersModule          from "@/modules/providers/providers.module"
src/modules/project/services/project-network.service.ts:9-10
        CloudflareAppService, CloudflareDnsProviderService
src/modules/service/service.module.ts:11          ProvidersModule
src/modules/service/services/service-network.service.ts:10-11
        CloudflareDnsProviderService, CloudflareAppService
```

None of those live inside `project`; they are in
`services/fleet/src/modules/providers/**`. The service's own tsconfig maps `@/*` to
`./src/*`, so the imports were never resolvable — an earlier vitest alias made them
resolve to `apps/api/src/modules/providers` (the monolith), which is why the suite
passed. `project` calls `listApps()`, `listZones(account)` and
`listRecords(account, zoneId)` to build `ProjectNetworkView` / `ServiceNetworkView`.

**A**: **(a) — a cross-service contract call, implemented.** `project` now injects
`DnsProviderGateway`
(`services/project/src/modules/network/dns-provider.gateway.ts`), which reaches fleet
through `providersContract` via the shared `ServiceClient`. The gateway narrows the
contract's output to the view shapes `project` renders and resolves a zone name for
the base-domain sync. `ProvidersModule` is no longer imported by either module.

The alternatives considered:

- **(b) Move the network views into `fleet`.** They are DNS/provider projections, which
  is fleet's domain, but it would move BFF-composed screens and routes for no gain.
- **(c) Denormalise the DNS state `project` needs** onto its own tables, from fleet
  events — a new projection and a backfill, for data that is already queryable.

(a) was chosen because `project → fleet` is an anticipated dependency direction (it is
named in the internal-identity design) and `providersContract` already existed.

**Effect**: `project` went from 64 type errors to 35 (the remainder are pre-existing and
unrelated — `@deployer/api-contracts`-era controller signatures and `shared/`
supervisors), and its suite from 4 failing files to **8/8 files, 127/127 tests**. The
boundary rule reports **0 violations**.

**Note on the mismatch that made this possible**: the vitest alias used to resolve `@/`
to `apps/api/src`, so `@/modules/providers/...` silently loaded the MONOLITH's copy of
the provider code and the suite passed. That alias now points at the app's own `src`
(matching its tsconfig), which is what surfaced the coupling.

**Recommendation**: (a) — smallest correct step; `project → fleet` is already an
anticipated dependency direction (it is named in the task's internal-identity design),
and `providersContract` exists. It is also the call that must carry the internal
identity from Phase 4.2.

---

## Follow-up — stale `@deployer/api-contracts`

The split of the single contracts package into per-service packages
(`packages/contracts/<owner>`) left **22 files** importing `@deployer/api-contracts`,
which does not exist. Every service e2e suite failed at collection because of it.
Fixed here: the imports now point at `@deployer/<owner>-contracts`, with
`modules/<sub-module>` preserved (e.g. `modules/service/list` →
`@deployer/project-contracts/modules/service/list`). The same class of stale package
name should be swept repo-wide before the monolith is deleted.
