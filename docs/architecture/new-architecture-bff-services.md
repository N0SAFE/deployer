# New Architecture: BFF + Services

This document is the map for the architecture `apps/api/src` is being migrated TO: a
**BFF** plus **five services**, each owning one bounded context. The monolith stays
runnable until every service is verified, so both exist side by side by design.

## Topology

```
                    ┌─────────────────────────────────────────┐
   browser ────────▶│  bff  (:3005)                           │
   (the only        │  · the ONLY process that parses a cookie │
    public edge)    │  · session + auth authority              │
                    │  · renders the React console pages       │
                    │  · forwards /<namespace>/* to the owner  │
                    └───────────────┬─────────────────────────┘
                                    │ one client per namespace
        ┌───────────────┬───────────┼───────────┬───────────────┐
        ▼               ▼           ▼           ▼               ▼
   svc-health      svc-identity  svc-project  svc-fleet    svc-runtime
     (:3101)         (:3102)      (:3103)      (:3104)       (:3105)
   probes +        users,        projects,    cluster,      docker,
   supervisor      permissions,  services,    nodes,        deployments,
   roll-up         analytics,    domains      providers,    runners
                   push                       reachability
```

Each service is reachable by its **compose/service name** (`http://svc-project:3103`).
There is no routing table to keep in sync: the service's NAME in `API_SERVICES`
(`apps/api-services/shared/src/server/service-address.ts`) is also its contract namespace and
its DNS name.

## Where things live

| Concern | Location | Why there |
|---|---|---|
| Contracts (Zod → oRPC) | `packages/contracts/{health,identity,project,runtime,fleet,bff}` | One package per service; a service imports ONLY its own |
| Entities (shared shapes) | `packages/contracts/entities` | Referenced by several contracts, so it cannot live in one |
| Core infrastructure | `apps/api-services/shared/src/core` | Shared by every app, addressed as `@/core/*` |
| Shared server runtime | `apps/api-services/shared/src/server` | `createOrpcModule`, preflight, health indicators, service catalog |
| Service apps | `apps/api-services/services/<name>` | One Nest app per bounded context |
| BFF app | `apps/api-services/bff` | Public edge, session authority, SSR views |
| Ops CLI | `apps/api-services/bff/src/cli` (+ `src/cli.ts`) | Node-scoped administration: migrations, seed, admin, startup check. It writes `node_config` and can run BEFORE any network exists, so it belongs on the node's own process (the BFF), not in a service |
| Local node state | `<app>/node_config` (SQLite) | Node-scoped facts; survives a profile switch |

## Build and run

```bash
# Build and start the full new-architecture stack (BFF + 5 services + builder + redis)
bun run dev:services

# Status, logs, teardown
bun run dev:services:ps
bun run dev:services:logs
bun run dev:services:down

# The monolith is unchanged and still the default
bun run dev
```

The two profiles **share volumes and networks but not containers**: both derive names
from `COMPOSE_PROJECT_NAME`, and only the container names differ (`…-bff-dev` vs
`…-api-dev`). Sharing `dep-output` and `api_local_db_data_dev` is deliberate — the
internal packages and the node's SQLite are node-level state, and a profile switch must
not orphan them.

## The build, and the two facts about an app

One Dockerfile builds every app (`infra/docker/builder/app/Dockerfile.app.dev`),
parameterised by **two** args because a workspace has two facts about an app that
stopped agreeing when services arrived:

| Arg | Meaning | Example |
|---|---|---|
| `APP` | workspace **package name** — what `turbo prune` and `turbo run --filter` accept | `@deployer/svc-health` |
| `APP_SRC_DIR` | source **directory** — what the runner stage `WORKDIR`s into | `api/services/health` |

They coincide for the four original apps (`api` → `api`); deriving one from the other
produced `/app/apps/@deployer/svc-health`, a directory that never exists.

`turbo prune` needs the NAME because it takes selectors, not paths:

```bash
turbo prune @deployer/svc-health --docker   # package name
turbo prune api/services/health         # ✗ Invalid scope
```

## Isolation mode, and why a dependency must be declared

`bunfig.toml` sets:

```toml
[install]
linker = "isolated"
```

So each workspace resolves its dependencies from its **own** `node_modules`. Inside the
monorepo this is invisible — hoisting supplies a package that was never declared — but
the Docker image installs the pruned tree in isolation, where an undeclared package is
genuinely absent. Three consequences, each of which bit during the migration:

1. **An imported package must be declared**, even a workspace one. Four services
   imported `@deployer/nest-database-core` without declaring it.
2. **Every workspace's `node_modules` must reach the image.** The runner stage copies
   them by glob, and the list must name each depth a workspace can sit at
   (`apps/*/*/node_modules` was missing, so `apps/api/services/health/node_modules` was
   never copied).
3. **A package whose `bin` target is absent cannot be invoked.** `@deployer/pkg-build`'s bin
   is `./dist/cjs/main.js`, and `dist` is in `.dockerignore`, so its own build has to run
   before any consumer's — see the bootstrap note in
   `infra/docker/builder/dependency-builder/Dockerfile.dependency-builder.dev`.

