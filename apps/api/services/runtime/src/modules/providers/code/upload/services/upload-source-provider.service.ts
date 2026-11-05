import { Context, Effect } from "effect";
import z from "zod/v4";

import {
    resolveRuntimeRunnerKind,
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
} from "@deployer/contracts-entities";
import { uploadSourceCheckoutContextSchema } from "@deployer/contracts-entities";

import { RuntimeInvalid } from "../../../../../core/runtime.errors";
import { matchesSourceType, type CodeProviderShape } from "../../shared/code-provider.interface";

import type { UploadBundleRegistryShape } from "./upload-bundle-registry.service";

const uploadSourceContextSchema = z.object({
    sourceType: z.literal("upload"),
    uploadId: z.string().min(1),
    uploadPath: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    fileSize: z.number().nonnegative().optional(),
    customData: z
        .object({
            uploadId: z.string().min(1),
            uploadPath: z.string().min(1).optional(),
            containerImage: z.string().min(1).optional(),
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

export class UploadSourceProvider extends Context.Service<UploadSourceProvider, CodeProviderShape>()(
    "runtime/UploadSourceProvider",
) {}

/** The upload provider over the bundle registry. */
export function makeUploadSourceProvider(ports: { readonly bundles: UploadBundleRegistryShape }): CodeProviderShape {
    const sourceType = "upload";
    return {
        sourceType,
        resolveSourceCheckout: (input) =>
            Effect.gen(function* () {
                if (!matchesSourceType(sourceType, input) || input.source.sourceType !== "upload") {
                    return null;
                }

                const parsed = uploadSourceContextSchema.safeParse(input.source);
                if (!parsed.success) {
                    return yield* new RuntimeInvalid({ reason: "Upload source requires valid source with customData.uploadId" });
                }

                // `uploadId`/`uploadPath` are declared BOTH at the root of the source and
                // inside `customData`, and the provider used to read only the nested copies.
                // A caller that followed the root-level schema — which is the documented
                // shape this source type validates — was then told its bundle
                // "was not found", naming a field it had in fact supplied. Prefer the
                // nested value (the more specific one) and fall back to the root.
                const { customData, fileName, fileSize } = parsed.data;
                const uploadId = customData.uploadId;
                const declaredUploadPath = customData.uploadPath ?? parsed.data.uploadPath;
                const registryRecord = declaredUploadPath ? null : yield* ports.bundles.findByUploadId(uploadId);

                if (!declaredUploadPath && !registryRecord) {
                    return yield* new RuntimeInvalid({ reason: `Upload bundle with id '${uploadId}' was not found. Upload the archive first via /deployments/upload-bundle.` });
                }

                const resolvedUploadPath = declaredUploadPath ?? registryRecord?.uploadPath;
                const resolvedFileName = fileName ?? registryRecord?.fileName;
                const resolvedFileSize = typeof fileSize === "number" ? fileSize : registryRecord?.fileSize;

                if (!resolvedUploadPath) {
                    return yield* new RuntimeInvalid({ reason: `Upload source with id '${uploadId}' is missing a resolved upload path` });
                }

                const runtimeRunnerOptions = buildRuntimeRunnerOptionsFallback({
                    runtimeRunnerOptions: customData.runtimeRunnerOptions,
                    runtimeRunner: customData.runtimeRunner,
                    containerName: customData.containerName,
                    networkMode: customData.networkMode,
                    cpuShares: customData.cpuShares,
                    memoryLimitBytes: customData.memoryLimitBytes,
                    healthCheckMaxRetries: customData.healthCheckMaxRetries,
                    healthCheckRetryIntervalMs: customData.healthCheckRetryIntervalMs,
                });

                return uploadSourceCheckoutContextSchema.parse({
                    provider: "upload",
                    uploadId,
                    uploadPath: resolvedUploadPath,
                    ...(resolvedFileName ? { fileName: resolvedFileName } : {}),
                    ...(typeof resolvedFileSize === "number" ? { fileSize: resolvedFileSize } : {}),
                    // Backward compatibility only: runtime/build concerns should be sent via
                    // trigger input execution config (execution.builder / execution.runner / execution.healthChecks).
                    ...(customData.containerImage ? { containerImage: customData.containerImage } : {}),
                    ...(customData.containerName ? { containerName: customData.containerName } : {}),
                    ...(customData.runtimeRunner ? { runtimeRunner: customData.runtimeRunner } : {}),
                    ...(customData.networkMode ? { networkMode: customData.networkMode } : {}),
                    ...(typeof customData.cpuShares === "number" ? { cpuShares: customData.cpuShares } : {}),
                    ...(typeof customData.memoryLimitBytes === "number"
                        ? { memoryLimitBytes: customData.memoryLimitBytes }
                        : {}),
                    ...(typeof customData.healthCheckMaxRetries === "number"
                        ? { healthCheckMaxRetries: customData.healthCheckMaxRetries }
                        : {}),
                    ...(typeof customData.healthCheckRetryIntervalMs === "number"
                        ? { healthCheckRetryIntervalMs: customData.healthCheckRetryIntervalMs }
                        : {}),
                    ...(runtimeRunnerOptions ? { runtimeRunnerOptions } : {}),
                });
            }),
    };
}
