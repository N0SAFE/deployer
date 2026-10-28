import { RuntimeInvalid } from "../../../core/runtime.errors";
import { dockerfileRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import type { RuntimeExecutionInput } from "../runtime-runner.interface";

/** Resolves the dockerfile runner options and fills what the docker runner needs; throws `RuntimeInvalid` when they do not hold. */
export function prepareDockerfileExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
    const parsedOptions = dockerfileRunnerOptionsSchema.safeParse({
        runner: "dockerfile",
        ...(input.runtimeRunnerOptions ?? {}),
    });
    if (!parsedOptions.success) {
        throw new RuntimeInvalid({ reason: "Dockerfile runner options are invalid for runner type 'dockerfile'" });
    }
    const resolvedContainerName =
        parsedOptions.data.dockerfile?.containerName ?? parsedOptions.data.containerName;

    if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
        throw new RuntimeInvalid({ reason: "Dockerfile runner requires a prepared container image from build stage" });
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