### The build gate, and the two races it had

The builder writes `/dep-output/.initial-build-complete` once its first build succeeds,
and `entrypoint-app.sh` waits for that stamp before starting the app. Two ordering bugs
made a cold or warm start fail intermittently, and both produced the SAME misleading
error, which is why they took a while to separate:

```
error: Cannot find module '@deployer/auth/server' from
'/app/apps/api-services/shared/src/config/auth/auth.ts'
```

1. **The entrypoint linked before it waited.** It created each package's `dist` symlink
   into the volume, *then* waited for the stamp. A container that won the race ran the
   linking against an empty volume, and its `mkdir -p` fallback SUCCEEDED (the volume is
   writable), leaving a real but empty `dist/`. The wait then passed, the builder
   published, and the app started against a link decided while the directory was empty.
   Fixed by waiting FIRST.

2. **The stamp outlived the build it described.** It lives in the shared volume, so it
   survived a `compose up` that keeps volumes. On the next start every app saw the gate
   already open and read a tree the new build had not finished writing. The giveaway was
   a second error naming a file INSIDE a published package:

   ```
   error: Cannot find module '../chunks/auth-client-*.mjs' from
   '/dep-output/packages/@deployer/auth/dist/production/esm/index.mjs'
   ```

   — the chunks existed, but the consumer resolved through an index from an in-progress
   run. Fixed by removing the stamp at the START of every build, so its presence always
   means *this* run published the artifacts.

Both were verified by a cold start (`down --volumes` then `up`) and a warm restart
(`down` then `up`), with all five services serving afterwards.

## Startup contract: readiness, not liveness

Every app declares its own dependencies and **refuses to serve** without them
(`PreflightModule` → `exit 5`). Compose therefore needs no knowledge of what each app
needs; it only waits for the app's honest answer before starting the next one:

| App | Declares | Gate means |
|---|---|---|
| `svc-health`, `svc-identity`, `svc-project`, `svc-runtime`, `svc-fleet` | `DEPENDENCIES.database` | Postgres reachable AND migrated |
| `bff` | `DEPENDENCIES.platform` | …and Redis reachable |

`/health/ready` is 503 until preflight passes, so `service_healthy` already means "its
dependencies were usable". `/health` (liveness) is deliberately NOT the healthcheck: it
answers 200 the moment the port is bound, before preflight has run.

> `svc-*` declares `DEPENDENCIES.database`, which needs the **global Postgres**. That is
> provisioned by the onboarding wizard as a Swarm service
> (`GlobalDbSupervisorService`), so in `dev:services` — before onboarding — each service
> stays in preflight and `/health/ready` returns 503 while `/health` answers 200. That is
> the designed state, not a failure.

## Verified state

| App | Tests | `/health` |
|---|---|---|
| `bff` | 47 | 200 |
| `svc-health` | 6 | 200 |
| `svc-identity` | 64 | 200 |
| `svc-project` | 127 | 200 |
| `svc-runtime` | 288 | 200 |
| `svc-fleet` | 139 | 200 |
| **Total** | **671** | |

The monolith is unchanged: **908 passing**, type-checks clean. Every procedure it binds
(256) is also bound somewhere in the new architecture, and each ported module matches or
exceeds the source's line count — `apps/api/src` is the reference, not a dependency.

### The ops CLI

Ported to `apps/api-services/bff/src/cli` with `src/cli.ts` as the entry:

```bash
bun --bun run cli --help
bun --bun run db:migrate     # bun --bun src/cli.ts migrate
bun --bun run db:seed
bun --bun run db:reset
bun --bun run admin:create
bun --bun run startup-check  # exit-code contract for the entrypoint scripts
```

It needed no specifier changes: its `@/core/*` and `@/config/*` imports resolve through
the BFF's tsconfig paths to the same `shared/src` files, because both apps declare the
same remap.

It also exposed a **pre-existing** failure worth recording: `bun src/cli.ts <anything>`
never worked in the monolith either, because `AuthModule.forRootAsync` injects
`GLOBAL_DATABASE_CONNECTION` and the connection was declared among `CLIModule`'s own
providers — invisible to an imported module. The CLI now imports the shared
`DatabaseModule` like every other app, which fixes it in both.

## Adding a service

1. Create `packages/contracts/<name>` with the Zod schemas and the contract router.
2. Create `apps/api-services/services/<name>` with `src/app.module.ts` and `src/main.ts`
   (`bootstrapApiServer` derives the port from the catalog).
3. Add the name to `API_SERVICES` in `apps/api-services/shared/src/server/service-address.ts`.
4. Add an entry to `infra/docker/compose/common/api/docker-compose.config.services.yml`
   with `APP=<package name>` and `APP_SRC_DIR=api/services/<name>`.
5. Add the container plus its `depends_on` to
   `infra/docker/compose/docker-compose.services.dev.yml`.
6. Declare every package it imports in its own `package.json` — isolation mode will not
   supply one you forgot.
