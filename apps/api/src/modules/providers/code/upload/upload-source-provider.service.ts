import { BadRequestException, Injectable } from "@nestjs/common";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import type {
    DeploymentSourceCheckoutContext,
} from "../../base/source-provider.interface";
import type { RuntimeRunnerOptions } from "../../base/runtime-runner-options.schema";
import { resolveRuntimeRunnerKind } from "../../base/runtime-runner-options.schema";
import { runtimeRunnerOptionsSchema } from "../../base/runtime-runner-options.schema";
import {
    uploadSourceCheckoutContextSchema,
} from "../../base/source-provider.interface";
import { UploadBundleRegistryService } from "./upload-bundle-registry.service";
import { CodeProvider } from "../code-provider.interface";

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

@Injectable()
export class UploadSourceProviderService extends CodeProvider {
    readonly sourceType = "upload";

    constructor(private readonly uploadBundleRegistryService: UploadBundleRegistryService) {
        super();
    }

    resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null> {
        if (!this.matchesSourceType(input)) {
            return Promise.resolve(null);
        }

        if (input.source.sourceType !== "upload") {
            return Promise.resolve(null);
        }

        const parsed = uploadSourceContextSchema.safeParse(input.source);
        if (!parsed.success) {
            throw new BadRequestException("Upload source requires valid source with customData.uploadId");
        }

        const { customData, fileName, fileSize } = parsed.data;
        const registryRecord = customData.uploadPath
            ? null
            : this.uploadBundleRegistryService.findByUploadId(customData.uploadId);

        if (!customData.uploadPath && !registryRecord) {
            throw new BadRequestException(
                `Upload bundle with id '${customData.uploadId}' was not found. Upload the archive first via /deployments/upload-bundle.`,
            );
        }

        const resolvedUploadPath = customData.uploadPath ?? registryRecord?.uploadPath;
        const resolvedFileName = fileName ?? registryRecord?.fileName;
        const resolvedFileSize = typeof fileSize === "number" ? fileSize : registryRecord?.fileSize;

        if (!resolvedUploadPath) {
            throw new BadRequestException(
                `Upload source with id '${customData.uploadId}' is missing a resolved upload path`,
            );
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

        return Promise.resolve(uploadSourceCheckoutContextSchema.parse({
            provider: "upload",
            uploadId: customData.uploadId,
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
        }));
    }
}