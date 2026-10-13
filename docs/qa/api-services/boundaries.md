# Q&A — api-services: Cross-Service Table Boundaries

**Module**: api-services
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
