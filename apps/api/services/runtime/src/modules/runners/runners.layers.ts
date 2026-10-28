import { DockerClient, DockerEngine } from "@deployer/docker";
import { Effect, Layer } from "effect";

import { RunnerEnvPort } from "./runners.ports";
import { DockerRuntimeRunner } from "./docker/docker-runtime-runner.service";
import { RuntimeRunnerRegistry } from "./runtime-runner-registry.service";
import { SwarmRuntimeRunner } from "./swarm/swarm-runtime-runner.service";

/** The docker engine, connected as the platform env says. */
const DockerEngineLive = DockerEngine.Live.pipe(
    Layer.provide(
        Layer.unwrap(
            Effect.gen(function* () {
                const env = yield* RunnerEnvPort;
                return DockerClient.layer({ host: env.get("DOCKER_HOST"), port: env.get("DOCKER_PORT") });
            }),
        ),
    ),
);

/** The runners and the registry that picks between them, over the docker engine and the swarm, traefik and env ports. */
export const RunnersLive = RuntimeRunnerRegistry.Live.pipe(
    Layer.provideMerge(Layer.mergeAll(DockerRuntimeRunner.Live, SwarmRuntimeRunner.Live)),
    Layer.provide(DockerEngineLive),
);
