# Effect migration roadmap

The target: every piece of platform logic is an Effect service in a framework-free package, and
NestJS only mounts those services (a module, a thin host class). No logic lives in a Nest class.

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
| `@deployer/docker` (engine, provisioning, scanner pool) | most of `nest-docker` |
| `@deployer/supervision` + `nest-effect/supervision` | `nest-supervisor-core` |
| `@deployer/node-state` + `nest-effect/node-state` | `nest-database-local`, `nest-nodes` |
| `@deployer/effect-{core,infra,orpc,platform,reachability}` | the shared Effect layers |
| identity, project, fleet, runtime services | Effect layers behind `serve` |

## Remaining, in dependency order

| Order | Package | Size | Consumers | Notes |
|---|---|---|---|---|
| 1 | `nest-swarm` | 2.4k loc | shared, fleet, runtime, setup | now unblocked: needs `DockerEngine` and `node-state`. Election, bootstrap, join grants, participation, fleet |
| 2 | `nest-docker` remainder | 1.5k | shared, fleet, runtime, setup | `DockerService` adapter, `BaseDockerSupervisorService`, `getDockerClient()` raw access (33 callers) |
| 3 | `nest-lifecycle`, `nest-env`, `nest-database-core` | 0.7k | all apps | env becomes an Effect `Env` service; lifecycle a scoped layer; database-core's tokens move with the global database |
| 4 | `nest-events` | 1.8k | shared, project, runtime, fleet | RxJS bus to Effect `PubSub`/`Stream` |
| 5 | `nest-service-client` | 1.4k | bff | |
| 6 | `apps/api/shared` modules | large | everything | traefik, mesh, platform-ingress, setup, supervisors' bodies (Promise inside the Effect framework today), global database |
| 7 | `apps/setup`, `apps/api/bff` wiring | | | after the shared modules |
| n/a | `nest-schema` | 5.9k | all | Drizzle table definitions and migrations are data, not Nest logic; it only needs renaming |

Check a package's dependents (`package.json` grep plus imports) before migrating it: absorb it only
when every consumer can move in the same change, otherwise keep a Promise face in the host.
