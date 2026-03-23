import { BadRequestException, Injectable } from "@nestjs/common";
import { DelegatedRuntimeRunnerBase } from "../base/delegated-runtime-runner.base";
import { buildpackRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import { DockerRuntimeRunnerService } from "../docker/docker-runtime-runner.service";
import type { DeploymentRuntimeRunnerType, RuntimeExecutionInput } from "../runtime-runner.interface";

@Injectable()
export class BuildpackRuntimeRunnerService extends DelegatedRuntimeRunnerBase {
    readonly runnerType: DeploymentRuntimeRunnerType = "buildpack";

    constructor(protected readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService) {
        super();
    }

    protected prepareExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
        const parsedOptions = buildpackRunnerOptionsSchema.safeParse(input.runtimeRunnerOptions ?? {});
        if (!parsedOptions.success) {
            throw new BadRequestException("Buildpack runner options are invalid for runner type 'buildpack'");
        }
        const resolvedMemoryLimitBytes =
            parsedOptions.data.buildpack?.memoryLimitBytes ?? parsedOptions.data.memoryLimitBytes;
        const resolvedBuilder = parsedOptions.data.buildpack?.builder;
        const resolvedStartupCommand = parsedOptions.data.startupCommand;
        const executorLabels: Record<string, string> = resolvedBuilder
            ? { "deployer.runner.buildpack_builder": resolvedBuilder }
            : {};

        if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
            throw new BadRequestException(
                "Buildpack runner requires a prepared runtime image",
            );
        }

        return {
            ...input,
            deployment: {
                ...input.deployment,
                memoryLimitBytes:
                    resolvedMemoryLimitBytes ??
                    input.deployment.memoryLimitBytes ??
                    512 * 1024 * 1024,
            },
            executorOptions: {
                ...(input.executorOptions ?? {}),
                labels: executorLabels,
                ...(resolvedStartupCommand ? { startupCommand: resolvedStartupCommand } : {}),
            },
        };
    }
}
