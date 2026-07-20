# Project — Complete Analysis Report (Subagents 1-3 combined)

## API Layer
- Module: `project.module.ts` — 13 source files + 4 spec files
- Controller: 38 ORPC handlers
- Services: ProjectService, ProjectEventService, WebhookService, ApiKeyService
- Repositories: ProjectRepository, WebhookRepository, ApiKeyRepository

### Known Issues
- **6 TODOs**: servicesCount stubs (3), variable-resolver integration (2), project-scoped templates (1)
- **1 production type violation**: `as any` in spec only
- **1 process.env**: `MESH_NODE_ID` in repository

## Web Layer
- **18 pages — ALL mocked** (0 use real hooks)
- **~22 domain hooks available** (production-ready)
- **17 mock imports** across 14 files

## Contracts Layer
- **58 contract files**
- **38 operations**
- All match API implementation

## Action Items (8)
1. [M] Replace stub servicesCount with real Drizzle joins — `project.controller.ts:337,354`
2. [L] Implement real health check trigger — `project.controller.ts:367`
3. [L] Integrate variable-resolver module — `project.service.ts:739,752`
4. [S] Centralize `process.env.MESH_NODE_ID` — `project.repository.ts:323`
5. [S] Remove `as any` from spec — `project.service.spec.ts:492`
6. [XL] Migrate 18 web pages from mock → real hooks
7. [S] Investigate project-scoped variable templates — `project.repository.ts:573`
8. [M] Convert DevelopmentSession types to full hook implementation
