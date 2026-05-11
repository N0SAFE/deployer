# 04 — Backend Execution Model

This document explains how model-defined contracts are executed in the API layer.

---

## Module architecture (mandatory)

```text
apps/api/src/modules/<feature>/
  controllers/      # ORPC handlers only (thin)
  services/         # business rules + authorization orchestration
  repositories/     # database queries only
  adapters/         # external systems/integrations
```

### Responsibilities

- **Controller**: bind contract to handler, apply middleware, delegate to service.
- **Service**: interpret contract intent, authorize, validate domain transitions, orchestrate repository/adapters.
- **Repository**: execute storage queries; no business logic.

### Builder-heavy execution boundary

Controllers can express fluent query intent (including Drizzle-like ergonomics) but must not execute database operations directly.

- Controller builds intent.
- Service compiles/validates intent.
- Repository executes Drizzle queries.

Only repositories should run `db.select().from(...)`.

---

## Request pipeline for model-defined list endpoints

1. Contract parses query (`pagination/sorting/filtering/search`).
2. Controller creates query intent via builder and passes it to service.
3. Service runs input-control pipeline (normalize → constrain → policy).
4. Service validates caller scope and endpoint policy.
5. Service maps filter operators to repository-safe query operations.
6. Repository executes query and returns canonical model rows.
7. Service optionally expands relation edges (`include`) using typed include graph built from `z.lazy`-declared fields.
8. Service returns `{ data, meta }` matching contract output schema.

---

## Request pipeline for relation-aware fetch

For endpoints that expose linked entities:

1. Parse and normalize include paths.
2. Validate include paths against enum allowlist.
3. Enforce max depth to avoid unbounded graph traversal.
4. Resolve relation batches efficiently.
5. Redact unauthorized/sensitive relation fields.
6. Return model entity shape; relation fields may appear wherever the schema defines them (not tied to a specific key).

---

## Validation strategy in service layer

Use service-level validation for rules that cannot be encoded as simple schema checks:

- cross-resource ownership checks
- state transitions (deployment lifecycle, runtime actions)
- provider/runner compatibility constraints
- idempotency and conflict detection

Raise typed NestJS exceptions (`NotFoundException`, `ConflictException`, `ForbiddenException`, `BadRequestException`) so ORPC responses remain predictable.

---

## Repository strategy for filtering and sorting

To keep filters reliable and secure:

1. Build a map from contract field names to query columns.
2. Build an operator map (`eq`, `like`, `in`, `between`, etc.) to query functions.
3. Reject unknown fields/operators early.
4. Apply logical groups (`_and`, `_or`) recursively.

This preserves expressive filtering without exposing unsafe query assembly.

---

## Input-control pipeline (mandatory)

Before any service action reaches repositories:

1. normalize/coerce user input
2. enforce allowlisted fields/operators
3. clamp limits/depth/window values
4. validate relation includes from `z.lazy` relation graph
5. apply role-based restrictions/redactions
6. compile to typed query/command plan

This is the core mechanism to provide strong controls over user-provided input.

---

## Streaming execution model

For observable/stream endpoints:

- input filters are validated by contract before stream creation
- service emits discriminated event objects only
- event payloads are model-defined (or model-adjacent) schemas
- replay and cursor/sequence semantics are part of input contract

---

## Testing expectations

For each model-defined module:

- service specs cover:
  - happy path
  - role denied path
  - not found path
  - conflict path (when relevant)
- controller specs verify:
  - contract binding
  - auth middleware usage
  - handler delegation signatures

This keeps execution correctness aligned with the contract model.
