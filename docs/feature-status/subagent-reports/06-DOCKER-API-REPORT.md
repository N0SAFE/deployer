# Docker — API Layer (Subagent 1/3)

## Module Structure
- 7 source files in main module + 8 domains
- Docker controller: 1 main controller
- Spec files: 7 total in docker module

## Domains (8)
| Domain | Source Files | Spec Files | Controller? |
|--------|:-----------:|:----------:|:-----------:|
| containers | ~30 | 2 | ✅ via entity stream |
| images | ~15 | 1 | ✅ |
| networks | ~8 | 1 | ✅ |
| volumes | ~8 | 0 | ✅ |
| registries | ~5 | 1 | ✅ |
| stacks | ~5 | 1 | ✅ |
| runtime | ~10 | 1 | ✅ |
| entity | ~8 | 0 | ✅ (unified entity stream) |

## Repository Facade
- `docker.repository.ts`: ~4000+ lines (largest file)
- Contains dockerode integration for containers, images, networks, volumes
- `as unknown as` violations: 5 — lines 2133, 2143, 2149, 3943, 4011
- `process.env` scattered: 2 — `APP_DOCKER_IMAGE_SCAN_PARALLELISM`, `DEV_AUTH_KEY`

## SSE/Stream Infrastructure
- Runtime events stream via Observable
- Entity stream (unified across containers, images, networks, volumes)
- Activity stream (list + detail + stream)
- Security scan stream for images
- Container inspect stream, logs stream, processes stream

## Known Issues
- 5 `as unknown as` violations in docker.repository.ts
- 2 `process.env` scattered
- No TODOs in production code
- `docker-project-scan-config.repository.ts` flagged as dead by Knip

## Action Items
1. [M] Fix 5 `as unknown as` in docker.repository.ts — replace with Zod parse
2. [S] Centralize `process.env.APP_DOCKER_IMAGE_SCAN_PARALLELISM` → EnvService
3. [S] Centralize `process.env.DEV_AUTH_KEY` → EnvService
4. [S] Remove or revive dead `docker-project-scan-config.repository.ts`
5. [M] Ensure ALL stream chunks are validated server-side with Zod (critical rule)
