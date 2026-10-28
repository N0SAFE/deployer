/**
 * Runners Module — top-level module for all runtime runners.
 *
 * Runners are a first-class concern, not a deployment sub-feature. Each runner
 * implements the contract in `runtime-runner.interface.ts` as an Effect Layer
 * (`runners.layers.ts`), dispatched by `RuntimeRunnerRegistry.execute(runnerKind, …)`;
 * `RuntimeRunnerRegistryService` is its Promise face for callers not on Effect yet.
 */
import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { SwarmClusterService } from "@deployer/nest-swarm";
import { TraefikService } from "@deployer/shared/core/modules/traefik/services/traefik.service";
import { RunnerEnvPort, RunnerSwarmClusterPort, RunnerTraefikPort } from "./runners.ports";
import { RuntimeRunnerRegistryService } from "./runtime-runner-registry.service";
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
        // The runners are Effect Layers (`runners.layers.ts`) over these ports.
        { provide: RunnerTraefikPort, useExisting: TraefikService },
        { provide: RunnerSwarmClusterPort, useExisting: SwarmClusterService },
        { provide: RunnerEnvPort, useExisting: EnvService },
        SwarmComposeRealizerService,
        RuntimeRunnerRegistryService,
    ],
    exports: [RuntimeRunnerRegistryService],
})
export class RunnersDomainModule {}
