# 08 — Advanced Builder & Control Patterns

This guide introduces additional patterns to make the model-defined architecture stronger, safer, and easier to scale.

> **Status**: Forward-looking feature design for new modules.  
> **Scope**: Extend current v3 architecture — do **not** replace existing service/repository/controller rules.

---

## Builder should be a default, not a helper

Use builders in every layer so behavior is explicit and controlled:

1. **Contract Builder** (ORPC capability surface)
2. **Query/Command Intent Builder** (controller/service boundary)
3. **Repository Query Builder** (Drizzle execution in repositories only)

The result: maximum composability with minimal accidental behavior.

---

## Project continuity mapping (v3)

This proposal must plug into existing modules and conventions:

- **Contracts**: `v3/packages/contracts/api/modules/<feature>/...` using `standard.zod(...)` + `createFilterConfig(...)`
- **Controllers**: `v3/apps/api/src/modules/<feature>/controllers/*` using `@Implement(...)` + `implement(...).use(requireAuth())`
- **Services**: `v3/apps/api/src/modules/<feature>/services/*` as orchestration point
- **Repositories**: `v3/apps/api/src/modules/<feature>/repositories/*` as Drizzle-only execution point
- **Auth/roles**: `@/core/modules/auth/orpc/middlewares`, `ProjectAccessService`, `@repo/auth` permission configs

Builder adoption is **opt-in per new feature module** and should coexist with current modules.

---

## Pattern A — Drizzle-like controller experience, service-controlled execution

You asked for a heavy builder style where controller logic feels like `select().from(...)`.

Recommended implementation:

- Controllers use a **declarative query intent builder** that *looks* query-oriented.
- The builder does **not** execute SQL in the controller.
- `.execute()` forwards to dedicated service orchestrators that enforce policy and validation before repository execution.

### Why this is important

- Keeps controllers expressive and compact.
- Preserves strict architecture boundaries.
- Guarantees all reads/writes pass through centralized control points.

### Example shape (conceptual)

```ts
return this.projectQuery
  .select()
  .from("project")
  .withInput(input.query)
  .forUser(context.auth.user.id)
  .withPolicy("project:read")
  .withIncludes(input.query?.include)
  .execute();
```

### Controller wiring in this project (conceptual)

```ts
@Implement(appContract.project.list)
list() {
   return implement(appContract.project.list)
      .use(requireAuth())
      .handler(async ({ input, context }) => {
         return this.projectQuery
            .withService(this.projectService)
            .forUser(context.auth.user.id)
            .withInput(input.query)
            .execute();
      });
}
```

The query builder remains declarative; the service remains the controlled execution entrypoint.

Execution flow behind `.execute()`:

1. compile intent → internal query plan
2. run role/policy checks
3. normalize and constrain filters/sorts/includes
4. delegate to service
5. service delegates to repository (`db.select().from(...)`)

---

## Pattern B — Unified Input Control Pipeline Builder

End-user input should be transformed via a single controlled pipeline, not ad-hoc checks.

### Pipeline stages

1. **Normalization**
   - trim strings, coerce numbers/dates/booleans, normalize casing
2. **Shape control**
   - pick/omit/rename fields, reject unknown keys
3. **Constraint control**
   - max limits, page bounds, include depth bounds, operator allowlist
4. **Relation control**
   - resolve and validate include paths from `z.lazy`-detected relation graph
5. **Policy control**
   - remove/override forbidden filters/includes by caller role
6. **Compilation**
   - emit typed query plan/command plan for service execution

### Nested-property-first rule

Every stage must work with nested property paths, not only top-level fields.

- Top-level: `name`, `status`
- Nested object: `owner.profile.displayName`
- Nested arrays: `deployments[].status`, `services[].ports[].public`
- Nested relation branches: `services.deployments.latest.status`

If a path cannot be resolved from schema/path registry, it is rejected before repository execution.

### Builder-style API (deep conceptual)

