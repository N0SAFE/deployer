import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type { ResolvedRuntimeConfiguration } from "@/core/modules/configuration/schemas/runtime-configuration.schema";
import type { DeploymentStoragePolicy } from "./storage-policy.schema";

export interface ResolveDeploymentStoragePolicyInput {
    serviceId: string;
    serviceMetadata: Record<string, unknown> | null | undefined;
    sourceConfig: DeploymentTriggerInput["sourceConfig"];
    runtimeConfiguration: ResolvedRuntimeConfiguration;
}

export interface DeploymentStoragePolicyResolver {
    readonly name: string;
    readonly priority?: number;
    resolve(input: ResolveDeploymentStoragePolicyInput): DeploymentStoragePolicy | undefined;
}
