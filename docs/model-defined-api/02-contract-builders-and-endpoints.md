# 02 — Contract Builders and Endpoint Capabilities

This document defines the contract-level implementation pattern for model-defined APIs.

---

## Contract-first flow

Implementation order stays:

1. Model schema (`@repo/contracts-entities`)
2. ORPC contract (`packages/contracts/api/modules/...`)
3. API controller/service/repository implementation
4. Web domain endpoints/hooks

If the contract is not model-defined, the endpoint is not considered done.

---

## Base operation builder

Start every module from:

```ts
const modelOps = standard.zod(modelSchema, "modelName");
```

This gives standardized operations (`list`, `findById`, `create`, `update`, `delete`, etc.) that can be refined through fluent builders.

### Builder-heavy rule

Builders should be heavily used across the full endpoint lifecycle:

- contract shape builder (ORPC)
- input-control builder (normalization + constraints)
- query/command intent builder (controller/service boundary)

The endpoint should never bypass these builders with ad-hoc parsing or ad-hoc payload composition.

---

## List contract with fluent query config

Use the fluent list config as the default list pattern:

```ts
const listConfig = createFilterConfig(modelOps)
  .withPagination({ defaultLimit: 20, maxLimit: 100, includeOffset: true } as const)
  .withSorting(["createdAt", "updatedAt", "name"] as const, {
    defaultField: "updatedAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    id: modelSchema.shape.id,
    name: { schema: modelSchema.shape.name, operators: ["eq", "like", "ilike"] as const },
  })
  .buildConfig();

export const modelListContract = modelOps.list(listConfig).build();
```

### Why this is mandatory

- Endpoint fetch capabilities are explicit and typed.
- Filter operators are controlled field-by-field.
- Frontend input types can be computed from config.

---

## Endpoint capability declaration

Every endpoint should declare capability through builder shape:

1. **Route path**
2. **Input channels** (`params`, `query`, `body`, `headers`)
3. **Output shape** (body/observable/stream/union statuses)

### Dynamic route parameters

For dynamic paths, define path and params together:

```ts
.input((b) => b.params((p) => p`/${p("id", z.uuid())}`))
```

Do not rely on raw string placeholders without typed params.

### Output variants

Use output builder for response modeling (`body`, `status`, `observable`, `streamed`, `union`).

### Drizzle-like controller intent (controlled)

A controller may use a fluent query intent that feels similar to `select().from(...)`, but it must remain declarative and execute through dedicated services.

This preserves control while keeping a fluent developer experience.

---

## Filtering model (must work everywhere)

Filtering supports typed operators and logical composition (`_and`, `_or`).

Common operators include:

- Equality: `eq`, `ne`
- Comparison: `gt`, `gte`, `lt`, `lte`, `between`
- String: `like`, `ilike`, `contains`, `startsWith`, `endsWith`
- Set: `in`, `notIn`

Design rule:

- Keep operator scope tight per field to prevent query abuse.
- Never expose all operators blindly for sensitive fields.
- Compile accepted filter/sort/include inputs through an input-control builder before service execution.

---

## Relation-aware fetch contracts

When endpoint must fetch linked models:

1. Define typed include paths (`z.enum([...])`).
2. Accept include in query (string or array, normalized by service).
3. Return linked output schema with clearly redacted fields where needed.

Example intent:

```ts
input.query({
  include: z.string().optional(),
  maxDepth: z.coerce.number().int().min(1).max(3).optional().default(3),
})
```

---

## Streaming endpoints in model-defined architecture

Event endpoints should also stay model-defined:

- Query input has typed selectors/filters.
- Event output uses discriminated unions.
- Output channel uses `.output((b) => b.observable(eventSchema))` (or streamed body where applicable).

This keeps reactive features type-safe without bypassing model definitions.

---

## Router composition standard

Group contracts by capability and compose with `oc.router`:

- `crud`
- `lifecycle`
- `dependencies`
- `streams`
- runtime/action groups where needed

This keeps a stable and discoverable API surface while preserving domain boundaries.