```ts
const plan = this.inputControl
  .from(input)
   .paths((p) =>
      p
         .fromSchema(projectSchema)
         .fromLazyGraph()
         .maxDepth(8)
         .arrayNotation("[]")
         .registerGroups({
            projectCard: [
               "id",
               "name",
               "owner.profile.displayName",
               "latestDeployment.status",
            ],
         })
   )
   .normalize((n) =>
      n
         .trimStrings()
         .coerceNumbers()
         .coerceBooleans()
         .coerceDates()
         .normalizeCase("query.sort.field", "snake")
   )
   .fields((f) =>
      f
         .from("query.fields")
         .allowPaths(
            "id",
            "name",
            "status",
            "owner.profile.displayName",
            "latestDeployment.status",
            "services[].name"
         )
         .expandGroup("projectCard")
         .default(["id", "name", "status", "owner.profile.displayName"])
         .aliasPath("owner.profile.displayName", "ownerName")
         .maxSelected(40)
   )
   .filter((f) =>
      f
         .from("query.filter")
         .field("name").operators("eq", "like", "ilike")
         .field("owner.profile.displayName").operators("eq", "ilike")
         .field("deployments[].status").operators("eq", "in")
         .field("services[].ports[].public").operators("eq")
         .field("createdAt").operators("gt", "gte", "lt", "lte", "between")
         .maxClauses(40)
         .maxLogicalDepth(7)
   )
   .where((w) =>
      w
         .fromFilter()
         .and((a) => a.path("deleted").eq(false))
         .and((a) => a.path("organization.id").eq(organizationId))
         .and((a) => a.path("projectId").eq(projectId))
         .policyAnchor("project:read")
   )
   .sort((s) =>
      s
         .from("query.sort")
         .allowPaths(
            "updatedAt",
            "createdAt",
            "name",
            "status",
            "owner.profile.displayName",
            "latestDeployment.status"
         )
         .default({ path: "updatedAt", direction: "desc" })
         .allowNullsHandling()
         .addTieBreaker("id", "asc")
         .maxClauses(4)
   )
   .pagination((p) =>
      p
         .from("query.pagination")
         .offsetLimit({ defaultLimit: 20, maxLimit: 100, maxOffset: 10_000 })
         .page({ defaultPage: 1, maxPageSize: 100 })
         .cursor({
            maxWindow: 5_000,
            keys: ["updatedAt", "id"],
         })
         .mode("offset-or-cursor")
   )
   .includes((i) =>
      i
         .from("query.include")
         .fromLazyGraph(projectSchema)
         .allow(
            "owner",
            "owner.profile",
            "services",
            "services.deployments",
            "services.deployments.latest"
         )
         .maxDepth(4)
         .maxPaths(30)
   )
  .enforcePolicy({ userId, roleScope: "project" })
  .toQueryPlan();
```

This pattern gives “a lot of controls” while keeping predictable behavior.

### Deep builder dimensions (recommended baseline)

| Dimension | Required deep controls |
|---|---|
| **Path registry** | schema-derived nested path map, relation-path map from `z.lazy`, array path notation, path groups |
| **Fields** | nested-path allowlist, default fields, alias map, max selected fields, forbidden path set |
| **Filter** | per-path operator allowlist, typed coercion, max clauses, max logical depth |
| **Where** | normalized nested `AND/OR` tree, mandatory policy predicates, conflict detection |
| **Sort** | nested-path allowlist, default sort, null ordering, tie-breakers, max sort clauses |
| **Pagination** | page/offset/cursor support, strict bounds, mode compatibility rules |
| **Includes** | `z.lazy` graph-based nested path validation, max depth, max include paths |

### Nested path semantics (recommended)

| Path type | Example | Meaning |
|---|---|---|
| Scalar path | `name` | top-level scalar field |
| Nested object path | `owner.profile.displayName` | nested object scalar |
| Array path | `deployments[].status` | scalar on each array item |
| Nested array path | `services[].ports[].public` | scalar in nested array items |
| Relation path | `services.deployments.latest.status` | relation-derived nested path |

Each path should be resolved against a schema/path registry before plan compilation.

### Why nested sub-builders are better than flat options

