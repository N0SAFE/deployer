/**
 * Providers Module — unified top-level module for ALL provider types.
 *
 * Structure:
 *   providers/
 *     base/          shared schema re-exports + source-provider contract (across ALL types)
 *     middleware/    ORPC middleware (webhook guards: github challenge, ...)
 *     code/          CODE providers (github, upload, custom, gitlab, docker-hub)
 *       shared/      code-provider.interface.ts (abstract class = DI token) + registry
 *       github/      controllers (github-account, github.webhooks) + services + repositories + events
 *       custom/      services/custom-source-provider.service.ts
 *       upload/      services/upload-source-provider.service.ts + upload-bundle-registry.service.ts
 *     dns/           DNS providers (cloudflare, route53, ...)
 *       shared/      dns-provider.interface.ts + registry + controllers/dns-providers.controller.ts (generic CRUD)
 *       cloudflare/  controllers/cloudflare.controller.ts + services/*
 */
import { Module } from "@nestjs/common";
import { GlobalDatabaseModule } from "@/core/modules/database/global/global-database.module";
import { GitHubModule } from "@/core/modules/git/github/github.module";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { GitModule } from "@/core/modules/git";
import { DeploymentCoreModule } from "@/core/modules/deployment/deployment-core.module";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { CodeProvider } from "./code/shared/code-provider.interface";
import { CodeProviderRegistryService } from "./code/shared/code-provider-registry.service";
import { GithubSourceProviderService } from "./code/github/services/github-source-provider.service";
import { GitlabSourceProviderService } from "./code/gitlab/services/gitlab-source-provider.service";
import { UploadSourceProviderService } from "./code/upload/services/upload-source-provider.service";
import { UploadBundleRegistryService } from "./code/upload/services/upload-bundle-registry.service";
import { CustomSourceProviderService } from "./code/custom/services/custom-source-provider.service";
import { DnsProviderRegistryService } from "./dns/shared/dns-provider-registry.service";
import { DnsProvidersRepository } from "./dns/shared/repositories/dns-providers.repository";
import { CloudflareAppService } from "./dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "./dns/cloudflare/services/cloudflare-tunnel.service";
import { CloudflareDnsProviderService } from "./dns/cloudflare/services/cloudflare-dns-provider.service";
import { GitHubAppsController } from "./code/github/controllers/github-account.controller";
import { GitlabAppsController } from "./code/gitlab/controllers/gitlab-account.controller";
import { GithubWebhooksController } from "./code/github/controllers/github.webhooks.controller";
import { DnsProvidersController } from "./dns/shared/controllers/dns-providers.controller";
import { CloudflareController } from "./dns/cloudflare/controllers/cloudflare.controller";
// GitHub webhook / preview stack (absorbed from the former modules/github)
import { GithubWebhookDispatchService } from "./code/github/services/github-webhook-dispatch.service";
import { GithubDeploymentRuleService } from "./code/github/services/github-deployment-rule.service";
import { WebhookIdempotencyService } from "./code/github/services/webhook-idempotency.service";
import { PreviewProvisioningService } from "./code/github/services/preview-provisioning.service";
import { PreviewTtlCleanupService } from "./code/github/services/preview-ttl-cleanup.service";
import { GithubAppsRepository } from "./code/github/repositories/github-apps.repository";
import { GitlabAppsRepository } from "./code/gitlab/repositories/gitlab-apps.repository";
import { GithubDeploymentRulesRepository } from "@/core/modules/git/github/repositories/github-deployment-rules.repository";
import { PreviewEnvironmentRepository } from "./code/github/repositories/preview-environment.repository";
import { PreviewLifecycleEventService } from "./code/github/events/preview-lifecycle-event.service";

@Module({
    imports: [
        GlobalDatabaseModule,
        GitHubModule,
        GitModule,
        CoreReachabilityModule,
        DeploymentCoreModule,
        ConfigurationCoreModule,
        EventsModule,
        TraefikCoreModule,
    ],
    controllers: [
        GitHubAppsController,
        GitlabAppsController,
        GithubWebhooksController,
        DnsProvidersController,
        CloudflareController,
    ],
    providers: [
        // Code providers — multi-bound via the abstract class token
        GithubSourceProviderService,
        GitlabSourceProviderService,
        UploadSourceProviderService,
        CustomSourceProviderService,
        UploadBundleRegistryService,
        {
            provide: CodeProvider,
            useFactory: (
                github: GithubSourceProviderService,
                gitlab: GitlabSourceProviderService,
                upload: UploadSourceProviderService,
                custom: CustomSourceProviderService,
            ) => [github, gitlab, upload, custom],
            inject: [GithubSourceProviderService, GitlabSourceProviderService, UploadSourceProviderService, CustomSourceProviderService],
        },
        {
            provide: CodeProviderRegistryService,
            useFactory: (providers: CodeProvider[]) => new CodeProviderRegistryService(providers),
            inject: [CodeProvider],
        },
        // DNS providers — app model + registry + tunnel/zone services
        DnsProvidersRepository,
        CloudflareAppService,
        CloudflareTunnelService,
        CloudflareDnsProviderService,
        {
            provide: DnsProviderRegistryService,
            useFactory: (cloudflare: CloudflareDnsProviderService) =>
                new DnsProviderRegistryService([cloudflare]),
            inject: [CloudflareDnsProviderService],
        },
        // GitHub webhook / preview stack
        GithubAppsRepository,
        GitlabAppsRepository,
        PreviewEnvironmentRepository,
        GithubDeploymentRulesRepository,
        GithubDeploymentRuleService,
        GithubWebhookDispatchService,
        PreviewProvisioningService,
        PreviewTtlCleanupService,
        WebhookIdempotencyService,
        PreviewLifecycleEventService,
    ],
    exports: [
        CodeProviderRegistryService,
        UploadBundleRegistryService,
        DnsProviderRegistryService,
        CloudflareAppService,
        CloudflareTunnelService,
        CloudflareDnsProviderService,
        GithubWebhookDispatchService,
        PreviewProvisioningService,
        PreviewLifecycleEventService,
    ],
})
export class ProvidersModule {}
