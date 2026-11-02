import { Injectable } from "@nestjs/common";

import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import { RuntimeInvalid } from "../../../core/runtime.errors";

import { resolveRequestedStorageType } from "./base/storage-provider.utils";

import type { DeploymentStoragePolicy } from "./base/storage-policy.schema";
import type { DeploymentStorageProvider } from "./base/storage-provider.interface";
import type { DeploymentStorageBinding } from "./base/storage-provider.interface";

@Injectable()
export class StorageProviderRegistryService {
    private readonly providersByType: Map<string, DeploymentStorageProvider>;

    constructor(
        private readonly providers: DeploymentStorageProvider[],
    ) {
        this.providersByType = new Map(
            providers.map((provider) => [provider.storageType.toLowerCase(), provider]),
        );
    }

    async resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ): Promise<DeploymentStorageBinding> {
        const storageType = resolveRequestedStorageType(input, serviceStorageConfig);
        const provider = this.providersByType.get(storageType);

        if (!provider) {
            throw new RuntimeInvalid({ reason: `Unsupported storage provider '${storageType}'. Supported types: ${Array.from(this.providersByType.keys()).join(", ")}` });
        }

        const binding = await provider.resolveStorageBinding(input, serviceStorageConfig);
        if (!binding) {
            throw new RuntimeInvalid({ reason: `Unable to resolve storage binding for provider '${storageType}'` });
        }

        return binding;
    }
}
