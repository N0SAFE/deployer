# 05 — Frontend Contract Consumption

This document defines how model-defined contracts are consumed in the web layer.

---

## Domain data-layer structure

Each feature domain should expose:

```text
apps/web/src/domains/<feature>/
  endpoints.ts      # direct ORPC endpoint mapping
  hooks.ts          # query/mutation hooks used by UI
  invalidations.ts  # cache invalidation policy
```

This keeps components thin and prevents direct ORPC usage inside UI components.

---

## Endpoint surface mirrors contract surface

`endpoints.ts` should be a clear projection of ORPC contract tree:

- CRUD endpoints
- relation-aware query endpoints
- stream endpoints
- action/mutation endpoints

No shape rewriting in this layer unless strictly required for compatibility.

---

## Hooks consume typed contract inputs

`hooks.ts` should:

1. Use endpoint-provided query/mutation options.
2. Accept typed input that matches contract schemas.
3. Keep helper hooks focused (`useProject`, `useServiceList`, `useContainerLinkedList`, etc.).

For list pages, pass contract-derived query input (filter, pagination, sorting, include) directly.

When user-driven filter builders exist in UI (search/filter panels), they should emit a controlled query shape that maps 1:1 to contract-allowed fields/operators.

---

## Invalidation policy is model-aware

`invalidations.ts` should invalidate using model keys:

- list on create/delete
- findById + list on update
- relation subqueries on relation mutations
- status/stream projections on lifecycle actions

Invalidation logic should resolve IDs from input consistently (`params.id`, fallback IDs, etc.).

---

## Relation-aware UI queries

When UI needs linked models:

1. Use endpoint query with typed `include` paths.
2. Keep `include` values within contract allowlist.
3. Avoid fetching large relation graphs by default.
4. Use `maxDepth` defensively when supported.

All user-selected includes should pass through a local include-control builder (UI-side allowlist) before request dispatch.

This prevents overfetching and keeps the UI aligned with backend relation constraints.

---

## Role-aware rendering

UI behavior should compose:

- contract capability (what endpoint can return)
- user permissions (what user can do)

Recommended pattern:

- Use permission hooks to gate actions.
- Keep read paths available where permitted.
- Hide/disable unauthorized mutating operations.

---

## Streaming UX in model-defined systems

For event streams:

- subscribe with typed filters
- render discriminated event types explicitly
- keep replay windows and limits user-configurable where useful
- combine with optimistic invalidation carefully

Streams should complement model list/detail queries, not replace them.

---

## User input transformation in UI (recommended)

For complex filters/forms, add a client-side transformation builder that:

1. normalizes raw user values
2. maps UX controls to contract field names
3. strips unsupported operators
4. clamps limits and page sizes
5. emits a strongly typed request payload

This improves UX and reduces server-side rejection noise while keeping server-side controls authoritative.
