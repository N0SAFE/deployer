import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import { deploymentStorageTypeSchema, type DeploymentStorageType } from "./storage-provider.interface";
import {
    deploymentStoragePolicySchema,
    type DeploymentStoragePolicy,
} from "./storage-policy.schema";



const storageEnvelopeSchema = z
    .object({
        customData: z.record(z.string(), z.unknown()).optional(),
    })
    .optional();

function asStorageConfigRecord(value: unknown): DeploymentStoragePolicy | undefined {
    // Zod rejects non-objects and malformed shapes — no manual guards needed.
    const parsed = deploymentStoragePolicySchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

function mergeStorageConfig(
    serviceStorageConfig: DeploymentStoragePolicy | undefined,
    triggerStorageConfig: DeploymentStoragePolicy | undefined,
): DeploymentStoragePolicy | undefined {
    if (!serviceStorageConfig && !triggerStorageConfig) {
        return undefined;
    }

    const mergeNamedSection = (section: "local" | "s3" | "nfs" | "volume") => {
        // Sections are Zod-validated object schemas — no runtime shape checks needed.
        const serviceRecord = serviceStorageConfig?.[section];
        const triggerRecord = triggerStorageConfig?.[section];

        if (!serviceRecord && !triggerRecord) {
            return undefined;
        }

        return {
            ...(serviceRecord ?? {}),
            ...(triggerRecord ?? {}),
        };
    };

    const merged = {
        ...(serviceStorageConfig ?? {}),
        ...(triggerStorageConfig ?? {}),
        ...(mergeNamedSection("local") ? { local: mergeNamedSection("local") } : {}),
        ...(mergeNamedSection("s3") ? { s3: mergeNamedSection("s3") } : {}),
        ...(mergeNamedSection("nfs") ? { nfs: mergeNamedSection("nfs") } : {}),
        ...(mergeNamedSection("volume") ? { volume: mergeNamedSection("volume") } : {}),
    };

    return merged;
}

/** Raw storage hint carried in trigger customData — only `type` is required. */
const rawStorageHintSchema = z.object({ type: z.string().min(1) }).passthrough();

function extractRawStorageType(input: DeploymentTriggerInput): string | undefined {
    const parsedEnvelope = storageEnvelopeSchema.safeParse(input.source);
    if (!parsedEnvelope.success) {
        return undefined;
    }

    // Shape validation through Zod — never manual record guards.
    const parsedStorage = rawStorageHintSchema.safeParse(parsedEnvelope.data?.customData?.storage);
    return parsedStorage.success ? parsedStorage.data.type : undefined;
}

export function extractStorageConfig(
    input: DeploymentTriggerInput,
    serviceStorageConfig?: DeploymentStoragePolicy,
): DeploymentStoragePolicy | undefined {
    const normalizedServiceStorageConfig = asStorageConfigRecord(serviceStorageConfig);
    const parsed = storageEnvelopeSchema.safeParse(input.source);
    if (!parsed.success || !parsed.data?.customData) {
        return normalizedServiceStorageConfig;
    }

    const rawStorage = parsed.data.customData.storage;
    const normalizedTriggerStorageConfig = asStorageConfigRecord(rawStorage);

    return mergeStorageConfig(normalizedServiceStorageConfig, normalizedTriggerStorageConfig);
}

export function resolveRequestedStorageType(
    input: DeploymentTriggerInput,
    serviceStorageConfig?: DeploymentStoragePolicy,
): string {
    const rawStorageType = extractRawStorageType(input);
    if (rawStorageType) {
        const resolvedRawType = deploymentStorageTypeSchema.safeParse(rawStorageType);
        if (!resolvedRawType.success) {
            return rawStorageType;
        }
    }

    const storageConfig = extractStorageConfig(input, serviceStorageConfig);
    if (!storageConfig) {
        return "local";
    }

    const parsed = deploymentStoragePolicySchema.safeParse(storageConfig);
    if (!parsed.success || !parsed.data.type) {
        return "local";
    }

    const resolvedType = deploymentStorageTypeSchema.safeParse(parsed.data.type);
    if (!resolvedType.success) {
        return parsed.data.type;
    }

    return resolvedType.data;
}

export function resolveAutoRedeployOnUpdate(storageConfig: DeploymentStoragePolicy | undefined): boolean {
    const parsed = deploymentStoragePolicySchema.safeParse(storageConfig);
    return parsed.success ? Boolean(parsed.data.autoRedeployOnUpdate) : false;
}

export function resolveUpdateStrategy(autoRedeployOnUpdate: boolean): "auto_redeploy" | "manual_update_button" {
    return autoRedeployOnUpdate ? "auto_redeploy" : "manual_update_button";
}

export function resolveMountPath(storageConfig: DeploymentStoragePolicy | undefined): string {
    const parsed = deploymentStoragePolicySchema.safeParse(storageConfig);
    return parsed.success && parsed.data.mountPath ? parsed.data.mountPath : "/workspace/storage";
}
