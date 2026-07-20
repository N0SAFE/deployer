# Deployment — API Layer (Subagent 1/3)

## Module Structure
- ✅ Module file: `deployment.module.ts`
- ✅ Controller: `DeploymentController`
- 🏗️ 38 total service-like files, 13 sub-modules
- ✅ ORPC wired: 11 endpoints (list, findById, trigger, uploadBundle, cancel, rollback, getLogs, retry, getRollbackHistory, stream, streamInternal, streamService, streamQuery, streamsList)

## Services
- 38 services total
- 18 with tests (47% coverage)
- 20 without tests
- Notable: preview-cleanup-policy + preview-naming have test files but NO source (.spec exists, .ts missing)

## Repositories
- 1 repository file, 0 tests
- Heavy Drizzle queries, untested

## Queue System
- 3-layer: in-memory Map + Bull bridge + events
- Dead letter queue with replay support
- 4 queue-related services total

## State Machine
- 15 phase transitions defined
- Full validation logic

## Issues Found
- `process.env.DEPLOYMENT_UPLOAD_DIR` scattered (line 194)
- 0 TODOs ✅
- 0 `as unknown as` ✅

## Action Items (14)
1. [S] Remove dead spec files (preview-cleanup-policy, preview-naming — no source)
2. [S] Centralize process.env.DEPLOYMENT_UPLOAD_DIR → EnvService
3. [M] Add deployment.repository.ts test
4. [M] Add Bull queue service test
5. [L] Add 5 missing runner tests (Dockerfile, DockerCompose, Nixpacks, Buildpack, Railpack)
6. [M] Add storage provider tests (4 providers)
7. [M] Add storage policy resolver tests (3 resolvers)
8. [S] Add upload provider tests (2 providers)
9. [S] Add event service tests (2 services)
10. [S] Add stream bridge test
11. [S] Add load balancer adapter test
12. [S] Add container link service test
13. [S] Add preview overlay service test
14. [M] Audit in-memory state vs DB persistence drift risk
