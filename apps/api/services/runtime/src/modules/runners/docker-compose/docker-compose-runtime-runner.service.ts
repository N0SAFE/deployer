import { RuntimeInvalid } from "../../../core/runtime.errors";
import { dockerComposeRunnerOptionsSchema } from "../base/runner-option-policies.schema";

import type { RuntimeExecutionInput } from "../runtime-runner.interface";

/** Resolves the docker_compose runner options and fills what the docker runner needs; throws `RuntimeInvalid` when they do not hold. */
export function prepareDockerComposeExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
    const parsedOptions = dockerComposeRunnerOptionsSchema.safeParse({
        runner: "docker_compose",
        ...(input.runtimeRunnerOptions ?? {}),
    });
    if (!parsedOptions.success) {
        throw new RuntimeInvalid({ reason: "Docker Compose runner options are invalid for runner type 'docker_compose'" });
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
