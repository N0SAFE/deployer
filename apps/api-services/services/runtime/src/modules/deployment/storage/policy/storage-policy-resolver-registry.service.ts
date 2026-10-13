import { Injectable } from "@nestjs/common";
import type {
    DeploymentStoragePolicyResolver,
    ResolveDeploymentStoragePolicyInput,
} from "../base/storage-policy-resolver.interface";
import type { DeploymentStoragePolicy } from "../base/storage-policy.schema";

@Injectable()
export class StoragePolicyResolverRegistryService {
    private readonly orderedResolvers: DeploymentStoragePolicyResolver[];

    constructor(resolvers: DeploymentStoragePolicyResolver[]) {
        this.orderedResolvers = [...resolvers].sort(
            (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
        );
    }

    resolveServiceStorageConfig(
        input: ResolveDeploymentStoragePolicyInput,
    ): DeploymentStoragePolicy | undefined {
        for (const resolver of this.orderedResolvers) {
            const resolved = resolver.resolve(input);
            if (resolved) {
                return resolved;
            }
        }

        return undefined;
    }
}
