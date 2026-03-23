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

const s3StorageConfigSchema = z
    .object({
        type: z.literal("s3"),
        s3: z.object({
            bucket: z.string().min(1),
            region: z.string().min(1).optional(),
            endpoint: z.string().min(1).optional(),
            prefix: z.string().min(1).optional(),
        }),
    })
    .loose();

@Injectable()
export class S3StorageProviderService implements DeploymentStorageProvider {
    readonly storageType = "s3" as const;

    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ): Promise<DeploymentStorageBinding | null> {
        const storageConfig = extractStorageConfig(input, serviceStorageConfig);
        const parsed = s3StorageConfigSchema.safeParse(storageConfig);

        if (!parsed.success) {
            if (storageConfig?.type === "s3") {
                throw new BadRequestException("S3 storage requires storage.s3.bucket in sourceConfig.customData");
            }
            return Promise.resolve(null);
        }

        const autoRedeployOnUpdate = resolveAutoRedeployOnUpdate(storageConfig);

        return Promise.resolve(
            deploymentStorageBindingSchema.parse({
                storageType: "s3",
                autoRedeployOnUpdate,
                updateStrategy: resolveUpdateStrategy(autoRedeployOnUpdate),
                mountPath: resolveMountPath(storageConfig),
                metadata: {
                    bucket: parsed.data.s3.bucket,
                    region: parsed.data.s3.region ?? null,
                    endpoint: parsed.data.s3.endpoint ?? null,
                    prefix: parsed.data.s3.prefix ?? null,
                },
            }),
        );
    }
}
