# Service — Complete Analysis Report (Subagents 1-3 combined)

## API Layer
- Module: 5 source files + 2 spec files
- Controller: 10 ORPC endpoints (CRUD + lifecycle + dependencies + streams)
- Services: ServiceService (~630 lines), ServiceEventService
- Repository: ServiceRepository (Drizzle-based)

### Known Issues
- **11 type assertions** in production code: 6 `envelope.payload as X` + 4 `payload as Y` + 1 `as Record<string, unknown>`
- **1 process.env**: `MESH_NODE_ID` in repository
- **0 TODOs** in production code ✅

## Web Layer
- **11 pages — ALL mocked** (0 use real hooks)
- **9 domain hooks available** (production-ready)
- Page consumers of real hooks: 2 (DashboardSidebar, ServiceDependencyGraphPanel)

## Contracts Layer
- **17 contract files**
- **10 operations** — all match controller endpoints 1:1
- Proper discriminated union for stream events

## Action Items (7)
1. [XL] Migrate 11 service pages from mock → real hooks
2. [M] Fix `envelope.payload as X` (6 assertions) — use Zod parse instead — `service.service.ts:446-538`
3. [M] Fix `payload as { serviceId?: string }` (4 casts) — `service.service.ts:357-378`
4. [S] Centralize `process.env.MESH_NODE_ID` — `service.repository.ts:269`
5. [S] Fix `as Record<string, unknown>` in event envelope — `service.repository.ts:275+`
6. [S] Delete `mock-hooks.ts` after migration
7. [M] Add SSE stream consumer hook to web pages
