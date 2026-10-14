import { Injectable } from "@nestjs/common";
import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from "../base/storage-policy-resolver.interface";
import { deploymentStoragePolicySchema } from "../base/storage-policy.schema";
import { isRecord, isObjectLike } from "@repo/type-guards"

@Injectable()

/**
 * Resolves the deployment storage policy from the service's custom data
 * (when set via the service metadata). Uses runtime type guards from
 * @repo/type-guards in place of `as Record<string, unknown>` casts to
 * avoid the runtime lie.
 */
export class ServiceCustomDataStoragePolicyResolverService implements DeploymentStoragePolicyResolver {
    readonly name = "service-custom-data-storage";
    readonly priority = 200;

    resolve(input: ResolveDeploymentStoragePolicyInput) {
        const customData = input.serviceMetadata?.customData;
        if (!isRecord(customData)) {
            return undefined;
        }

        const storage = customData.storage;
        if (!isObjectLike(storage)) {
            return undefined;
        }

        const parsedStoragePolicy = deploymentStoragePolicySchema.safeParse(storage);
        return parsedStoragePolicy.success ? parsedStoragePolicy.data : undefined;
    }
}
