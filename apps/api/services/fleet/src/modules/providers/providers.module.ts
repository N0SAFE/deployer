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
import { createModuleContext } from "@deployer/nest-effect";
import { CorePlatformIngressModule } from "@deployer/shared/core/modules/platform-ingress/platform-ingress.module";
import { IngressLanesService } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";
import { EdgeProviderRegistry } from "@deployer/shared/core/modules/edge/edge-provider.registry";
import { GlobalDatabaseModule } from "@deployer/shared/core/modules/database/global/global-database.module";
import { GitHubModule } from "@deployer/shared/core/modules/git/github/github.module";
import { CoreReachabilityModule } from "@deployer/shared/core/modules/reachability/core-reachability.module";
import { GitModule } from "@deployer/shared/core/modules/git/index";
import { DeploymentCoreModule } from "@deployer/shared/core/modules/deployment/deployment-core.module";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { CodeProvider } from "./code/shared/code-provider.interface";
import { CodeProviderRegistryService } from "./code/shared/code-provider-registry.service";
import { GithubSourceProviderService } from "./code/github/services/github-source-provider.service";
import { GitlabSourceProviderService } from "./code/gitlab/services/gitlab-source-provider.service";
import { UploadSourceProviderService } from "./code/upload/services/upload-source-provider.service";
import { UploadBundleRegistryService } from "./code/upload/services/upload-bundle-registry.service";
import { CustomSourceProviderService } from "./code/custom/services/custom-source-provider.service";
import { DnsProviderRegistryService } from "./dns/shared/dns-provider-registry.service";
import { DnsProvidersStore } from "./dns/shared/repositories/dns-providers.repository";
import { CloudflareAppService } from "./dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "./dns/cloudflare/services/cloudflare-tunnel.service";
import { CloudflareDnsProviderService } from "./dns/cloudflare/services/cloudflare-dns-provider.service";
import { DatabasePort } from "@/core/database/database.port";
import { FleetDb } from "@/core/database/fleet-db";
import { EdgeProviders } from "@/core/ports/edge-providers.port";
import { IngressLanes } from "@/core/ports/ingress-lanes.port";
import { TunnelEdge } from "@/core/ports/tunnel-edge.port";
import { CloudflareTunnelEdgeProvider } from "./edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider";
import { CoreEdgeModule } from "@deployer/shared/core/modules/edge/edge.module";
// `GithubWebhookDispatchService` injects `DomainRoutingService`, which
// `CoreDomainModule` owns — without this import the module cannot be constructed.
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { EnvModule } from "@deployer/shared/config/env/env.module";
import { GitHubAppsController } from "./code/github/controllers/github-account.controller";
import { GitlabAppsController } from "./code/gitlab/controllers/gitlab-account.controller";
import { GithubWebhooksController } from "./code/github/controllers/github.webhooks.controller";
import { DnsProvidersController } from "./dns/shared/controllers/dns-providers.controller";
import { CloudflareController } from "./dns/cloudflare/controllers/cloudflare.controller";
// GitHub webhook / preview stack (absorbed from the former modules/github)
import { GithubWebhookDispatchService } from "./code/github/services/github-webhook-dispatch.service";
import { DeploymentTriggerGateway } from "./code/github/services/deployment-trigger.gateway";
import { GithubDeploymentRuleService } from "./code/github/services/github-deployment-rule.service";
import { WebhookIdempotencyService } from "./code/github/services/webhook-idempotency.service";
import { PreviewProvisioningService } from "./code/github/services/preview-provisioning.service";
import { PreviewTtlCleanupService } from "./code/github/services/preview-ttl-cleanup.service";
import { GithubAppsRepository } from "./code/github/repositories/github-apps.repository";
import { GitlabAppsRepository } from "./code/gitlab/repositories/gitlab-apps.repository";
import { GithubDeploymentRulesRepository } from "@deployer/shared/core/modules/git/github/repositories/github-deployment-rules.repository";
import { PreviewEnvironmentRepository } from "./code/github/repositories/preview-environment.repository";
import { PreviewLifecycleEventService } from "./code/github/events/preview-lifecycle-event.service";

export class ProvidersModule extends createModuleContext({
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
        CoreDomainModule,
        CorePlatformIngressModule,
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
        // DNS providers — Effect services over the fleet database and two shared platform services.
        // Each is a constant (`useValue`); the 15 s state cache lives in `CloudflareAppService.live`.
        { provide: FleetDb, useValue: FleetDb.live },
        { provide: IngressLanes, useExisting: IngressLanesService },
        { provide: EdgeProviders, useExisting: EdgeProviderRegistry },
        { provide: TunnelEdge, useExisting: CloudflareTunnelEdgeProvider },
        { provide: DnsProvidersStore, useValue: DnsProvidersStore.live },
        { provide: CloudflareAppService, useValue: CloudflareAppService.live },
        { provide: CloudflareTunnelService, useValue: CloudflareTunnelService.live },
        { provide: CloudflareDnsProviderService, useValue: CloudflareDnsProviderService.live },
        // A second DNS provider is one more entry in the registry's `Effect.all`, not a change here.
        { provide: DnsProviderRegistryService, useValue: DnsProviderRegistryService.live },
        // Edge providers — register themselves into the core EdgeProviderRegistry
        CloudflareTunnelEdgeProvider,
        // GitHub webhook / preview stack
        GithubAppsRepository,
        GitlabAppsRepository,
        PreviewEnvironmentRepository,
        GithubDeploymentRulesRepository,
        GithubDeploymentRuleService,
        GithubWebhookDispatchService,
        DeploymentTriggerGateway,
        PreviewProvisioningService,
        PreviewTtlCleanupService,
        WebhookIdempotencyService,
        PreviewLifecycleEventService,
    ],
    exports: [
        CodeProviderRegistryService,
        UploadBundleRegistryService,
        GithubWebhookDispatchService,
        PreviewProvisioningService,
        PreviewLifecycleEventService,
    ],
}, DatabasePort) {}
