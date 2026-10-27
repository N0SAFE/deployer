# AGENTS.md — apps/api-services/shared (the platform core)

Follow the root `AGENTS.md` and `apps/api-services/AGENTS.md` first. This file holds the rules that
belong to the platform core every tier app builds on: supervised platform services, edge providers
and the boot model. They were written for the monolith (`apps/api`) and carried over here when it
was retired; paths and compose files are the tier's.

`shared` is a base, not an app: it must not import the BFF or a service (`bun run check:di-graph`
enforces it). Apps reach it as `@deployer/shared/...`; the BFF also maps `@/core/*`, `@/config/*`
and `@/auth` to it in its tsconfig and vitest config.

## Supervised / compose-managed platform services

Platform services (global Postgres, Redis, local SQLite, Traefik, the public edge connector, the
database service primitive, managed web) are either **supervised as SWARM SERVICES** (the default)
or **deployment-managed** (`MANAGED_<SERVICE>_ENABLED=true`: compose or the operator owns the
process and the supervisor only wires networks). The flags and their `MANAGED_<SERVICE>_<KEY>`
reach-config live in the shared `@deployer/env` schema (`packages/config/env/src/index.ts`);
`splitManagedEnv` turns the flat variables into the nested `managed[service].key` / `.enabled`
shape.

**There is no plain-container runtime.** Each supervisor declares a `scope`, and
`resolveSupervisorRuntime` maps it to a swarm mode:

| Scope | Runtime | Examples |
|---|---|---|
| `node-local` | `swarm-global` (one task per node) | Traefik ingress |
| `mesh-wide` | `swarm-replicated` (one shared service) | global Postgres, Redis, database-service instances, managed web, edge connector |
| n/a | `managed` | `MANAGED_*_ENABLED=true`: link-only wiring, never spawn |
| n/a | `unavailable` | engine is not a swarm member: **degrade**, never fall back to a container |

`SwarmBootstrapService` (`packages/nest/swarm`) converges the engine at boot, so a swarm is normally
available; a supervisor that still finds none reports `unavailable` with an actionable message
instead of spawning a second, container-based copy of its process.

The node's **mesh agent** and its **doors** are not supervised services: the agent is a plain
host-network container (it must exist before Swarm, which binds its mesh address), started by setup
or by `MeshAgentBootstrapService`, and it runs the doors itself. See `docs/edge-mesh-architecture.md`.

Swarm service specs need three things beyond the obvious fields; getting them wrong breaks
node-local services:

- **network `aliases`**: consumers resolve platform services by stable alias (`global-db`, `redis`,
  `traefik`, `db-<instance>`), which a prefixed deployment's service name does not match;
- **`publishMode: host`**: a GLOBAL service cannot publish through the routing mesh, and per-node
  bind conflicts must stay visible rather than be load-balanced away;
- **`capabilitiesAdd`**: WireGuard needs `NET_ADMIN`.

The global Postgres spec lives in `PostgresServiceProvisioner`, ONE builder shared by setup and
`GlobalDbSupervisorService`, so the two cannot drift into two different databases.

### Rules when touching supervisors (`src/core/modules/supervisors/`)

- A supervisor NEVER spawns a plain container. Declare `buildSwarmSpec()` (+ `scope`) and call
  `reconcileSwarmService()`; the base class throws if the removed `buildContainerSpec()` path is
  reached. `swarm-only-supervision.acceptance.spec.ts` guards this.
- A `true` `MANAGED_<SERVICE>_ENABLED` MUST skip the supervisor entirely (no registration, no spawn,
  no convergence): gate in `onModuleInit` by reading `splitManagedEnv(this.env).<service>.enabled`
  (see `RedisSupervisorService`, `GlobalDbSupervisorService`, `LocalDbSupervisorService`,
  `TraefikSupervisorService`, `WireGuardSupervisorService`, `DatabaseServiceSupervisorService`).
- Consumers resolve a managed URL through the supervisor's typed accessor (for example
  `RedisSupervisorService.getConnectionUrl()`), never by scattering `redis://` strings.
