import { deploymentStoragePolicySchema } from "../base/storage-policy.schema";

import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from "../base/storage-policy-resolver.interface";

export const runtimeConfigurationStoragePolicyResolver: DeploymentStoragePolicyResolver = {
    name: "runtime-configuration-storage",
    priority: 300,

    resolve(input: ResolveDeploymentStoragePolicyInput) {
        const parsedStoragePolicy = deploymentStoragePolicySchema.safeParse(
            input.runtimeConfiguration.service.storage,
        );
        return parsedStoragePolicy.success ? parsedStoragePolicy.data : undefined;
    }
};
