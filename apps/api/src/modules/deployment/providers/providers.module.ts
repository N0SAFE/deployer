import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { GitModule } from "@/core/modules/git";
import { CustomSourceProviderService } from "./custom/custom-source-provider.service";
import { GithubSourceProviderService } from "./github/github-source-provider.service";
import { SourceProviderRegistryService } from "./source-provider-registry.service";
import { UploadSourceProviderService } from "./upload/upload-source-provider.service";
import { UploadBundleRegistryService } from "./upload/upload-bundle-registry.service";
import { DEPLOYMENT_SOURCE_PROVIDERS } from "./base/source-provider.token";
import type { DeploymentSourceProvider } from "./base/source-provider.interface";

@Module({
    imports: [GitModule, ConfigurationCoreModule],
    providers: [
        GithubSourceProviderService,
        UploadBundleRegistryService,
        UploadSourceProviderService,
        CustomSourceProviderService,
        {
            provide: DEPLOYMENT_SOURCE_PROVIDERS,
            useFactory: (
                githubSourceProviderService: GithubSourceProviderService,
                uploadSourceProviderService: UploadSourceProviderService,
                customSourceProviderService: CustomSourceProviderService,
            ) => [githubSourceProviderService, uploadSourceProviderService, customSourceProviderService],
            inject: [GithubSourceProviderService, UploadSourceProviderService, CustomSourceProviderService],
        },
        {
            provide: SourceProviderRegistryService,
            useFactory: (providers: DeploymentSourceProvider[]) =>
                new SourceProviderRegistryService(providers),
            inject: [DEPLOYMENT_SOURCE_PROVIDERS],
        },
    ],
    exports: [SourceProviderRegistryService, UploadBundleRegistryService],
})
export class DeploymentProvidersModule {}
