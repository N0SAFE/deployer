import { BadRequestException, Injectable } from "@nestjs/common";
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

const volumeStorageConfigSchema = z
    .object({
        type: z.literal("volume"),
        volume: z.object({
            volumeName: z.string().min(1),
            driver: z.string().min(1).optional(),
        }),
    })
    .loose();

@Injectable()
export class VolumeStorageProviderService implements DeploymentStorageProvider {
    readonly storageType = "volume" as const;

    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ): Promise<DeploymentStorageBinding | null> {
        const storageConfig = extractStorageConfig(input, serviceStorageConfig);
        const parsed = volumeStorageConfigSchema.safeParse(storageConfig);

        if (!parsed.success) {
            if (storageConfig?.type === "volume") {
                throw new BadRequestException(
                    "Volume storage requires storage.volume.volumeName in sourceConfig.customData",
                );
            }
            return Promise.resolve(null);
        }

        const autoRedeployOnUpdate = resolveAutoRedeployOnUpdate(storageConfig);

        return Promise.resolve(
            deploymentStorageBindingSchema.parse({
                storageType: "volume",
                autoRedeployOnUpdate,
                updateStrategy: resolveUpdateStrategy(autoRedeployOnUpdate),
                mountPath: resolveMountPath(storageConfig),
                metadata: {
                    volumeName: parsed.data.volume.volumeName,
                    driver: parsed.data.volume.driver ?? "local",
                },
            }),
        );
    }
}
