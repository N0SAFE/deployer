# AGENTS.md — apps/api (NestJS)

Follow the root `AGENTS.md` first. This file adds API-specific guidance.

## Scope Rules

- Read this file before changing any code in `apps/api/`.
- Use MCP resources and tools to inspect dependencies and scripts.

## Quick Context via MCP

- Inspect this app:
  - `repo://app/api/package.json`
  - `repo://app/api/dependencies`
  - `repo://graph/uses/api` and `repo://graph/used-by/api`

## Workflows

Development (Docker-first):
- `bun --bun run dev:api` — start API + DB
- Logs: `bun --bun run dev:api:logs`

Database (Mandatory MCP Tools):
- Local (host):
  - `api-db { action: "generate" }` — generate migrations
  - `api-db { action: "push" }` — push schema
  - `api-db { action: "migrate" }` — run migrations
- Inside Docker (dev):
  - `api-db { action: "seed" }` — seed development data; should run against the dev DB container
  - To open a shell inside the API container: `bun --bun run dev:api:run`, then `bun --bun run db:seed`

Auth (Mandatory MCP Tool):
- Local (host): `auth-generate` — regenerate auth schema/types whenever `src/auth.ts` or auth plugins change

Testing and checks:
- Type-check: `bun --bun run api -- type-check`
- Test: `bun --bun run api -- test`

## Boundaries

- Contracts live in `packages/api-contracts`. Keep server implementation aligned with contracts.
- If contracts change, update docs and ensure web client rebuild is considered.

## Supervised / Compose-managed platform services

Platform services (global Postgres, Redis, local SQLite, Traefik, per-node
WireGuard sidecar, DB service primitive) are either **API-supervised** (the
default in `prod` / `dev-supervised`) or **compose-managed** (the `dev`
profile — Docker Compose owns the container). The `MANAGED_<SERVICE>_ENABLED`
env flags + `MANAGED_<SERVICE>_<KEY>` reach-config live in the shared
`@repo/env` schema (`packages/utils/env/src/index.ts`); `splitManagedEnv`
splits the flat vars into the nested `managed[service].key` / `.enabled`
shape.

Rules when touching supervisors (`src/core/modules/supervisors/`):

- A `true` `MANAGED_<SERVICE>_ENABLED` MUST skip the supervisor entirely (no
  registration → no spawn, no convergence). Implement via `onModuleInit`
  gating reading `splitManagedEnv(this.env).<service>.enabled` (see
  `RedisSupervisorService`, `GlobalDbSupervisorService`,
  `LocalDbSupervisorService`, `TraefikSupervisorService`,
  `WireGuardSupervisorService`, `DatabaseServiceSupervisorService`).
- Consumers resolve the managed URL through the supervisor's typed accessor
  (e.g. `RedisSupervisorService.getConnectionUrl()`), never by scattering
  `redis://` strings.
- `SetupDevService` (Phase 0) resolves the global Postgres URL from
  `managed.globalDb.*` when `MANAGED_GLOBAL_DB_ENABLED=true` and persists it
  marked `databaseProvisioning: "external"` → the GlobalDbSupervisor never
  supervises it.
- The compose-managed service declarations + the MANAGED_*_ENABLED env wiring
  live in the ORCHESTRATOR per profile (`docker-compose.dev.yml` = compose-
  managed; `dev-supervised` / `prod` = API-owned). Shared networks + volumes
  are centralized there too. Custom stacks live in `docker/compose/case/`.
- Full model: `apps/doc/content/docs/deployment/api-centric-deployment-architecture.mdx`
  → "Compose-managed platform services" + "WireGuard: private mesh overlay" +
  "Database service primitive".
