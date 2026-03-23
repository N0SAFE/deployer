import { Injectable } from "@nestjs/common";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
    type DeploymentStorageProvider,
} from "../base/storage-provider.interface";
import type { DeploymentStoragePolicy } from "../base/storage-policy.schema";
import {
    extractStorageConfig,
    resolveAutoRedeployOnUpdate,
    resolveMountPath,
    resolveUpdateStrategy,
} from "../base/storage-provider.utils";

const localStorageConfigSchema = z
    .object({
        type: z.literal("local").optional(),
        local: z
            .object({
                rootPath: z.string().min(1).optional(),
                watchPath: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

@Injectable()
export class LocalStorageProviderService implements DeploymentStorageProvider {
    readonly storageType = "local" as const;

    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ): Promise<DeploymentStorageBinding | null> {
        const storageConfig = extractStorageConfig(input, serviceStorageConfig);
        const parsed = localStorageConfigSchema.safeParse(storageConfig ?? {});

        if (!parsed.success) {
            return Promise.resolve(null);
        }

        const autoRedeployOnUpdate = resolveAutoRedeployOnUpdate(storageConfig);
        const rootPath = this.resolveLocalPath(parsed.data.local?.rootPath, "./storage/local");
        const watchPath = this.resolveLocalPath(parsed.data.local?.watchPath, rootPath);

        return Promise.resolve(
            deploymentStorageBindingSchema.parse({
                storageType: "local",
                autoRedeployOnUpdate,
                updateStrategy: resolveUpdateStrategy(autoRedeployOnUpdate),
                mountPath: resolveMountPath(storageConfig),
                metadata: {
                    rootPath,
                    watchPath,
                },
            }),
        );
    }

    private resolveLocalPath(candidate: string | undefined, fallback: string): string {
        if (!candidate) {
            return fallback;
        }

        const normalized = candidate.trim();
        if (!normalized || normalized.includes("\u0000")) {
            return fallback;
        }

        return normalized;
    }
}
