import { RuntimeInvalid } from "../../../core/runtime.errors";
import { nixpacksRunnerOptionsSchema } from "../base/runner-option-policies.schema";
import type { RuntimeExecutionInput } from "../runtime-runner.interface";

/** Resolves the nixpacks runner options and fills what the docker runner needs; throws `RuntimeInvalid` when they do not hold. */
export function prepareNixpacksExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput {
    const parsedOptions = nixpacksRunnerOptionsSchema.safeParse({
        runner: "nixpacks",
        ...(input.runtimeRunnerOptions ?? {}),
    });
    if (!parsedOptions.success) {
        throw new RuntimeInvalid({ reason: "Nixpacks runner options are invalid for runner type 'nixpacks'" });
    }
    const resolvedCpuShares =
        parsedOptions.data.nixpacks?.cpuShares ?? parsedOptions.data.cpuShares;

    if (!input.artifact.containerImage && !input.deployment.deploymentContainerImage) {
        throw new RuntimeInvalid({ reason: "Nixpacks runner requires a prepared runtime image" });
    }

    return {
        ...input,
        deployment: {
            ...input.deployment,
            cpuShares: resolvedCpuShares ?? input.deployment.cpuShares ?? 1,
        },
    };
}
