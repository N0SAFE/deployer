import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import type { ResolvedRuntimeConfiguration } from "@deployer/shared/core/modules/configuration/schemas/runtime-configuration.schema";
import type { DeploymentStoragePolicy } from "./storage-policy.schema";

export type ResolveDeploymentStoragePolicyInput = {
    serviceId: string;
    serviceMetadata: Record<string, unknown> | null | undefined;
    source: DeploymentTriggerInput["source"];
    runtimeConfiguration: ResolvedRuntimeConfiguration;
}

export type DeploymentStoragePolicyResolver = {
    readonly name: string;
    readonly priority?: number;
    resolve(input: ResolveDeploymentStoragePolicyInput): DeploymentStoragePolicy | undefined;
}
