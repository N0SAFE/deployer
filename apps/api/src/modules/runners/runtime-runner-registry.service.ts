import { BadRequestException, Injectable } from "@nestjs/common";
import { BuildpackRuntimeRunnerService } from "./buildpack/buildpack-runtime-runner.service";
import { DockerComposeRuntimeRunnerService } from "./docker-compose/docker-compose-runtime-runner.service";
import { DockerRuntimeRunnerService } from "./docker/docker-runtime-runner.service";
import { DockerfileRuntimeRunnerService } from "./dockerfile/dockerfile-runtime-runner.service";
import { NixpacksRuntimeRunnerService } from "./nixpacks/nixpacks-runtime-runner.service";
import { RailpackRuntimeRunnerService } from "./railpack/railpack-runtime-runner.service";
import { SwarmRuntimeRunnerService } from "./swarm/swarm-runtime-runner.service";
import type { RuntimeExecutionInput, RuntimeExecutionResult } from "./runtime-runner.interface";

@Injectable()
export class RuntimeRunnerRegistryService {
    /**
     * All seven runners are REQUIRED. They are always supplied by
     * `RunnersModule.providers`, so marking any of them optional would only
     * make the type lie about what is injected and force a pointless
     * `undefined` filter below. Worse, it would turn "a runner was removed from
     * the module" from a boot-time DI failure into a runtime
     * `BadRequestException` on the first deploy that happens to use it.
     */
    constructor(
        private readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService,
        private readonly dockerfileRuntimeRunnerService: DockerfileRuntimeRunnerService,
        private readonly dockerComposeRuntimeRunnerService: DockerComposeRuntimeRunnerService,
        private readonly nixpacksRuntimeRunnerService: NixpacksRuntimeRunnerService,
        private readonly buildpackRuntimeRunnerService: BuildpackRuntimeRunnerService,
        private readonly railpackRuntimeRunnerService: RailpackRuntimeRunnerService,
        private readonly swarmRuntimeRunnerService: SwarmRuntimeRunnerService,
    ) {}

    async execute(
        runnerKind: string | null | undefined,
        input: RuntimeExecutionInput,
    ): Promise<RuntimeExecutionResult> {
        const normalizedRunner = (runnerKind ?? "docker").toLowerCase();
        const runners = [
            this.dockerRuntimeRunnerService,
            this.dockerfileRuntimeRunnerService,
            this.dockerComposeRuntimeRunnerService,
            this.nixpacksRuntimeRunnerService,
            this.buildpackRuntimeRunnerService,
            this.railpackRuntimeRunnerService,
            this.swarmRuntimeRunnerService,
        ];

        const selectedRunner = runners.find((runner) => runner.runnerType === normalizedRunner);

        if (!selectedRunner) {
            // Every injected runner is listed above, so this means the caller
            // asked for a kind no runner implements — not that one is missing.
            throw new BadRequestException(`Unsupported runtime runner '${normalizedRunner}'`);
        }

        return selectedRunner.executeRuntime(input);
    }
}
