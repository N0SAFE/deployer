import { RuntimeInvalid } from "../../../core/runtime.errors";
import { buildpackRunnerOptionsSchema } from "../base/runner-option-policies.schema";

import type { RuntimeExecutionInput } from "../runtime-runner.interface";

/** Resolves the buildpack runner options and fills what the docker runner needs; throws `RuntimeInvalid` when they do not hold. */
export function prepareBuildpackExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
    const parsedOptions = buildpackRunnerOptionsSchema.safeParse({
        runner: "buildpack",
        ...(input.runtimeRunnerOptions ?? {}),
    });
    if (!parsedOptions.success) {
        throw new RuntimeInvalid({ reason: "Buildpack runner options are invalid for runner type 'buildpack'" });
    }
    const resolvedMemoryLimitBytes =
        parsedOptions.data.buildpack?.memoryLimitBytes ?? parsedOptions.data.memoryLimitBytes;
    const resolvedBuilder = parsedOptions.data.buildpack?.builder;
    const resolvedStartupCommand = parsedOptions.data.startupCommand;
    const executorLabels: Record<string, string> = resolvedBuilder
        ? { "deployer.runner.buildpack_builder": resolvedBuilder }
        : {};

    if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
        throw new RuntimeInvalid({ reason: "Buildpack runner requires a prepared runtime image" });
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
