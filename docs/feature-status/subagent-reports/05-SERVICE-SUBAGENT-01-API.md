# Service — Subagent 1/3: API/Backend Layer

## Module Structure
- Module: `service.module.ts` — imports DatabaseModule, ProjectCoreModule, ConfigurationCoreModule, EventsModule
- Exports: ServiceService, ServiceRepository, ServiceEventService
- 10 ORPC endpoints, all via @Implement with requireAuth()

## Controller: 10 ORPC endpoints
- CRUD: list, findById, create, update, delete
- Lifecycle: toggleActive
- Dependencies: list, add, remove
- Streams: query (SSE observable)

## Services (2)
- ServiceService (~662 lines) — CRUD, cycle detection via BFS, stream query with replay+live, event emission
- ServiceEventService (~55 lines) — 6 event contracts via BasePooledEventService

## Repository (1)
- ServiceRepository (~350 lines) — Drizzle CRUD, listBuilder filtering, event outbox writes

## API-specific Issues
- 1 process.env: `MESH_NODE_ID` at service.repository.ts:258
- 0 `as unknown as`/`as any` in production code (but 11 manual type assertions exist: 6 `envelope.payload as X` + 4 `payload as Y` + 1 `as ServiceRow["metadata"]`)
- 2 spec files (controller + service), 0 for repository or event service
- Duplicated runtime config resolution in create/update
- Dual event emission path (repository + service)
- toServiceStreamEvent untested (~90 lines switch)

## Todo List (API Layer ONLY)
1. [S] Centralize `process.env.MESH_NODE_ID` — service.repository.ts:258
2. [M] Replace `as ServiceRow["metadata"]` with Zod parse — service.repository.ts:71
3. [M] Replace 6 `envelope.payload as X` with Zod safeParse — service.service.ts:435-525
4. [S] Extract duplicated runtime config resolution — service.service.ts create/update
5. [M] Remove localEventOutbox writes from repository — move to service layer
6. [S] Add typed response schemas for delete/removeDependency
7. [S] Add tests for toServiceStreamEvent (untested, 6 branches)
8. [S] Add tests for ServiceEventService (0 tests)
9. [M] Add tests for ServiceRepository (0 tests)
