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

## Not yet covered

`@deployer/nest-docker` still owns the rest of the engine surface (exec, logs, volumes, swarm
configs/secrets, the supervisor base classes). The methods this package covers are implemented
here only; `DockerService` delegates to them and will be removed once its other callers move.
