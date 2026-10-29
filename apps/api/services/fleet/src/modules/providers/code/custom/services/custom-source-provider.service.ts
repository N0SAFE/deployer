import { Context, Effect } from "effect";
import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import z from "zod/v4";
import { customSourceCheckoutContextSchema } from "../../../base/source-provider.interface";
import type { RuntimeRunnerOptions } from "../../../base/runtime-runner-options.schema";
import { resolveRuntimeRunnerKind } from "../../../base/runtime-runner-options.schema";
import { runtimeRunnerOptionsSchema } from "../../../base/runtime-runner-options.schema";
import { attemptSync } from "@/core/effects";
import { FleetInvalid } from "@/core/fleet.errors";
import type { CodeProvider } from "../../shared/code-provider.interface";

const customSourceContextSchema = z.object({
    sourceType: z.literal("custom"),
    customData: z
        .object({
            containerImage: z.string().min(1),
            containerName: z.string().min(1).optional(),
            runtimeRunner: z.string().min(1).optional(),
            networkMode: z.string().min(1).optional(),
            cpuShares: z.number().positive().optional(),
            memoryLimitBytes: z.number().positive().optional(),
            healthCheckMaxRetries: z.number().int().positive().optional(),
            healthCheckRetryIntervalMs: z.number().int().positive().optional(),
            runtimeRunnerOptions: runtimeRunnerOptionsSchema.optional(),
        })
        .loose(),
});

function buildRuntimeRunnerOptionsFallback(input: {
    runtimeRunnerOptions?: RuntimeRunnerOptions;
    runtimeRunner?: string;
    containerName?: string;
    networkMode?: string;
    cpuShares?: number;
    memoryLimitBytes?: number;
    healthCheckMaxRetries?: number;
    healthCheckRetryIntervalMs?: number;
}): RuntimeRunnerOptions | null {
    if (input.runtimeRunnerOptions) {
        return input.runtimeRunnerOptions;
    }

    const runner = resolveRuntimeRunnerKind(input.runtimeRunner);
    const options: Record<string, unknown> = {
        runner,
        ...(input.containerName ? { containerName: input.containerName } : {}),
        ...(input.networkMode ? { networkMode: input.networkMode } : {}),
        ...(typeof input.cpuShares === "number" ? { cpuShares: input.cpuShares } : {}),
        ...(typeof input.memoryLimitBytes === "number" ? { memoryLimitBytes: input.memoryLimitBytes } : {}),
        ...(typeof input.healthCheckMaxRetries === "number"
            ? { healthCheckMaxRetries: input.healthCheckMaxRetries }
            : {}),
        ...(typeof input.healthCheckRetryIntervalMs === "number"
            ? { healthCheckRetryIntervalMs: input.healthCheckRetryIntervalMs }
            : {}),
    };

    const parsed = runtimeRunnerOptionsSchema.safeParse(options);
    return parsed.success ? parsed.data : null;
}

/** The provider for a ready-made container image: nothing to fetch, the trigger names the image. */
function makeCustomSourceProviderService() {
    return {
        resolveSourceCheckout: (input: DeploymentTriggerInput) =>
            Effect.gen(function* () {
                if (input.source.sourceType !== "custom") return null;

                const parsed = customSourceContextSchema.safeParse(input.source);
                if (!parsed.success) {
                    return yield* new FleetInvalid({ reason: "Custom/manual source requires source.customData.containerImage" });
                }

                const details = parsed.data.customData;
                const runtimeRunnerOptions = buildRuntimeRunnerOptionsFallback({
                    runtimeRunnerOptions: details.runtimeRunnerOptions,
                    runtimeRunner: details.runtimeRunner,
                    containerName: details.containerName,
                    networkMode: details.networkMode,
                    cpuShares: details.cpuShares,
                    memoryLimitBytes: details.memoryLimitBytes,
                    healthCheckMaxRetries: details.healthCheckMaxRetries,
                    healthCheckRetryIntervalMs: details.healthCheckRetryIntervalMs,
                });

                return yield* attemptSync(() =>
                    customSourceCheckoutContextSchema.parse({
                        provider: "custom",
                        containerImage: details.containerImage,
                        ...(details.containerName ? { containerName: details.containerName } : {}),
                        ...(details.runtimeRunner ? { runtimeRunner: details.runtimeRunner } : {}),
                        ...(details.networkMode ? { networkMode: details.networkMode } : {}),
                        ...(typeof details.cpuShares === "number" ? { cpuShares: details.cpuShares } : {}),
                        ...(typeof details.memoryLimitBytes === "number"
                            ? { memoryLimitBytes: details.memoryLimitBytes }
                            : {}),
                        ...(typeof details.healthCheckMaxRetries === "number"
                            ? { healthCheckMaxRetries: details.healthCheckMaxRetries }
                            : {}),
                        ...(typeof details.healthCheckRetryIntervalMs === "number"
                            ? { healthCheckRetryIntervalMs: details.healthCheckRetryIntervalMs }
                            : {}),
                        ...(runtimeRunnerOptions ? { runtimeRunnerOptions } : {}),
                    }),
                );
            }),
    } satisfies CodeProvider;
}

export type CustomSourceProviderServiceShape = ReturnType<typeof makeCustomSourceProviderService>;

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CustomSourceProviderService extends Context.Service<CustomSourceProviderService, CustomSourceProviderServiceShape>()(
    "fleet/CustomSourceProviderService",
) {
    /** Needs nothing from the context, so this is a constant the module provides with `useValue`. */
    static readonly live: CustomSourceProviderServiceShape = makeCustomSourceProviderService();
}
