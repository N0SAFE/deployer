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
WireGuard sidecar, DB service primitive, failover proxy, managed web) are
**API-supervised as SWARM SERVICES** (the default) or **deployment-managed**
(`MANAGED_<SERVICE>_ENABLED=true` — compose/operator owns the process and the
supervisor only wires networks). The `MANAGED_<SERVICE>_ENABLED` env flags +
`MANAGED_<SERVICE>_<KEY>` reach-config live in the shared `@repo/env` schema
(`packages/config/env/src/index.ts`); `splitManagedEnv` splits the flat vars
into the nested `managed[service].key` / `.enabled` shape.

**There is no plain-container runtime.** Each supervisor declares a `scope` and
`resolveSupervisorRuntime` maps it to a swarm mode:

| Scope | Runtime | Examples |
|---|---|---|
| `node-local` | `swarm-global` (one task per node) | Traefik ingress, WireGuard, failover proxy |
| `mesh-wide` | `swarm-replicated` (one shared service) | global Postgres, Redis, database-service instances, managed web |
| — | `managed` | `MANAGED_*_ENABLED=true` → link-only wiring, never spawn |
| — | `unavailable` | engine is not a swarm member → **degrade**, never fall back to a container |

`SwarmBootstrapService` converges the engine at boot, so the swarm runtime is
always available; a supervisor that still finds no active swarm reports
`unavailable` with an actionable message instead of spawning a second,
container-based copy of its process.

## Boot model: ONE graph, and onboarding belongs to `apps/setup`

`main.ts` and `compile.ts` both build `AppModule`. There is no gateway, no
sub-app pipeline, and no runtime fallback swapping — `main.ts` used to build a
separate `OrchestrationModule` because the API could be launched BEFORE setup had
run. That whole arrangement is gone (phase 8 of `docs/setup-app-refactor-plan.md`),
because onboarding is now a different app:

| Phase | Owner |
|---|---|
| found/join the swarm, WireGuard, the wizard, the handover | **`apps/setup`** |
| DB provisioning, migrations, seed, admin, all product features | **`apps/api`** |

Rules that follow from this:

- **Never make the API serve onboarding.** No wizard page, no `/setup` UI, no
  "pre-setup mode". The API's `/setup/*` surface remains because it is the
  EXECUTOR (it has the Drizzle schema, migrations and auth); setup forwards the
  contract calls and the API produces the SSE stream. Setup owns the wizard
  PAGE and the gate.
- **The API starts BEHIND setup, not before it.** `GET /setup/health` means "the
  API may start" — it is an input to the API's existence, never a report about
  it. In dev compose enforces the order (`api-dev: depends_on: setup-dev:
  service_healthy`); in prod setup schedules the task when the gate opens. There
  is no cycle to work around, because neither process waits on the other.
- **Fail-fast is about READINESS, not process start.** A node whose onboarding
  has not finished still has to answer liveness, so `/health` replies
  immediately and `/health/ready` stays 503 until the platform is green. That is
  why `GlobalDatabaseModule` creates a placeholder pool rather than throwing.
- **`BootstrapOrchestratorService` is the RESTART path, not the install path.**
  It runs only when `node_config.setupState === "setup_done"`; on a fresh install
  it logs why and stops, because the WIZARD owns the first provisioning — the
  operator's credentials are in its trigger, not in the environment. Running it
  earlier would create an admin from `DEFAULT_ADMIN_*` defaults that nobody chose
  and would race the wizard's own `migrate`. The restart path it does own: swarm
  app wiring → DB probe → pending global migrations → default admin.
- **Do not reintroduce a sub-app runner.** Independent Nest contexts were the
  source of the "some DI works, some silently injects undefined" class of bug,
  and `check-di-graph.ts` now anchors its root at `app.config.ts → AppModule`.

## Build: transpile 1:1, never bundle

`scripts/build.ts` transpiles `src/**` file-by-file. **Bundling breaks Nest DI**:
bun emits some classes through the TC39 decorator path, which writes no
`design:paramtypes`, so every plain typed constructor parameter arrives
`undefined`:

```
TypeError: undefined is not an object ('this.meshTopology.registerControlEnvelopeHandler')
```

WHICH classes lose it varies with the module graph (it moved from
`SystemMeshConfigService` to `SystemMeshTopicService` when the graph changed), so
annotating constructors cannot keep up. Measured: 1:1 emits 629
`design:paramtypes`, the bundler 561.

One requirement of per-file output: `@/core/x` and `./x` are different module
specifiers, so importing one file both ways loads it TWICE — two class objects,
and Nest reports the provider as unresolvable. The build rewrites every `@/`
specifier to a relative path for that reason. It also FAILS when zero decorator
metadata is emitted, so the loss cannot ship silently.


Swarm service specs need three things beyond the obvious fields, and getting
them wrong breaks node-local services:

- **network `aliases`** — consumers resolve platform services by stable alias
  (`global-db`, `redis`, `traefik`, `db-<instance>`), which a prefixed
  deployment's service name does not match;
- **`publishMode: host`** — a GLOBAL service cannot publish through the routing
  mesh, and per-node bind conflicts must stay visible rather than be
  load-balanced away;
- **`capabilitiesAdd`** — WireGuard needs `NET_ADMIN`.

The global Postgres spec lives in `PostgresServiceProvisioner` (ONE builder
shared by setup and `GlobalDbSupervisorService`) so the two can never drift
into two different databases.

Rules when touching supervisors (`src/core/modules/supervisors/`):

- A supervisor NEVER spawns a plain container. Declare `buildSwarmSpec()`
  (+ `scope`) and call `reconcileSwarmService()`; the base class throws if
  `buildContainerSpec()` (the removed legacy path) is reached.

- A `true` `MANAGED_<SERVICE>_ENABLED` MUST skip the supervisor entirely (no
  registration → no spawn, no convergence). Implement via `onModuleInit`
  gating reading `splitManagedEnv(this.env).<service>.enabled` (see
  `RedisSupervisorService`, `GlobalDbSupervisorService`,
  `LocalDbSupervisorService`, `TraefikSupervisorService`,
  `WireGuardSupervisorService`, `DatabaseServiceSupervisorService`).
- Consumers resolve the managed URL through the supervisor's typed accessor
  (e.g. `RedisSupervisorService.getConnectionUrl()`), never by scattering
  `redis://` strings.
- The global Postgres URL comes from `node_config.databaseUrl`, WRITTEN BY SETUP
  (`SetupGateService` — the wizard's choice) and read here. `databaseProvisioning:
  "external"` means the URL was provided (compose-managed or pasted) → the
  GlobalDbSupervisor never supervises it; `"local"` means this API owns and
  supervises the database.
- **The API is the only reader of `node_config` during onboarding.** Setup is the
  only writer, which is what makes sharing the SQLite volume safe with no lock.
- The compose-managed service declarations + the MANAGED_*_ENABLED env wiring
  live in the ORCHESTRATOR per profile (`docker-compose.dev.yml` = compose-
  managed; `dev-supervised` / `prod` = API-owned). Shared networks + volumes
  are centralized there too. Custom stacks live in `infra/infra/docker/compose/case/`.
- Full model: `apps/doc/content/docs/deployment/api-centric-deployment-architecture.mdx`
  → "Compose-managed platform services" + "WireGuard: private mesh overlay" +
  "Database service primitive".
