import type { DockerService } from "@deployer/nest-docker/services/docker.service";
import type { SwarmClusterService } from "@deployer/nest-swarm";
import type { EnvService } from "@deployer/shared/config/env/env.module";
import type { TraefikService } from "@deployer/shared/core/modules/traefik/services/traefik.service";
import { Context } from "effect";

/**
 * What the runners depend on, as Effect ports over Promise-based providers.
 *
 * The docker daemon, the swarm cluster, Traefik and the env are owned by shared packages and stay
 * Promise-based Nest providers; the runners module registers each tag with `useExisting`, so a
 * runner asks for the port without importing Nest. A port is the seam a test replaces with a fake
 * and the place a collaborator is rewritten later without touching the runners.
 */
export class RunnerDockerPort extends Context.Service<RunnerDockerPort, DockerService>()("runtime/RunnerDockerPort") {}
export class RunnerTraefikPort extends Context.Service<RunnerTraefikPort, TraefikService>()("runtime/RunnerTraefikPort") {}
export class RunnerSwarmClusterPort extends Context.Service<RunnerSwarmClusterPort, SwarmClusterService>()(
    "runtime/RunnerSwarmClusterPort",
) {}
export class RunnerEnvPort extends Context.Service<RunnerEnvPort, EnvService>()("runtime/RunnerEnvPort") {}
