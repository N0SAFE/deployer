# @deployer/docker

The Docker engine as Effect services. Framework-free: nothing here imports Nest.

```ts
import { DockerClient, DockerEngine } from "@deployer/docker";

const DockerLive = DockerEngine.Live.pipe(Layer.provide(DockerClient.layer({ host, port })));

const program = Effect.gen(function* () {
  const docker = yield* DockerEngine;
  const { id } = yield* docker.containers.create({ Image: "nginx:alpine", name: "web" });
  yield* docker.containers.start(id);
  return yield* docker.containers.waitForHealth(id, { healthCheckUrl: "http://web/healthz" });
});
```

`DockerEngine` groups its operations by what they manage: `containers`, `images`, `swarmServices`,
`networks`. Every operation is an Effect that fails with a typed `DockerError`:

| Error | When | Kind |
|---|---|---|
| `DockerNotFound` | the engine answered 404 for what was asked | `not_found` |
| `DockerInvalid` | the request cannot be honoured, e.g. pull policy `Never` and the image is missing | `validation` |
| `DockerConflict` | engine state collides with the request, e.g. a bridge where an overlay is required | `conflict` |
| `DockerUnavailable` | the engine could not do it | `dependency_missing` |

Idempotent operations say so in their doc comment: removing something already gone and starting
something already running both succeed.

## Using it from Nest

Provide `DockerEngine.Live` over `DockerClient.layer(config)` in the app's Effect runtime layer; Nest
apps do not need a Nest module for it.

## What it covers

| Area | Where |
|---|---|
| Containers: create (with pull), start/stop/restart/pause/kill/remove, health, inspect, stats | `docker.containers` |
| Images: pull with retry, presence, remove, list | `docker.images` |
| Swarm services: inspect/create/update/reconcile/remove/scale/rollback, tasks, logs | `docker.swarmServices` |
| Swarm cluster, nodes, secrets, configs | `docker.swarmCluster`, `swarmNodes`, `swarmSecrets`, `swarmConfigs` |
| Networks (overlay ensure and VXLAN repair), volumes | `docker.networks`, `docker.volumes` |
| Exec, logs (as an Effect `Stream`), image and compose builds | `docker.exec`, `docker.logs`, `docker.build` |
| The platform Postgres service | `PostgresProvisioner` |
| Long-lived scanner containers (trivy, grype, dive) | `ScannerPool` |
| Pure helpers: swarm-spec mapper, supervisor runtime/topology, host address, node-spec payloads | top-level exports |

## What is still in `@deployer/nest-docker`

`DockerService` is now a Promise adapter over the engine (about 800 lines, down from 3,300): it keeps
the Nest exceptions and swallow-or-throw behaviour each method always had, and exposes the raw
dockerode client (`getDockerClient`) that `shared`'s supervisors still use. The supervisor base class
extends `@deployer/nest-supervisor-core`, and `PostgresServiceProvisioner` and
`ScannerContainerManagerService` are Promise faces over `PostgresProvisioner` and `ScannerPool`. All of
it goes away as those callers move to Effect.
