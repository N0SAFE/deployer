/**
 * Runners Module — top-level module for all runtime runners.
 *
 * Moved verbatim from `modules/deployment/runners` so runners are a
 * first-class concern, not a deployment sub-feature. Each runner
 * implements the abstract contract in `runtime-runner.interface.ts`
 * and is dispatched by `RuntimeRunnerRegistryService.execute(runnerKind, …)`.
 */
import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { BuildpackRuntimeRunnerService } from "./buildpack/buildpack-runtime-runner.service";
import { DockerComposeRuntimeRunnerService } from "./docker-compose/docker-compose-runtime-runner.service";
import { DockerRuntimeRunnerService } from "./docker/docker-runtime-runner.service";
import { DockerfileRuntimeRunnerService } from "./dockerfile/dockerfile-runtime-runner.service";
import { NixpacksRuntimeRunnerService } from "./nixpacks/nixpacks-runtime-runner.service";
import { RailpackRuntimeRunnerService } from "./railpack/railpack-runtime-runner.service";
import { RuntimeRunnerRegistryService } from "./runtime-runner-registry.service";
import { SwarmComposeRealizerService } from "./swarm/swarm-compose-realizer.service";
import { SwarmRuntimeRunnerService } from "./swarm/swarm-runtime-runner.service";

@Module({
    imports: [CoreDockerModule, TraefikCoreModule, ConfigurationCoreModule, SwarmCoreModule],
    providers: [
        DockerRuntimeRunnerService,
        DockerfileRuntimeRunnerService,
        DockerComposeRuntimeRunnerService,
        NixpacksRuntimeRunnerService,
        BuildpackRuntimeRunnerService,
        RailpackRuntimeRunnerService,
        SwarmRuntimeRunnerService,
        SwarmComposeRealizerService,
        RuntimeRunnerRegistryService,
    ],
    exports: [RuntimeRunnerRegistryService],
})
export class RunnersModule {}
