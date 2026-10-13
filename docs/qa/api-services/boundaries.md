# Q&A — api-services: Cross-Service Table Boundaries

**Module**: api-services
**Category**: boundaries
**Last updated**: 2026-10-13
**Status**: 4 questions OPEN — Phase 2 implementation is blocked on them.

---

## Context

Phase 2 turns "a service may only touch tables it owns" from a convention into a
build failure. The registry already exists at
`packages/nest/schema/src/ownership/table-ownership.ts`:

- `TABLE_OWNERSHIP` — 92 tables → owner (`identity` | `project` | `runtime` | `fleet` | `health` | `platform` | `monolith`)
- `SHARED_TABLES` — two entries where one service writes and others may read:

  | table | writer | readers |
  |---|---|---|
  | `deployments` | `runtime` | `project`, `fleet` |
  | `services` | `project` | `runtime`, `fleet` |

A detector that imports each service's schema symbols and checks them against the
registry plus `SHARED_TABLES` (ignoring the Better Auth tables every service resolves
through its adapter, and ignoring e2e fixtures that seed across owners) reports:

| service | unowned READ | unowned WRITE |
|---|---|---|
| `identity` | `deployments`, `projects`, `services` | — |
| `project` | — | — |
| `runtime` | `environments`, `projects` | — (only an e2e fixture writes `services`) |
| `fleet` | — | — |
| `health` | — | — |
| `bff` | — | — |

Exact sites:

- `services/identity/src/modules/analytics/repositories/analytics.repository.ts`
  lines 116, 186 (`deployments`), 155, 225 (`services`), 209 (`projects`)
- `services/runtime/src/modules/deployment/repositories/deployment.repository.ts` line 397 (`environments`)
- `services/runtime/src/modules/docker/repositories/facade/docker.repository.ts` line 786 (`projects`)

Two of the four are already sanctioned reads by `SHARED_TABLES` (`runtime` reading
`services`); the detector only flags the ones `SHARED_TABLES` does **not** cover.

---

## Q1 — identity reading `deployments` / `services` / `projects` (analytics)

**Q**: `identity` owns analytics reports, but computing one reads deployments,
services and projects. Which mechanism should replace the direct read?

**A**: _OPEN_

Options, with what each costs:

- **(a) Event-fed read model.** `runtime` and `project` publish domain events that
  identity consumes into its own denormalised analytics tables. Full isolation, and
  it matches the existing outbox/event infrastructure. Cost: history does not
  backfill, so existing reports need a one-time rebuild, and every new metric needs
  a new event.
- **(b) Declared read-only `SharedTable` entries.** Add `deployments` (already
  shared, add `identity` to `readers`), `projects` and `services` for identity.
  Cheapest, and the reason field can state "analytics aggregates across the
  platform". Cost: identity keeps a live dependency on two other services' schemas,
  so a column rename breaks it.
- **(c) Cross-service contract call.** identity calls runtime/project through oRPC
  and aggregates in memory. No schema coupling, but it moves aggregation off SQL and
  onto the wire — the report queries are `count()`/`group by` aggregations, so this
  would read unbounded rows.
- **(d) A dedicated analytics projection service.** Out of scope for this task.

**Recommendation**: (b) now, (a) as the target — the analytics queries are
aggregations over other services' rows, which is exactly the "read model" case, but
this task should not also invent an analytics event pipeline.

---

## Q2 — runtime reading `environments` and `projects`

**Q**: `runtime` reads `environments` (`deployment.repository.ts:397`) and `projects`
(`docker.repository.ts:786`). Neither is in `SHARED_TABLES`.

**A**: _OPEN_

`projects` is the same shape as `services` (which runtime is already allowed to read):
runtime needs the project a deployment belongs to. `environments` is the deployment
target, so runtime arguably cannot resolve a deployment without it.

Options:

- **(a)** Add both to `SHARED_TABLES` with `writer: "project"`, `readers: ["runtime", …]`
  — consistent with the existing `services` entry and its stated reason.
- **(b)** Denormalise the two fields runtime actually needs (`projectId`,
  `environmentId`/`environmentName`) onto `deployments`, which runtime owns, so no
  cross-owner read is needed at all. Cost: a column each, kept in sync by `project`
  events.

**Recommendation**: (a) — it is the same decision already made for `services`, and
splitting the rule between "services is readable, environments is not" would be
arbitrary.

---

## Q3 — what does the lint rule allow that `SHARED_TABLES` does not?

**Q**: Should the ESLint `no-restricted-imports` rule be strict (only the owner may
import the symbol) or registry-aware (import is allowed when `mayRead()` is true)?

**A**: _OPEN_

`no-restricted-imports` matches import paths, not `(table, service)` pairs, so it
cannot express `mayRead()`. The viable implementation is to **generate per-owner
schema barrels** from the registry — e.g. `@deployer/nest-schema/owners/runtime`
re-exports exactly the tables runtime may import — and then ban
`@deployer/nest-schema/global/*` from service code. That makes the rule strict and
mechanical: a service may import its own owner barrel, nothing else.

Open sub-questions:

- Generate the barrels at build time (a script + a turbo task) or commit them?
  Generated-is-safer, but they must be regenerated whenever the registry changes.
- Do the barrels cover `SharedTable` reads automatically (i.e. `owners/runtime`
  includes `services` and `deployments` because it may read them)?
- What is the import-budget for `bff`? The task says the BFF may not import
  `@deployer/nest-schema/global/*` except auth tables — but the BFF currently
  imports none, so the rule is free to add today.

**Recommendation**: generate `owners/<service>` barrels from the registry, include
`SharedTable` reads, and ban the `global` barrel in service and BFF code. That makes
Q1 and Q2 decisions *encode* into the registry instead of drifting.

---

## Q4 — the runtime e2e fixture writes `services`

**Q**: `services/runtime/src/e2e/deployment-workflows/support/deployment-complete-strategy-context.ts:62`
inserts into `services` (owned by `project`) to seed a fixture. Should the boundary
rule apply to e2e support code?

**A**: _OPEN_

A fixture that must create a *whole* aggregate (project → service → deployment) to
exercise a deployment flow cannot do so through its own service's API without
calling project's service over the network, which an e2e support helper has no
reason to do.

Options:

- **(a)** Exempt `**/e2e/**` and `**/*.spec.ts` from the import rule (tests may seed
  the database directly).
- **(b)** Let fixtures call the owning service's API, so the seeded data goes through
  the real boundary.

**Recommendation**: (a) — seeding is a test concern, and forcing it through the API
would make fixtures depend on other services being up, which is exactly the coupling
the fixtures exist to avoid. Worth recording so the exemption is deliberate rather
than a hole.
