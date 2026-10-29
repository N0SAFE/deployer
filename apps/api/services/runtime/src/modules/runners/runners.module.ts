/**
 * Runners Module — top-level module for all runtime runners.
 *
 * Runners are a first-class concern, not a deployment sub-feature. Each runner
 * implements the contract in `runtime-runner.interface.ts` as a constant Effect service
 * provided below, dispatched by `RuntimeRunnerRegistry.execute(runnerKind, …)`;
 * `RuntimeRunnerRegistryService` is its Promise face for callers not on Effect yet.
 */
import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { TraefikService } from "@deployer/shared/core/modules/traefik/services/traefik.service";
import { RunnerEnvPort, RunnerTraefikPort } from "./runners.ports";
import { RuntimeRunnerRegistry, RuntimeRunnerRegistryService } from "./runtime-runner-registry.service";
import { DockerRuntimeRunner } from "./docker/docker-runtime-runner.service";
import { SwarmRuntimeRunner } from "./swarm/swarm-runtime-runner.service";
import { SwarmComposeRealizerService } from "./swarm/swarm-compose-realizer.service";

@Module({
    // `EnvModule` is imported EXPLICITLY: `SwarmRuntimeRunnerService` injects
    // `EnvService` to resolve the PLATFORM OVERLAY name it attaches every
    // workload to — the attachment that makes a deployment reachable through
    // the ingress. `EnvModule` is not global, so a missing import here is a
    // runtime DI failure rather than a compile error (caught by
    // `app.graph.spec.ts`, which compiles this module graph).
    imports: [CoreDockerModule, TraefikCoreModule, ConfigurationCoreModule, SwarmCoreModule, EnvModule],
    providers: [
        // The runners are constant Effect services; the ports, the docker engine and the cluster are read from the context.
        { provide: RunnerTraefikPort, useExisting: TraefikService },
        { provide: RunnerEnvPort, useExisting: EnvService },
        { provide: DockerRuntimeRunner, useValue: DockerRuntimeRunner.live },
        { provide: SwarmRuntimeRunner, useValue: SwarmRuntimeRunner.live },
        { provide: RuntimeRunnerRegistry, useValue: RuntimeRunnerRegistry.live },
        SwarmComposeRealizerService,
        RuntimeRunnerRegistryService,
    ],
    exports: [RuntimeRunnerRegistryService],
})
export class RunnersDomainModule {}
