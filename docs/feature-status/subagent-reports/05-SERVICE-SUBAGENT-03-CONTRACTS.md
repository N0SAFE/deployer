# Service — Subagent 3/3: Contracts/Entities Layer

## Contract Files: 17 files
- Root: index.ts, list.ts, schemas.ts
- CRUD sub-router: index, shared, create, find-by-id, update, delete
- Dependencies sub-router: index, list, add, remove
- Lifecycle sub-router: index, toggle-active
- Streams sub-router: index, query

## Total Operations: 10
All match controller endpoints 1:1 ✅

## Sub-routers: 4
- serviceCrudContract — 5 operations (Tag: "Service CRUD")
- serviceLifecycleContract — 1 operation (Tag: "Service Lifecycle")
- serviceDependenciesContract — 3 operations (Tag: "Service Dependencies")
- serviceStreamsContract — 1 operation (Tag: "Service Streams", SSE observable)

## Entity Schemas: 4 files
- service.schema.ts — main Service entity (25 fields, superRefine cross-validation)
- provider-config.schema.ts — 6 provider config variants
- runner-config.schema.ts — 6 runner config variants
- index.ts — barrel

## Issues
- Stale duplicate schemas.ts with z.date() vs canonical z.string() dates
- Zero contracts declare .errors(...) — missing typed error handling
- find-by-id lacks explicit .params() declaration

## Todo List (Contracts Layer ONLY)
1. [S] Remove stale schemas.ts — use @repo/contracts-entities instead
2. [M] Add .errors(...) to all 10 contracts for typed error handling
3. [S] Add explicit .params() to find-by-id contract
4. [S] Verify createdAt/updatedAt format consistency (string vs Date)
