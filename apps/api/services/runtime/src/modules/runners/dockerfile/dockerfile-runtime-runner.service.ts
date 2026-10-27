import { BadRequestException, Injectable } from "@nestjs/common";
import { DelegatedRuntimeRunnerBase } from "../base/delegated-runtime-runner.base";
import { dockerfileRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import { DockerRuntimeRunnerService } from "../docker/docker-runtime-runner.service";
import type { DeploymentRuntimeRunnerType, RuntimeExecutionInput } from "../runtime-runner.interface";

@Injectable()
export class DockerfileRuntimeRunnerService extends DelegatedRuntimeRunnerBase {
    readonly runnerType: DeploymentRuntimeRunnerType = "dockerfile";

    constructor(protected readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService) {
        super();
    }

    protected prepareExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
        const parsedOptions = dockerfileRunnerOptionsSchema.safeParse({
            runner: "dockerfile",
            ...(input.runtimeRunnerOptions ?? {}),
        });
        if (!parsedOptions.success) {
            throw new BadRequestException("Dockerfile runner options are invalid for runner type 'dockerfile'");
        }
        const resolvedContainerName =
            parsedOptions.data.dockerfile?.containerName ?? parsedOptions.data.containerName;

        if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
            throw new BadRequestException(
                "Dockerfile runner requires a prepared container image from build stage",
            );
        }

        return {
            ...input,
            deployment: {
                ...input.deployment,
                deploymentContainerName:
                    resolvedContainerName ??
                    input.deployment.deploymentContainerName ??
                    `${input.deployment.serviceId.slice(0, 16)}-dockerfile-runtime`,
            },
        };
    }
}
