import { Injectable } from "@nestjs/common";

import { deploymentStoragePolicySchema } from "../base/storage-policy.schema";

import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from "../base/storage-policy-resolver.interface";

@Injectable()
export class RuntimeConfigurationStoragePolicyResolverService implements DeploymentStoragePolicyResolver {
    readonly name = "runtime-configuration-storage";
    readonly priority = 300;

    resolve(input: ResolveDeploymentStoragePolicyInput) {
        const parsedStoragePolicy = deploymentStoragePolicySchema.safeParse(
            input.runtimeConfiguration.service.storage,
        );
        return parsedStoragePolicy.success ? parsedStoragePolicy.data : undefined;
    }
}
