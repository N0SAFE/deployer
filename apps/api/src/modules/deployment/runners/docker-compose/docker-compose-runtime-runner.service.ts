import { BadRequestException, Injectable } from "@nestjs/common";
import { DelegatedRuntimeRunnerBase } from "../base/delegated-runtime-runner.base";
import { dockerComposeRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import { DockerRuntimeRunnerService } from "../docker/docker-runtime-runner.service";
import type { DeploymentRuntimeRunnerType, RuntimeExecutionInput } from "../runtime-runner.interface";

@Injectable()
export class DockerComposeRuntimeRunnerService extends DelegatedRuntimeRunnerBase {
    readonly runnerType: DeploymentRuntimeRunnerType = "docker_compose";

    constructor(protected readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService) {
        super();
    }

    protected prepareExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
        const parsedOptions = dockerComposeRunnerOptionsSchema.safeParse(input.runtimeRunnerOptions ?? {});
        if (!parsedOptions.success) {
            throw new BadRequestException("Docker Compose runner options are invalid for runner type 'docker_compose'");
        }
        const resolvedContainerName =
            parsedOptions.data.dockerCompose?.containerName ?? parsedOptions.data.containerName;
        const resolvedNetworkMode =
            parsedOptions.data.dockerCompose?.networkMode ?? parsedOptions.data.networkMode;
        const resolvedProfiles = parsedOptions.data.dockerCompose?.profiles;
        const resolvedStartupCommand = parsedOptions.data.startupCommand;
        const composeProfilesLabel =
            resolvedProfiles && resolvedProfiles.length > 0
                ? resolvedProfiles.join(",")
                : null;
        const executorLabels: Record<string, string> = composeProfilesLabel
            ? { "deployer.runner.compose_profiles": composeProfilesLabel }
            : {};

        return {
            ...input,
            deployment: {
                ...input.deployment,
                networkMode: resolvedNetworkMode ?? input.deployment.networkMode ?? "bridge",
                deploymentContainerName:
                    resolvedContainerName ??
                    input.deployment.deploymentContainerName ??
                    `${input.deployment.serviceId.slice(0, 16)}-compose-runtime`,
            },
            executorOptions: {
                ...(input.executorOptions ?? {}),
                labels: executorLabels,
                ...(resolvedStartupCommand ? { startupCommand: resolvedStartupCommand } : {}),
            },
        };
    }
}
