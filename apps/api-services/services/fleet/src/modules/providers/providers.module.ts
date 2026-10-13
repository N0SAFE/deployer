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
 *     edge/          EDGE providers that need an account (the public lane's plugins)
 *       cloudflare-tunnel/  registers itself into the core EdgeProviderRegistry
 *                           (the account-free `direct` edge is built into core/modules/edge)
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
import { DnsProviderRegistryService } from "./dns/shared/dns-provider-registry.service";
import { DnsProvidersRepository } from "./dns/shared/repositories/dns-providers.repository";
import { CloudflareAppService } from "./dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "./dns/cloudflare/services/cloudflare-tunnel.service";
import { CloudflareDnsProviderService } from "./dns/cloudflare/services/cloudflare-dns-provider.service";
import { CloudflareTunnelEdgeProvider } from "./edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider";
import { CoreEdgeModule } from "@/core/modules/edge/edge.module";
import { CoreDomainModule } from "@/core/modules/domain/domain.module";
import { EnvModule } from "@/config/env/env.module";
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
        CoreEdgeModule,
        // ── WHY THIS SERVICE MUST IMPORT A MODULE THAT IS @Global ───────────────
        // `DomainRoutingService` is consumed by the GitHub preview-webhook and
        // provisioning services. It is provided by `CoreDomainModule`, which is
        // `@Global()` — but a global module still has to be imported ONCE for its
        // providers to be registered. The monolith got it transitively through
        // `ProjectModule`, which this service does not have.
        //
        // Without this the boot fails naming `DomainRoutingService` and
        // `ProvidersDomainModule`, neither of which is the actual problem.
        CoreDomainModule,
        EnvModule,
    ],
    controllers: [
        GitHubAppsController,
        GitlabAppsController,
        GithubWebhooksController,
        DnsProvidersController,
        CloudflareController,
    ],
    providers: [
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
        // Edge providers — register themselves into the core EdgeProviderRegistry
        CloudflareTunnelEdgeProvider,
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
        DnsProviderRegistryService,
        CloudflareAppService,
        CloudflareTunnelService,
        CloudflareDnsProviderService,
        GithubWebhookDispatchService,
        PreviewProvisioningService,
        PreviewLifecycleEventService,
    ],
})
export class ProvidersDomainModule {}
