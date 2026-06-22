import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { BuildpackRuntimeRunnerService } from "./buildpack/buildpack-runtime-runner.service";
import { DockerComposeRuntimeRunnerService } from "./docker-compose/docker-compose-runtime-runner.service";
import { DockerRuntimeRunnerService } from "./docker/docker-runtime-runner.service";
import { DockerfileRuntimeRunnerService } from "./dockerfile/dockerfile-runtime-runner.service";
import { NixpacksRuntimeRunnerService } from "./nixpacks/nixpacks-runtime-runner.service";
import { RailpackRuntimeRunnerService } from "./railpack/railpack-runtime-runner.service";
import { RuntimeRunnerRegistryService } from "./runtime-runner-registry.service";
import { DeploymentLoadBalancerSyncAdapter } from "../adapters/deployment-load-balancer-sync.adapter";

@Module({
    imports: [CoreDockerModule, TraefikCoreModule, ConfigurationCoreModule],
    providers: [
        DockerRuntimeRunnerService,
        DockerfileRuntimeRunnerService,
        DockerComposeRuntimeRunnerService,
        NixpacksRuntimeRunnerService,
        BuildpackRuntimeRunnerService,
        RailpackRuntimeRunnerService,
        RuntimeRunnerRegistryService,
        DeploymentLoadBalancerSyncAdapter,
    ],
    exports: [RuntimeRunnerRegistryService],
})
export class DeploymentRunnersModule {}
