import { BadRequestException, Injectable } from "@nestjs/common";
import { BuildpackRuntimeRunnerService } from "./buildpack/buildpack-runtime-runner.service";
import { DockerComposeRuntimeRunnerService } from "./docker-compose/docker-compose-runtime-runner.service";
import { DockerRuntimeRunnerService } from "./docker/docker-runtime-runner.service";
import { DockerfileRuntimeRunnerService } from "./dockerfile/dockerfile-runtime-runner.service";
import { NixpacksRuntimeRunnerService } from "./nixpacks/nixpacks-runtime-runner.service";
import { RailpackRuntimeRunnerService } from "./railpack/railpack-runtime-runner.service";
import type { RuntimeExecutionInput, RuntimeExecutionResult } from "./runtime-runner.interface";

@Injectable()
export class RuntimeRunnerRegistryService {
    constructor(
        private readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService,
        private readonly dockerfileRuntimeRunnerService?: DockerfileRuntimeRunnerService,
        private readonly dockerComposeRuntimeRunnerService?: DockerComposeRuntimeRunnerService,
        private readonly nixpacksRuntimeRunnerService?: NixpacksRuntimeRunnerService,
        private readonly buildpackRuntimeRunnerService?: BuildpackRuntimeRunnerService,
        private readonly railpackRuntimeRunnerService?: RailpackRuntimeRunnerService,
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
        ].filter((runner) => runner !== undefined);

        const selectedRunner = runners.find((runner) => runner.runnerType === normalizedRunner);

        if (selectedRunner) {
            return selectedRunner.executeRuntime(input);
        }

        throw new BadRequestException(`Unsupported runtime runner '${normalizedRunner}'`);
    }
}
