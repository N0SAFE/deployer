import { Injectable } from "@nestjs/common";
import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from "../base/storage-policy-resolver.interface";
import { deploymentStoragePolicySchema } from "../base/storage-policy.schema";

@Injectable()
export class ServiceTopLevelStoragePolicyResolverService implements DeploymentStoragePolicyResolver {
    readonly name = "service-top-level-storage";
    readonly priority = 100;

    resolve(input: ResolveDeploymentStoragePolicyInput) {
        const metadata = input.serviceMetadata;
        if (!metadata || typeof metadata !== "object") {
            return undefined;
        }

        const storage = metadata.storage;
        if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
            return undefined;
        }

        const parsedStoragePolicy = deploymentStoragePolicySchema.safeParse(storage);
        return parsedStoragePolicy.success ? parsedStoragePolicy.data : undefined;
    }
}
