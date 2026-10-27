import { BadRequestException, Injectable } from "@nestjs/common";
import { DelegatedRuntimeRunnerBase } from "../base/delegated-runtime-runner.base";
import { nixpacksRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import { DockerRuntimeRunnerService } from "../docker/docker-runtime-runner.service";
import type { DeploymentRuntimeRunnerType, RuntimeExecutionInput } from "../runtime-runner.interface";

@Injectable()
export class NixpacksRuntimeRunnerService extends DelegatedRuntimeRunnerBase {
    readonly runnerType: DeploymentRuntimeRunnerType = "nixpacks";

    constructor(protected readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService) {
        super();
    }

    protected prepareExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
        const parsedOptions = nixpacksRunnerOptionsSchema.safeParse({
            runner: "nixpacks",
            ...(input.runtimeRunnerOptions ?? {}),
        });
        if (!parsedOptions.success) {
            throw new BadRequestException("Nixpacks runner options are invalid for runner type 'nixpacks'");
        }
        const resolvedCpuShares =
            parsedOptions.data.nixpacks?.cpuShares ?? parsedOptions.data.cpuShares;

        if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
            throw new BadRequestException(
                "Nixpacks runner requires a prepared runtime image",
            );
        }

        return {
            ...input,
            deployment: {
                ...input.deployment,
                cpuShares: resolvedCpuShares ?? input.deployment.cpuShares ?? 1,
            },
        };
    }
}
