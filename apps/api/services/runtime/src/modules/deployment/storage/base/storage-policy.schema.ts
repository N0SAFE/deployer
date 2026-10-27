import z from "zod/v4";
import { deploymentStorageTypeSchema } from "./storage-provider.interface";

const deploymentStoragePolicyBaseSchema = z
    .object({
        autoRedeployOnUpdate: z.boolean().optional(),
        mountPath: z.string().min(1).optional(),
    })
    .loose();

const localStoragePolicyConfigSchema = z
    .object({
        local: z
            .object({
                rootPath: z.string().min(1).optional(),
                watchPath: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

const s3StoragePolicyConfigSchema = z
    .object({
        s3: z
            .object({
                bucket: z.string().min(1).optional(),
                region: z.string().min(1).optional(),
                endpoint: z.string().min(1).optional(),
                prefix: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

const nfsStoragePolicyConfigSchema = z
    .object({
        nfs: z
            .object({
                server: z.string().min(1).optional(),
                exportPath: z.string().min(1).optional(),
                readOnly: z.boolean().optional(),
            })
            .optional(),
    })
    .loose();

const volumeStoragePolicyConfigSchema = z
    .object({
        volume: z
            .object({
                volumeName: z.string().min(1).optional(),
                driver: z.string().min(1).optional(),
            })
            .optional(),
    })
    .loose();

const localDeploymentStoragePolicySchema = deploymentStoragePolicyBaseSchema
    .extend({
        type: z.literal("local"),
    })
    .merge(localStoragePolicyConfigSchema);

const s3DeploymentStoragePolicySchema = deploymentStoragePolicyBaseSchema
    .extend({
        type: z.literal("s3"),
    })
    .merge(s3StoragePolicyConfigSchema);

const nfsDeploymentStoragePolicySchema = deploymentStoragePolicyBaseSchema
    .extend({
        type: z.literal("nfs"),
    })
    .merge(nfsStoragePolicyConfigSchema);

const volumeDeploymentStoragePolicySchema = deploymentStoragePolicyBaseSchema
    .extend({
        type: z.literal("volume"),
    })
    .merge(volumeStoragePolicyConfigSchema);

export const deploymentStoragePolicyLooseSchema = z.discriminatedUnion("type", [
    localDeploymentStoragePolicySchema,
    s3DeploymentStoragePolicySchema,
    nfsDeploymentStoragePolicySchema,
    volumeDeploymentStoragePolicySchema,
]);

const deploymentStoragePolicyWithoutTypeSchema = z
    .object({
        type: z.undefined().optional(),
    })
    .merge(deploymentStoragePolicyBaseSchema)
    .merge(localStoragePolicyConfigSchema)
    .merge(s3StoragePolicyConfigSchema)
    .merge(nfsStoragePolicyConfigSchema)
    .merge(volumeStoragePolicyConfigSchema);

export const deploymentStoragePolicySchema = z.union([
    deploymentStoragePolicyLooseSchema,
    deploymentStoragePolicyWithoutTypeSchema,
]);

export const deploymentStorageTypeInputSchema = z
    .object({
        type: z.string().min(1),
    })
    .loose();

export const deploymentStorageTypeKnownSchema = deploymentStorageTypeSchema;

export type DeploymentStoragePolicy = z.infer<typeof deploymentStoragePolicySchema>;