- The global Postgres URL comes from `node_config.databaseUrl`, WRITTEN BY SETUP
  (`SetupGateService`, the wizard's choice) and read here. `databaseProvisioning: "external"` means
  the URL was provided (compose-managed or pasted), so the global DB supervisor never supervises
  it; `"local"` means the platform owns and supervises the database.
- **The API tier is the only reader of `node_config` during onboarding.** Setup is the only writer,
  which is what makes sharing the SQLite volume safe with no lock.
- Compose-managed declarations and the `MANAGED_*_ENABLED` wiring live in the compose files per
  profile: `infra/docker/compose/docker-compose.services.dev.yml` (compose-managed),
  `docker-compose.services.dev-supervised.yml` and `docker-compose.prod.yml` (platform-owned).
  Shared networks and volumes are centralised there.
- Full model: `apps/doc/content/docs/deployment/api-centric-deployment-architecture.mdx`
  ("Compose-managed platform services", "WireGuard: private mesh overlay", "Database service
  primitive").

## Edge providers (plugins)

The public lane is served by ONE edge provider, chosen by the operator. Providers implement
`EdgeProvider` (`src/core/modules/edge/edge-provider.ts`) and register themselves into
`EdgeProviderRegistry` from their constructor. Core code (the Traefik supervisor,
`EdgeConnectorSupervisorService`, the DNS plane, the domain gate) only ever talks to the registry or
`PublicEdgeService`: never name a provider in core. Built in: `direct` (`core/modules/edge/providers`)
and `cloudflare-tunnel` (`services/fleet/src/modules/providers/edge/cloudflare-tunnel`).
Cluster-wide state goes through `ClusterSettingsService` (replicated by the mesh), never a
node-local store.

## Boot model: apps start behind setup, and onboarding belongs to `apps/setup`

| Phase | Owner |
|---|---|
| found or join the swarm, WireGuard, the wizard, the handover | **`apps/setup`** |
| DB provisioning, migrations, seed, admin, every product feature | **the API tier** (BFF + services) |

Rules that follow from this:

- **Never make the API serve onboarding.** No wizard page, no `/setup` UI, no "pre-setup mode". The
  BFF's `/setup/*` surface remains because it is the EXECUTOR (it has the schema, migrations and
  auth): setup forwards the contract calls and the BFF produces the SSE stream. Setup owns the
  wizard PAGE and the gate.
- **The tier starts BEHIND setup, not before it.** `GET /setup/health` means "the tier may start": an
  input to its existence, never a report about it. In dev, compose enforces the order
  (`depends_on: setup-dev: service_healthy`); in prod, setup schedules the tier when the gate opens.
- **Fail-fast is about READINESS, not process start.** Every app answers liveness immediately
  (`/health`), and `/health/ready` stays 503 until its `PreflightModule` dependencies pass. Boot
  waits for them (60 s by default, `PREFLIGHT_WAIT_MS` overrides, retrying every 2 s) and an app
  whose dependencies never came up exits with code 5 rather than serve a half-working API. That is
  why `GlobalDatabaseModule` creates a placeholder pool rather than throwing.
- **`BootstrapOrchestratorService` is the RESTART path, not the install path.** It runs only when
  `node_config.setupState === "setup_done"`; on a fresh install it logs why and stops, because the
  WIZARD owns the first provisioning (the operator's credentials are in its trigger, not in the
  environment). Running it earlier would create an admin from `DEFAULT_ADMIN_*` defaults nobody
  chose and race the wizard's own `migrate`. The restart path it owns: swarm app wiring, DB probe,
  pending global migrations, default admin.
- **Do not reintroduce a sub-app runner.** Independent Nest contexts were the source of the "some DI
  works, some silently injects undefined" class of bug.

## Run from source, do not bundle

The tier's images run `bun run start` from the pruned workspace (see
`infra/docker/builder/api/Dockerfile.api.prod`); there is no bundling step. Bundling breaks Nest DI:
bun emits some classes through the TC39 decorator path, which writes no `design:paramtypes`, so
plain typed constructor parameters arrive `undefined`, and WHICH classes lose it varies with the
module graph. Importing one file as both `@/core/x` and `./x` also loads it twice (two class
objects, and Nest reports the provider as unresolvable), so keep one specifier style per file.
