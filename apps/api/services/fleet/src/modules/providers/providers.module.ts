/**
 * Providers Module — unified top-level module for ALL provider types.
 *
 * Structure:
 *   providers/
 *     base/          shared schema re-exports + source-provider contract (across ALL types)
 *     middleware/    webhook route guards (github challenge, ...), run first by the webhook handler
 *     code/          CODE providers (github, upload, custom, gitlab, docker-hub)
 *       shared/      code-provider.interface.ts (the contract every provider answers) + registry
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
import { createModuleContext, EffectHost } from "@deployer/nest-effect";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { GlobalDatabaseModule } from "@deployer/shared/core/modules/database/global/global-database.module";
import { DeploymentCoreModule } from "@deployer/shared/core/modules/deployment/deployment-core.module";
import { PreviewCleanupPolicyService } from "@deployer/shared/core/modules/deployment/services/preview-cleanup-policy.service";
import { PreviewNamingService } from "@deployer/shared/core/modules/deployment/services/preview-naming.service";
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { DomainRoutingService } from "@deployer/shared/core/modules/domain/services/domain-routing.service";
import { EdgeProviderRegistry } from "@deployer/shared/core/modules/edge/edge-provider.registry";
import { CoreEdgeModule } from "@deployer/shared/core/modules/edge/edge.module";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { GitHubModule } from "@deployer/shared/core/modules/git/github/github.module";
import { GithubDeploymentRulesRepository } from "@deployer/shared/core/modules/git/github/repositories/github-deployment-rules.repository";
import { GitHubService } from "@deployer/shared/core/modules/git/github/services/github.service";
import { GitModule, GitService } from "@deployer/shared/core/modules/git/index";
import { CorePlatformIngressModule } from "@deployer/shared/core/modules/platform-ingress/platform-ingress.module";
import { IngressLanesService } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";
import { CoreReachabilityModule } from "@deployer/shared/core/modules/reachability/core-reachability.module";
import { PublicAccessPointService } from "@deployer/shared/core/modules/reachability/services/public-access-point.service";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { ServiceClient } from "@deployer/shared/server";

import { DatabasePort } from "@/core/database/database.port";
import { FleetDb } from "@/core/database/fleet-db";
import { DomainRouting } from "@/core/ports/domain-routing.port";
import { EdgeProviders } from "@/core/ports/edge-providers.port";
import { Git } from "@/core/ports/git.port";
import { GithubDeploymentRules } from "@/core/ports/github-deployment-rules.port";
import { GitHub } from "@/core/ports/github.port";
import { IngressLanes } from "@/core/ports/ingress-lanes.port";
import { PlatformEnv } from "@/core/ports/platform-env.port";
import { PreviewCleanupPolicy, PreviewNaming } from "@/core/ports/preview-policy.port";
import { PublicAccessPoint } from "@/core/ports/public-access-point.port";
import { TunnelEdge } from "@/core/ports/tunnel-edge.port";

import { CustomSourceProviderService } from "./code/custom/services/custom-source-provider.service";
import { GitHubAppsController } from "./code/github/controllers/github-account.controller";
import { GithubSourceProviderService } from "./code/github/services/github-source-provider.service";
import { CodeProviderRegistryService } from "./code/shared/code-provider-registry.service";
import { GitlabSourceProviderService } from "./code/gitlab/services/gitlab-source-provider.service";
import { UploadBundleRegistryService } from "./code/upload/services/upload-bundle-registry.service";
import { UploadSourceProviderService } from "./code/upload/services/upload-source-provider.service";
import { CloudflareController } from "./dns/cloudflare/controllers/cloudflare.controller";
import { CloudflareAppService } from "./dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "./dns/cloudflare/services/cloudflare-tunnel.service";
import { DnsProviderRegistryService } from "./dns/shared/dns-provider-registry.service";
import { DnsProvidersStore } from "./dns/shared/repositories/dns-providers.repository";
import { CloudflareDnsProviderService } from "./dns/cloudflare/services/cloudflare-dns-provider.service";

import { SystemActorClients } from "@/core/ports/system-actor-clients.port";

import { CloudflareTunnelEdgeProvider } from "./edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider";

// `GithubWebhookDispatchService` injects `DomainRoutingService`, which
// `CoreDomainModule` owns — without this import the module cannot be constructed.

import { GitlabAppsController } from "./code/gitlab/controllers/gitlab-account.controller";
import { GithubWebhooksController } from "./code/github/controllers/github.webhooks.controller";
import { DnsProvidersController } from "./dns/shared/controllers/dns-providers.controller";
// GitHub webhook / preview stack (absorbed from the former modules/github)
import { GithubWebhookDispatchService } from "./code/github/services/github-webhook-dispatch.service";
import { DeploymentTriggerGateway } from "./code/github/services/deployment-trigger.gateway";
import { GithubDeploymentRuleService } from "./code/github/services/github-deployment-rule.service";
import { WebhookIdempotencyService } from "./code/github/services/webhook-idempotency.service";
import { PreviewProvisioningService } from "./code/github/services/preview-provisioning.service";
import { PREVIEW_TTL_CLEANUP, PreviewTtlCleanupService, startPreviewTtlCleanup } from "./code/github/services/preview-ttl-cleanup.service";
import { GithubAppsStore } from "./code/github/repositories/github-apps.repository";
import { GitlabAppsStore } from "./code/gitlab/repositories/gitlab-apps.repository";
import { PreviewEnvironmentStore } from "./code/github/repositories/preview-environment.repository";
import { PreviewLifecycleEventService, PreviewLifecycleEventServiceImpl } from "./code/github/events/preview-lifecycle-event.service";

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
        // Code providers — Effect services; the registry dispatches over the four by source type.
        { provide: Git, useExisting: GitService },
        { provide: UploadBundleRegistryService, useValue: UploadBundleRegistryService.live },
        { provide: GithubSourceProviderService, useValue: GithubSourceProviderService.live },
        { provide: GitlabSourceProviderService, useValue: GitlabSourceProviderService.live },
        { provide: UploadSourceProviderService, useValue: UploadSourceProviderService.live },
        { provide: CustomSourceProviderService, useValue: CustomSourceProviderService.live },
        { provide: CodeProviderRegistryService, useValue: CodeProviderRegistryService.live },
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
        // GitHub webhook / preview stack — stores and use cases are constants; the lifecycle bus is built over the stream pool.
        { provide: GithubAppsStore, useValue: GithubAppsStore.live },
        { provide: GitlabAppsStore, useValue: GitlabAppsStore.live },
        { provide: PreviewEnvironmentStore, useValue: PreviewEnvironmentStore.live },
        { provide: GithubDeploymentRules, useExisting: GithubDeploymentRulesRepository },
        { provide: GitHub, useExisting: GitHubService },
        { provide: PublicAccessPoint, useExisting: PublicAccessPointService },
        { provide: DomainRouting, useExisting: DomainRoutingService },
        { provide: PreviewNaming, useExisting: PreviewNamingService },
        { provide: PreviewCleanupPolicy, useExisting: PreviewCleanupPolicyService },
        { provide: SystemActorClients, useExisting: ServiceClient },
        { provide: PlatformEnv, useExisting: EnvService },
        { provide: GithubDeploymentRuleService, useValue: GithubDeploymentRuleService.live },
        { provide: GithubWebhookDispatchService, useValue: GithubWebhookDispatchService.live },
        { provide: DeploymentTriggerGateway, useValue: DeploymentTriggerGateway.live },
        { provide: PreviewProvisioningService, useValue: PreviewProvisioningService.live },
        { provide: PreviewTtlCleanupService, useValue: PreviewTtlCleanupService.live },
        { provide: WebhookIdempotencyService, useValue: WebhookIdempotencyService.live },
        {
            provide: PreviewLifecycleEventService,
            useFactory: (pool: CoreEventStreamPoolService) => new PreviewLifecycleEventServiceImpl(pool),
            inject: [CoreEventStreamPoolService],
        },
        // Schedules the expired-preview cleanup when the module is built; stopped with the application.
        { provide: PREVIEW_TTL_CLEANUP, useFactory: startPreviewTtlCleanup, inject: [EffectHost] },
    ],
    exports: [
        CodeProviderRegistryService,
        UploadBundleRegistryService,
        GithubWebhookDispatchService,
        PreviewProvisioningService,
        PreviewLifecycleEventService,
        // Consumed by `ReachabilityModule`'s `IngressEdgeService` and `PlatformModule`'s
        // `PlatformManagedWebService`; a module's scoped request context sees only what its
        // imports export.
        DnsProviderRegistryService,
        CloudflareTunnelService,
        CloudflareAppService,
        CloudflareDnsProviderService,
        DnsProvidersStore,
        FleetDb,
        // The registries themselves: `ReachabilityController` and `PlatformManagedWebController` read them back.
        IngressLanes,
        EdgeProviders,
    ],
}, DatabasePort) {}