- Easier to apply policy at each stage (`fields`, `where`, `sort`, `pagination`).
- Better compile-time safety because each sub-builder has focused types.
- Better observability because each stage emits isolated diagnostics.
- Cleaner extension model for future capabilities (aggregation, grouping, projections).

### Where to place it in v3

For continuity with current structure, place shared input-control builders in:

```text
v3/apps/api/src/core/modules/modeling/
   input-control/
   query-intent/
   relation-graph/
```

Feature services can import these core utilities without cross-feature service coupling.

---

## Pattern C — Relation graph compiler from `z.lazy`

Build a small internal utility that scans schemas and derives relation metadata from `z.lazy` usage:

- detected relation fields and nesting paths
- allowed include paths
- max traversal depth
- relation type (single/collection)

Use this output in:

- include validation
- relation expansion planning
- docs generation for available include paths

---

## Pattern D — Policy-bound query plans (not raw query objects)

Do not pass raw user filters to repositories.

Instead, repositories consume a typed **QueryPlan** produced by builders:

- `pathRegistryPlan` (resolved nested-path metadata and bindings)
- `projectionPlan` (nested fields + aliases + computed flags)
- `filterPlan` (validated nested-path filter clauses)
- `wherePlan` (normalized nested boolean expression tree)
- `sortPlan` (ordered nested-path sort clauses + tie-breakers)
- `paginationPlan` (offset/page/cursor mode + bounds)
- `includePlan` (`z.lazy` relation-path expansion with nested depth rules)
- `redactionPlan` (policy-driven field masking)

This ensures repositories stay deterministic and auditable.

---

## Pattern E — Split read/write builders

Use separate builders for reads vs writes:

- **ReadBuilder**: filtering, sorting, include graph, projection, pagination
- **CommandBuilder**: field patch policy, transition guards, idempotency keys, side effects

This reduces accidental mutation paths and makes permission mapping clearer.

### CommandBuilder must also be nested-property-aware

Write operations should support deep path controls with the same strictness as reads.

```ts
const cmd = this.commandBuilder
   .for("project")
   .command("update")
   .target({ id: projectId })
   .patch((p) =>
      p
         .set("settings.runtime.resources.cpu", "500m")
         .set("settings.runtime.resources.memory", "512Mi")
         .unset("settings.debug.tempFlags")
         .merge("metadata.labels", { tier: "backend" })
         .array("services")
         .by("id", serviceId)
         .set("health.check.interval", 30)
   )
   .allowWritePaths(
      "settings.runtime.resources.*",
      "metadata.labels.*",
      "services[].health.check.*"
   )
   .denyWritePaths("owner.*", "security.keys.*")
   .enforceTransition("status", ["draft->active", "active->paused"])
   .idempotencyKey(requestId)
   .toCommandPlan();
```

Nested write plans should reject unknown/disallowed patch paths before service execution.

### Deep write controls baseline

- nested path allowlist/denylist
- nested patch ops (`set`, `unset`, `merge`, array item targeting)
- transition guards per nested state path
- immutable path enforcement (`owner.*`, audit fields, security keys)
- policy-driven nested redaction for returned write result

---

## Pattern F — Builder observability hooks

Attach tracing and diagnostics at builder compilation points:

- input hash / plan hash
- selected policy scope
- blocked fields/operators/includes
- generated query complexity score

Use these metrics for abuse prevention and performance tuning.

---

## Practical guardrails

1. Controller builders are declarative only (no direct DB calls).
2. Service layer is the single orchestrator for policy + business rules.
3. Repository layer is the only place where Drizzle `select().from(...)` executes.
4. Every user input path must go through the same input-control pipeline.
5. Include and relation expansion must be based on `z.lazy` relation detection.

With these guardrails, you get the fluent builder ergonomics you want while keeping the system fully controlled.

---

## Rollout strategy for new features

1. Start with one new feature module (do not retrofit all modules at once).
2. Keep contract builder and controller pattern unchanged (`standard.zod`, `@Implement`, `requireAuth`).
3. Add query-intent builder + input-control builder inside service orchestration.
4. Keep repository APIs stable while internally consuming compiled query plans.
5. Promote reusable parts to `core/modules/modeling` once used by 2+ features.
