import { BadRequestException, Injectable } from "@nestjs/common";
import { DelegatedRuntimeRunnerBase } from "../base/delegated-runtime-runner.base";
import { railpackRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import { DockerRuntimeRunnerService } from "../docker/docker-runtime-runner.service";
import type { DeploymentRuntimeRunnerType, RuntimeExecutionInput } from "../runtime-runner.interface";

@Injectable()
export class RailpackRuntimeRunnerService extends DelegatedRuntimeRunnerBase {
    readonly runnerType: DeploymentRuntimeRunnerType = "railpack";

    constructor(protected readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService) {
        super();
    }

    protected prepareExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
        const parsedOptions = railpackRunnerOptionsSchema.safeParse({
            runner: "railpack",
            ...(input.runtimeRunnerOptions ?? {}),
        });
        if (!parsedOptions.success) {
            throw new BadRequestException("Railpack runner options are invalid for runner type 'railpack'");
        }
        const resolvedHealthCheckUrl =
            parsedOptions.data.railpack?.healthCheckUrl ?? parsedOptions.data.healthCheckUrl;
        const resolvedStartupCommand = parsedOptions.data.railpack?.startupCommand ?? parsedOptions.data.startupCommand;

        if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
            throw new BadRequestException(
                "Railpack runner requires a prepared runtime image",
            );
        }

        return {
            ...input,
            deployment: {
                ...input.deployment,
                healthCheckUrl:
                    resolvedHealthCheckUrl ??
                    input.deployment.healthCheckUrl ??
                    `/internal/health/${input.deployment.serviceId}`,
            },
            executorOptions: {
                ...(input.executorOptions ?? {}),
                ...(resolvedStartupCommand ? { startupCommand: resolvedStartupCommand } : {}),
            },
        };
    }
}
