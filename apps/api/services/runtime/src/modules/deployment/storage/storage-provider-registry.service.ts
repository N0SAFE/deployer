import { Context, Effect } from "effect";

import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import { RuntimeInvalid } from "../../../core/runtime.errors";

import { resolveRequestedStorageType } from "./base/storage-provider.utils";
import { localStorageProvider } from "./local/local-storage-provider.service";
import { nfsStorageProvider } from "./nfs/nfs-storage-provider.service";
import { s3StorageProvider } from "./s3/s3-storage-provider.service";
import { volumeStorageProvider } from "./volume/volume-storage-provider.service";

import type { DeploymentStoragePolicy } from "./base/storage-policy.schema";
import type { DeploymentStorageProvider } from "./base/storage-provider.interface";
import type { DeploymentStorageBinding } from "./base/storage-provider.interface";

/** Picks the provider for the requested storage type and asks it for the binding; an unknown type or an unresolvable config is `RuntimeInvalid`. */
export type StorageProviderRegistryShape = {
    readonly resolveStorageBinding: (
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ) => Effect.Effect<DeploymentStorageBinding, RuntimeInvalid>;
};

export function makeStorageProviderRegistry(
    providers: readonly DeploymentStorageProvider[],
): StorageProviderRegistryShape {
    const providersByType = new Map(providers.map((provider) => [provider.storageType.toLowerCase(), provider]));

    return {
        resolveStorageBinding: (input, serviceStorageConfig) =>
            Effect.gen(function* () {
                const storageType = resolveRequestedStorageType(input, serviceStorageConfig);
                const provider = providersByType.get(storageType);

                if (!provider) {
                    return yield* Effect.fail(
                        new RuntimeInvalid({ reason: `Unsupported storage provider '${storageType}'. Supported types: ${Array.from(providersByType.keys()).join(", ")}` }),
                    );
                }

                const binding = yield* provider.resolveStorageBinding(input, serviceStorageConfig);
                if (!binding) {
                    return yield* Effect.fail(
                        new RuntimeInvalid({ reason: `Unable to resolve storage binding for provider '${storageType}'` }),
                    );
                }

                return binding;
            }),
    };
}

/** The provider set is fixed, so `live` is a constant the module provides with `useValue`. */
export class StorageProviderRegistry extends Context.Service<StorageProviderRegistry, StorageProviderRegistryShape>()(
    "runtime/StorageProviderRegistry",
) {
    static readonly live = makeStorageProviderRegistry([
        localStorageProvider,
        s3StorageProvider,
        nfsStorageProvider,
        volumeStorageProvider,
    ]);
}
