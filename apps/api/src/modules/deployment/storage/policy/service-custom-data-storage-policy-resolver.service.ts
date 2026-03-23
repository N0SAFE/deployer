import { Injectable } from "@nestjs/common";
import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from "../base/storage-policy-resolver.interface";
import { deploymentStoragePolicySchema } from "../base/storage-policy.schema";

@Injectable()
export class ServiceCustomDataStoragePolicyResolverService implements DeploymentStoragePolicyResolver {
    readonly name = "service-custom-data-storage";
    readonly priority = 200;

    resolve(input: ResolveDeploymentStoragePolicyInput) {
        const metadata = input.serviceMetadata;
        if (!metadata || typeof metadata !== "object") {
            return undefined;
        }

        const customData = metadata.customData;
        if (!customData || typeof customData !== "object" || Array.isArray(customData)) {
            return undefined;
        }

        const storage = (customData as Record<string, unknown>).storage;
        if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
            return undefined;
        }

        const parsedStoragePolicy = deploymentStoragePolicySchema.safeParse(storage);
        return parsedStoragePolicy.success ? parsedStoragePolicy.data : undefined;
    }
}
