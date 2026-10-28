# Effect migration roadmap

The target: every piece of platform logic is an Effect service in a framework-free package, and
NestJS only mounts those services (a module, a thin host class). No logic lives in a Nest class.

## Streaming stays RxJS

Logic and state are Effect; streaming and observability stay RxJS. A host exposes changes to Nest
callers as `Observable`s (SSE, subscriptions, `on(...)`), sourced from the Effect `Stream`/`PubSub`
inside the package. Do not rewrite an RxJS bus or SSE pipeline into Effect streams.

## The pattern

1. **Package by feature**, not by framework: `packages/<feature>` exporting `Context.Service` tags,
   `make<Service>(deps)` factories, layers, typed `domainError`s and `Test`/fake layers. No Nest import.
2. **Typed failures**, never `throw`; Promise APIs enter through `fromAbortable` so interruption
   aborts the work.
3. **Nest host** in `@deployer/nest-effect/<feature>`: the module and, while a caller is not on
   Effect yet, a Promise (or synchronous) face over the Effect service. The face holds no logic.
4. **Delete the old `nest-*` package** once its consumers are repointed; no compatibility shims.

## Done

| Package | Replaces |
|---|---|
| `@deployer/docker` (engine, provisioning, scanner pool) + `nest-effect/docker` | `nest-docker` (the Promise `DockerService` adapter, supervisor base class and scanner/postgres hosts now live in `nest-effect/docker`) |
| `@deployer/supervision` + `nest-effect/supervision` | `nest-supervisor-core` |
| `@deployer/node-state` + `nest-effect/node-state` | `nest-database-local`, `nest-nodes` |
| `@deployer/lifecycle` + `nest-effect/lifecycle` | `nest-lifecycle` |
| `@deployer/environment` + `nest-effect/env` | `nest-env` |
| `@deployer/database` + `nest-effect/database` | `nest-database-core` |
| `@deployer/service-client` | `nest-service-client` (no Nest host: only the bff uses it, through its own module) |
| `@deployer/events` + `nest-effect/events` | `nest-events` (journal in Effect; streaming stays RxJS) |
| `@deployer/swarm` + `nest-effect/swarm` | `nest-swarm` (the runtime swarm runner uses `SwarmCluster` directly) |
| `@deployer/effect-{core,infra,orpc,platform,reachability}` | the shared Effect layers |
| identity, project, fleet, runtime services | Effect layers behind `serve` |

## Remaining, in dependency order

| Order | Package | Size | Consumers | Notes |
|---|---|---|---|---|
| 1 | Promise `DockerService` methods (last, with the shared modules) | | shared, fleet, runtime, setup | `getDockerClient()` is deleted: every caller is on the engine (events, exec.interactive, wait/top, network attach, volume/image inspect, info). Left: callers of the Promise `DockerService` methods (`createContainer`, `removeContainer`, swarm helpers), then delete that adapter |
| 2 | `apps/api/shared` modules | large | everything | traefik, mesh, platform-ingress, setup, supervisors' bodies (Promise inside the Effect framework today), global database |
| 3 | `apps/setup`, `apps/api/bff` wiring | | | after the shared modules |
| n/a | `nest-schema` | 5.9k | all | Drizzle table definitions and migrations are data, not Nest logic; it only needs renaming |

Check a package's dependents (`package.json` grep plus imports) before migrating it: absorb it only
when every consumer can move in the same change, otherwise keep a Promise face in the host.
