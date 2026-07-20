# Project — Subagent 1/3: API/Backend Layer

## Module Structure
- Module: `project.module.ts` — imports DatabaseModule, ConfigurationCoreModule, EventsModule
- Exports: ProjectService, ApiKeyService, WebhookService, ProjectEventService, ProjectRepository
- 4 services + 3 repositories + 1 controller

## Controller: 38 ORPC handlers
- Core CRUD: 5 (list, findById, create, update, delete)
- Collaborators: 4 (get, invite, update, remove)
- Environments: 6 (list, get, create, update, delete, clone)
- Variable Templates: 5 (list, get, create, update, delete)
- Config: 14 (7 categories × get+update)
- Utilities: streamQuery, resolveVariables, getAvailableVariables, environment statuses
- All protected with requireAuth()

## Services (4)
- ProjectService (~900 lines) — CRUD, config, streaming, collaborator/env/template lifecycle
- ApiKeyService (~200 lines) — SHA-256 hashed keys, revoke, rotate
- WebhookService (~200 lines) — CRUD, HMAC secret, enable/disable
- ProjectEventService (~120 lines) — 7 event contracts via BasePooledEventService

## Repositories (3)
- ProjectRepository — Drizzle queries with listBuilder, event outbox in transaction
- ApiKeyRepository — key CRUD, hash lookup, scoping
- WebhookRepository — CRUD, secret rotation, trigger tracking

## API-specific Issues
- 5 TODOs (servicesCount stubs, health check stub, variable resolver, project-scoped templates)
- 0 type violations in production code ✅
- 1 process.env: MESH_NODE_ID at project.repository.ts:323
- 4 spec files with 57 tests

## Todo List (API Layer ONLY)
1. [M] Replace servicesCount: 0 stubs — project.controller.ts:337,354
2. [M] Implement real health check trigger — project.controller.ts:367
3. [M] Integrate variable-resolver module — project.service.ts:739,752
4. [S] Implement project-scoped variable templates — project.repository.ts:573
5. [S] Centralize process.env.MESH_NODE_ID → EnvService — project.repository.ts:323
