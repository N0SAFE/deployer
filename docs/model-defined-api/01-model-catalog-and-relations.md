# 01 — Model Catalog and Relations

This document defines how models must be represented so contracts, services, and UI all consume the same canonical shapes.

---

## Canonical model layering

For each domain model, use this structure:

1. **Base schema** (persistent/core fields)
2. **Relation-bearing fields** declared with `z.lazy` (expandable associations)
3. **Optional relation view schema(s)** for enriched/list/linked projections
4. **List schema** (`{ data, meta }`)
5. **Optional include-path schema** (`z.enum([...])`)

### Standard pattern

```ts
export const modelSchema = z.object({
  id: z.uuid(),
  // core fields...

  // relation field can live directly in model schema
  relationA: z.lazy(() => relationASchema).nullable().optional(),

  // relation field can also be nested
  graph: z.object({
  relationB: z.array(z.lazy(() => relationBSchema)).optional(),
  }).optional(),
});
```

> **Hard rule**: relation references are defined with `z.lazy(() => schemaRelation)` to avoid circular import issues and to preserve recursive typing.
>
> **Detection rule**: any field (or nested field) using `z.lazy(...)` is treated as a relation edge in the model graph.

---

## Required first-class models

The model-defined architecture should treat the following as first-class entities:

| Model | Core identifiers | Key relations |
|---|---|---|
| `User` | `id`, `email`, `role` | projects owned, project collaborations |
| `Project` | `id`, `ownerId`, `name` | owner, services, deployments, collaborators |
| `Service` | `id`, `projectId`, `providerId`, `builderId` | project, deployments, dependencies |
| `Deployment` | `id`, `serviceId`, `status`, `environment` | service, project, container/image snapshots |
| `DockerContainer` | `id`, `projectId`, `serviceId`, runtime fields | deployment, service, project, image, networks, volumes |
| `DockerImage` | `id`, digest/tag fields, metadata | registry, containers, deployments, parent/children images |

Additional supportive models should stay typed and composable (templates, setup, mesh, event streams, traefik, configuration, etc.).

---

## Relation modeling conventions

### 1) Relation placement is free

- Relation fields are allowed anywhere in the schema (top-level or nested).
- A dedicated `relations` key is optional, not required.
- The canonical relation signal is `z.lazy`, not property name.

### 2) Separate relation concerns from primitive concerns (recommended)

- Keep base schema focused on persisted fields.
- Keep relation-bearing fields clearly identifiable via `z.lazy`.
- Use dedicated relation view schemas when it improves readability, but do not enforce a fixed key.

### 3) Relation fields are optional by default

Use optional relations unless endpoint explicitly guarantees eager expansion.

```ts
owner: z.lazy(() => userSchema).nullable().optional();
```

### 4) Nullable single relation, array for multi relation

- One-to-one / many-to-one: `z.lazy(() => schema).nullable().optional()`
- One-to-many: `z.array(z.lazy(() => schema)).optional()`

### 5) Typed include paths

Never accept arbitrary include strings. Define allowed include paths with `z.enum([...])` and parse from query:

```ts
export const includePathSchema = z.enum([
  "project",
  "project.services",
  "deployment",
  "deployment.service",
]);
```

This keeps relation expansion explicit and secure.

---

## Relation detection semantics (normative)

### Relation edge detection

A field is considered a relation edge when at least one of these is true:

1. Field schema is `z.lazy(() => ...)`
2. Field schema is an array containing `z.lazy(() => ...)`
3. Field schema is an optional/nullable wrapper around `z.lazy(() => ...)`
4. Field schema is nested and contains `z.lazy(() => ...)`

### Non-relation field examples

- plain object fields without `z.lazy`
- primitive arrays (`z.array(z.string())`, `z.array(z.number())`, etc.)
- enums and literals

### Practical implication

- Include-path generation and relation expansion planning should be based on detected `z.lazy` nodes.
- Property names like `relations`, `links`, or `graph` are documentation conveniences only, not architectural requirements.

---

## Validation standards for model-defined APIs

### Field-level validation

- IDs: `z.uuid()` whenever resource IDs are UUID-backed.
- Role/status/action fields: strict enums (from `@repo/auth` or `@repo/contracts-common`).
- Date/time: normalize format conventions per model (`z.date()` for runtime objects, or `z.string()` where transport format is fixed).

### Cross-field validation

Use `.superRefine()` for compatibility checks between fields (e.g., provider type ↔ provider config, runner type ↔ runner config).

### Security-aware model output

When exposing linked data, include redaction metadata or shape-level omission for sensitive fields.

---

## Suggested file layout for each model

```text
packages/contracts/entities/src/entities/<domain>/<model>/
  base.schema.ts
  relations.schema.ts      # optional helper, not mandatory
  entity.schema.ts         # optional composition view
  list.schema.ts
  links.schema.ts         # optional include-path + flattened linked shape
  index.ts
```

For smaller domains, co-location inside one file is acceptable.

---

## Model graph (target)

```text
User
  └─ owns ──> Project
               ├─ has many ──> Service
               │               └─ has many ──> Deployment
               │                                 ├─ runs in ──> DockerContainer
               │                                 └─ uses ─────> DockerImage
               └─ has collaborators ───────────> User
```

This graph is the foundation for relation-aware contracts and relation-aware UI queries.
