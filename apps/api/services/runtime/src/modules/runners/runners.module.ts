/**
 * Runners Module — top-level module for all runtime runners.
 *
 * Runners are a first-class concern, not a deployment sub-feature. Each runner
 * implements the contract in `runtime-runner.interface.ts` as a constant Effect service
 * provided below, dispatched by `RuntimeRunnerRegistry.execute(runnerKind, …)`.
 */

import { createModuleContext, effectHostProvider } from "@deployer/nest-effect";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";
import { TraefikService } from "@deployer/shared/core/modules/traefik/services/traefik.service";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";

import { DockerRuntimeRunner } from "./docker/docker-runtime-runner.service";
import { RunnerEnvPort, RunnerTraefikPort } from "./runners.ports";
import { RuntimeRunnerRegistry } from "./runtime-runner-registry.service";
import { SwarmComposeRealizer } from "./swarm/swarm-compose-realizer.service";
import { SwarmRuntimeRunner } from "./swarm/swarm-runtime-runner.service";

export class RunnersDomainModule extends createModuleContext({
    // `EnvModule` is imported EXPLICITLY: `SwarmRuntimeRunnerService` injects
    // `EnvService` to resolve the PLATFORM OVERLAY name it attaches every
    // workload to — the attachment that makes a deployment reachable through
    // the ingress. `EnvModule` is not global, so a missing import here is a
    // runtime DI failure rather than a compile error (caught by
    // `app.graph.spec.ts`, which compiles this module graph).
    imports: [CoreDockerModule, TraefikCoreModule, ConfigurationCoreModule, SwarmCoreModule, EnvModule],
    providers: [
        // The host is the one place this module starts Effect work off a request; it owns the runtime injection.
        effectHostProvider(),
        // The runners are constant Effect services; the ports, the docker engine and the cluster are read from the context.
        { provide: RunnerTraefikPort, useExisting: TraefikService },
        { provide: RunnerEnvPort, useExisting: EnvService },
        { provide: DockerRuntimeRunner, useClass: DockerRuntimeRunner.live },
        { provide: SwarmRuntimeRunner, useClass: SwarmRuntimeRunner.live },
        { provide: RuntimeRunnerRegistry, useClass: RuntimeRunnerRegistry.live },
        { provide: SwarmComposeRealizer, useClass: SwarmComposeRealizer.live },
    ],
    exports: [RuntimeRunnerRegistry],
}) {}
