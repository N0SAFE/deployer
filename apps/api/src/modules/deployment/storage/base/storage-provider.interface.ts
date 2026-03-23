import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import type { DeploymentStoragePolicy } from "./storage-policy.schema";

export const deploymentStorageTypeSchema = z.enum(["local", "s3", "nfs", "volume"]);
export type DeploymentStorageType = z.infer<typeof deploymentStorageTypeSchema>;

export const deploymentStorageUpdateStrategySchema = z.enum([
    "auto_redeploy",
    "manual_update_button",
]);
export type DeploymentStorageUpdateStrategy = z.infer<typeof deploymentStorageUpdateStrategySchema>;

export const deploymentStorageBindingSchema = z.object({
    storageType: deploymentStorageTypeSchema,
    autoRedeployOnUpdate: z.boolean(),
    updateStrategy: deploymentStorageUpdateStrategySchema,
    mountPath: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
});
export type DeploymentStorageBinding = z.infer<typeof deploymentStorageBindingSchema>;

export interface DeploymentStorageProvider {
    readonly storageType: DeploymentStorageType;
    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ): Promise<DeploymentStorageBinding | null>;
}
