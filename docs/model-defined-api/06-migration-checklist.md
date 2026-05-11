# 06 — Migration Checklist (Current API → Model-Defined API)

This checklist provides an execution path to migrate incrementally without breaking existing consumers.

---

## Phase 0 — Inventory and scope

- [ ] Enumerate current endpoints per domain (`user`, `project`, `service`, `deployment`, `docker`).
- [ ] Map each endpoint to model(s) it should read/write.
- [ ] Identify endpoints returning non-canonical/ad-hoc payloads.
- [ ] Identify endpoints missing role enforcement.

Deliverable: endpoint-to-model matrix.

---

## Phase 1 — Canonical model completion

- [ ] Ensure all first-class models exist in `@repo/contracts-entities`.
- [ ] Declare relation edges with `z.lazy(() => ...)` wherever they belong in model schemas (top-level or nested).
- [ ] Define typed include path enums for relation-aware fetch endpoints.
- [ ] Add/normalize list/entity schemas (`data/meta`, relation-aware entity projections).
- [ ] Add cross-field validation (`superRefine`) where needed.

Deliverable: model and relation schema completeness.

---

## Phase 2 — Contract builder migration

- [ ] Create/upgrade each module contract from `standard.zod(modelSchema, "model")`.
- [ ] Replace ad-hoc list query schemas with `createFilterConfig(...).withPagination().withSorting().withFiltering().buildConfig()`.
- [ ] Ensure dynamic path params are declared through typed params builders.
- [ ] Define response statuses/observable streams through output builders.
- [ ] Introduce query/command intent builders used by controllers/services (declarative query style, no direct DB execution in controller).
- [ ] Compose routers by capability (crud/lifecycle/dependencies/streams/actions).

Deliverable: all contracts model-derived and builder-based.

---

## Phase 3 — API implementation alignment

- [ ] Ensure every protected handler uses `requireAuth()`.
- [ ] Move any business logic out of controllers/repositories into services.
- [ ] Add service-level role checks (project/platform scopes).
- [ ] Implement unified input-control pipeline (normalize, allowlist, constrain, policy, compile plan).
- [ ] Implement relation expansion pipeline with include allowlist + max depth, using `z.lazy`-detected relation edges.
- [ ] Translate filter operators safely in repositories.

Deliverable: runtime behavior aligned with contract capability definitions.

---

## Phase 4 — Frontend alignment

- [ ] Ensure each domain has `endpoints.ts`, `hooks.ts`, `invalidations.ts`.
- [ ] Replace UI ad-hoc payload assumptions with contract-typed payloads.
- [ ] Support relation-aware queries via typed include fields.
- [ ] Align button/action visibility with permission hooks.
- [ ] Validate cache invalidation against list/detail/relation endpoints.

Deliverable: end-to-end typed flow from contract to UI.

---

## Phase 5 — Verification and rollout

- [ ] Add/update service and controller tests for migrated modules.
- [ ] Verify list filtering/sorting/pagination across all first-class models.
- [ ] Verify role restrictions for read/write/lifecycle endpoints.
- [ ] Verify stream endpoint selectors and replay behavior.
- [ ] Roll out module-by-module behind stable contract paths.

Deliverable: production-safe migration completion per module.

---

## Suggested migration order

1. `user` (identity baseline)
2. `project` (ownership and collaboration baseline)
3. `service` (execution unit baseline)
4. `deployment` (lifecycle/event baseline)
5. `docker` (`container`/`image` relation graph and runtime actions)

This order minimizes policy and relation complexity early.

---

## Definition of done (model-defined module)

A module is complete when:

- [ ] model schemas are canonical and relation-explicit
- [ ] contract endpoints are builder-defined and model-derived
- [ ] list/filter/sort behavior is typed and validated
- [ ] auth + role checks are enforced consistently
- [ ] frontend domain consumes contracts without ad-hoc mapping
- [ ] tests cover happy + denied + not-found/conflict behavior
