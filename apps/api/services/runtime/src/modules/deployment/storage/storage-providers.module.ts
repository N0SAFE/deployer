import { createModuleContext } from "@deployer/nest-effect";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";

import { StoragePolicyResolverRegistry } from "./policy/storage-policy-resolver-registry.service";
import { StorageProviderRegistry } from "./storage-provider-registry.service";

/** The providers and policy resolvers are fixed constants held by the two registries, which are Effect services. */
export class DeploymentStorageProvidersModule extends createModuleContext({
    imports: [ConfigurationCoreModule],
    providers: [
        { provide: StorageProviderRegistry, useValue: StorageProviderRegistry.live },
        { provide: StoragePolicyResolverRegistry, useValue: StoragePolicyResolverRegistry.live },
    ],
    exports: [StorageProviderRegistry, StoragePolicyResolverRegistry],
}) {}
