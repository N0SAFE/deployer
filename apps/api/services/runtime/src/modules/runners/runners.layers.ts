import { Layer } from "effect";

import { RuntimeRunnerRegistry } from "./runtime-runner-registry.service";
import { DockerRuntimeRunner } from "./docker/docker-runtime-runner.service";
import { SwarmRuntimeRunner } from "./swarm/swarm-runtime-runner.service";

/** The runners and the registry that picks between them, over the docker, traefik, swarm and env ports. */
export const RunnersLive = RuntimeRunnerRegistry.Live.pipe(
    Layer.provideMerge(Layer.mergeAll(DockerRuntimeRunner.Live, SwarmRuntimeRunner.Live)),
);
