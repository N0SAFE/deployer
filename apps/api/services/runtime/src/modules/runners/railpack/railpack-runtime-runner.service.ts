import { RuntimeInvalid } from "../../../core/runtime.errors";
import { railpackRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import type { RuntimeExecutionInput } from "../runtime-runner.interface";

/** Resolves the railpack runner options and fills what the docker runner needs; throws `RuntimeInvalid` when they do not hold. */
export function prepareRailpackExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
    const parsedOptions = railpackRunnerOptionsSchema.safeParse({
        runner: "railpack",
        ...(input.runtimeRunnerOptions ?? {}),
    });
    if (!parsedOptions.success) {
        throw new RuntimeInvalid({ reason: "Railpack runner options are invalid for runner type 'railpack'" });
    }
    const resolvedHealthCheckUrl =
        parsedOptions.data.railpack?.healthCheckUrl ?? parsedOptions.data.healthCheckUrl;
    const resolvedStartupCommand = parsedOptions.data.railpack?.startupCommand ?? parsedOptions.data.startupCommand;

    if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
        throw new RuntimeInvalid({ reason: "Railpack runner requires a prepared runtime image" });
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
