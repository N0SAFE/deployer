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
import { Module, type ClassProvider, type FactoryProvider } from "@nestjs/common";
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
import { DNS_PROVIDERS, DnsProviderRegistryService } from "./dns/shared/dns-provider-registry.service";
import type { DnsProvider } from "./dns/shared/dns-provider.interface";
import { DnsProvidersRepository } from "./dns/shared/repositories/dns-providers.repository";
import { CloudflareAppService } from "./dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "./dns/cloudflare/services/cloudflare-tunnel.service";
import { CloudflareDnsProviderService } from "./dns/cloudflare/services/cloudflare-dns-provider.service";
import { CloudflareTunnelEdgeProvider } from "./edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider";
import { CoreEdgeModule } from "@/core/modules/edge/edge.module";
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
        // DNS providers — app model + registry + tunnel/zone services
        DnsProvidersRepository,
        CloudflareAppService,
        CloudflareTunnelService,
        CloudflareDnsProviderService,
        // ── MULTI-TOKEN, SO A SECOND DNS PROVIDER IS ONE LINE ───────────────
        // This used to be a `useFactory` naming Cloudflare in both the body and
        // the `inject` list:
        //
        //   useFactory: (cloudflare) => new DnsProviderRegistryService([cloudflare]),
        //   inject: [CloudflareDnsProviderService],
        //
        // so adding Route53/Google DNS meant editing this module twice. The
        // registry was already a plain `Map` built from an array, and
        // `DNS_PROVIDERS` was already exported (and unused) — the seam existed and
        // was never connected.
        //
        // `multi: true` accumulates: a new provider adds ONE entry here and touches
        // nothing else. The registry still fails loudly for an unknown type, and the
        // contract enum still gates what the API accepts, so this widens
        // extensibility without widening the accepted surface.
        // ── ONE ARRAY, BUILT FROM A SINGLE TOKEN ────────────────────────────
        // This used to name Cloudflare in both the factory body and the `inject`
        // list, so a second DNS provider meant editing this module twice.
        //
        // `DNS_PROVIDERS` is now the multi-token and the registry receives the
        // collection, exactly like `CodeProvider` above. Adding Route53/Google DNS
        // becomes: implement `DnsProvider`, add it to this factory's return array
        // and its `inject` list — the registry, its dispatch methods, and every
        // caller stay untouched.
        //
        // ── WHY A FACTORY ARRAY AND NOT `multi: true` ───────────────────────
        // Nest's runtime honours `multi`, but `@nestjs/common@11.2.7` does not
        // declare it on `ValueProvider` / `FactoryProvider` / `Provider` at all
        // (verified in `interfaces/modules/provider.interface.d.ts`), so
        // `{ …, multi: true }` fails `tsc` with "Object literal may only specify
        // known properties". The factory array is the type-safe equivalent, and it
        // is the convention already established by `CodeProvider`. Do not "fix"
        // this to `multi: true` without first checking that the installed Nest types
        // gained the property.
        {
            provide: DNS_PROVIDERS,
            useFactory: (cloudflare: CloudflareDnsProviderService): DnsProvider[] => [cloudflare],
            inject: [CloudflareDnsProviderService],
        } satisfies FactoryProvider,
        {
            provide: DnsProviderRegistryService,
            useFactory: (
                providers: DnsProvider[],
                repository: DnsProvidersRepository,
            ) => new DnsProviderRegistryService(providers, repository),
            inject: [DNS_PROVIDERS, DnsProvidersRepository],
        } satisfies FactoryProvider,
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
        CodeProviderRegistryService,
        UploadBundleRegistryService,
        DnsProviderRegistryService,
        CloudflareAppService,
        CloudflareTunnelService,
        CloudflareDnsProviderService,
        GithubWebhookDispatchService,
        GithubAppsRepository,
        PreviewProvisioningService,
        PreviewLifecycleEventService,
    ],
})
export class ProvidersModule {}
