import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { DEPLOYMENT_STORAGE_PROVIDERS } from "./base/storage-provider.token";
import type { DeploymentStorageProvider } from "./base/storage-provider.interface";
import { DEPLOYMENT_STORAGE_POLICY_RESOLVERS } from "./base/storage-policy-resolver.token";
import type { DeploymentStoragePolicyResolver } from "./base/storage-policy-resolver.interface";
import { LocalStorageProviderService } from "./local/local-storage-provider.service";
import { NfsStorageProviderService } from "./nfs/nfs-storage-provider.service";
import { ServiceCustomDataStoragePolicyResolverService } from "./policy/service-custom-data-storage-policy-resolver.service";
import { ServiceTopLevelStoragePolicyResolverService } from "./policy/service-top-level-storage-policy-resolver.service";
import { RuntimeConfigurationStoragePolicyResolverService } from "./policy/runtime-configuration-storage-policy-resolver.service";
import { StoragePolicyResolverRegistryService } from "./policy/storage-policy-resolver-registry.service";
import { S3StorageProviderService } from "./s3/s3-storage-provider.service";
import { StorageProviderRegistryService } from "./storage-provider-registry.service";
import { VolumeStorageProviderService } from "./volume/volume-storage-provider.service";

@Module({
    imports: [ConfigurationCoreModule],
    providers: [
        LocalStorageProviderService,
        S3StorageProviderService,
        NfsStorageProviderService,
        VolumeStorageProviderService,
        ServiceCustomDataStoragePolicyResolverService,
        ServiceTopLevelStoragePolicyResolverService,
        RuntimeConfigurationStoragePolicyResolverService,
        {
            provide: DEPLOYMENT_STORAGE_PROVIDERS,
            useFactory: (
                localStorageProviderService: LocalStorageProviderService,
                s3StorageProviderService: S3StorageProviderService,
                nfsStorageProviderService: NfsStorageProviderService,
                volumeStorageProviderService: VolumeStorageProviderService,
            ) => [
                localStorageProviderService,
                s3StorageProviderService,
                nfsStorageProviderService,
                volumeStorageProviderService,
            ],
            inject: [
                LocalStorageProviderService,
                S3StorageProviderService,
                NfsStorageProviderService,
                VolumeStorageProviderService,
            ],
        },
        {
            provide: StorageProviderRegistryService,
            useFactory: (providers: DeploymentStorageProvider[]) =>
                new StorageProviderRegistryService(providers),
            inject: [DEPLOYMENT_STORAGE_PROVIDERS],
        },
        {
            provide: DEPLOYMENT_STORAGE_POLICY_RESOLVERS,
            useFactory: (
                runtimeConfigurationStoragePolicyResolverService: RuntimeConfigurationStoragePolicyResolverService,
                serviceCustomDataStoragePolicyResolverService: ServiceCustomDataStoragePolicyResolverService,
                serviceTopLevelStoragePolicyResolverService: ServiceTopLevelStoragePolicyResolverService,
            ) => [
                runtimeConfigurationStoragePolicyResolverService,
                serviceCustomDataStoragePolicyResolverService,
                serviceTopLevelStoragePolicyResolverService,
            ],
            inject: [
                RuntimeConfigurationStoragePolicyResolverService,
                ServiceCustomDataStoragePolicyResolverService,
                ServiceTopLevelStoragePolicyResolverService,
            ],
        },
        {
            provide: StoragePolicyResolverRegistryService,
            useFactory: (resolvers: DeploymentStoragePolicyResolver[]) =>
                new StoragePolicyResolverRegistryService(resolvers),
            inject: [DEPLOYMENT_STORAGE_POLICY_RESOLVERS],
        },
    ],
    exports: [StorageProviderRegistryService, StoragePolicyResolverRegistryService],
})
export class DeploymentStorageProvidersModule {}
