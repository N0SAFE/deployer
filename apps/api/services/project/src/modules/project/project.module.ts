import { CoreEventStreamPoolService } from "@deployer/nest-events";
import { createModuleContext } from "@deployer/nest-effect";

import { CoreEventStreamPool } from "@project/core/ports/core-event-stream-pool.port";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { RuntimeConfigurationAccessorService } from "@deployer/shared/core/modules/configuration/services/runtime-configuration-accessor.service";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { ProjectDomainRepository } from "@deployer/shared/core/modules/domain/repositories/project-domain.repository";
import { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { CoreEventSync } from "@project/core/ports/core-event-sync.port";
import { DnsProvider } from "@project/core/ports/dns-provider.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import { DatabasePort } from "@project/core/database/database.port";
import { DnsProviderGateway } from "@/modules/network/dns-provider.gateway";

import { ProjectController } from "./controllers/project.controller";
import { ApiKeyStore, ApiKeyStoreImpl } from "./repositories/api-key.repository";
import {
	ProjectStore,
	ProjectStoreImpl,
} from "./repositories/project.repository";
import {
	WebhookStore,
	WebhookStoreImpl,
} from "./repositories/webhook.repository";
import { ApiKeyService, ApiKeyServiceImpl } from "./services/api-key.service";
import { ProjectEventAdapter } from "./services/project-event-adapter";
import { ProjectEventService } from "./services/project-event.service";
import {
	ProjectNetworkService,
	ProjectNetworkServiceImpl,
} from "./services/project-network.service";
import { ProjectService, ProjectServiceImpl } from "./services/project.service";
import { WebhookService, WebhookServiceImpl } from "./services/webhook.service";

/**
 * Projects: the aggregate an operator creates first — its collaborators,
 * environments and settings, plus its DNS-backed network view.
 *
 * Shared core services stay as they are; each one is exposed to the Effect layer
 * through a port so the services above can `yield*` them. The module's Effect
 * context is derived from these providers by `createModuleContext`.
 */
export class ProjectDomainModule extends createModuleContext({
	imports: [DatabaseModule, ConfigurationCoreModule, EventsModule, CoreDomainModule],
	controllers: [ProjectController],
	providers: [
		{ provide: DnsProvider, useExisting: DnsProviderGateway },
		{ provide: ProjectDomainRepo, useExisting: ProjectDomainRepository },
		{
			provide: RuntimeConfigurationAccessor,
			useExisting: RuntimeConfigurationAccessorService,
		},
		{ provide: CoreEventSync, useExisting: CoreEventSyncService },
		{ provide: ProjectStore, useClass: ProjectStoreImpl },
		{ provide: ApiKeyStore, useClass: ApiKeyStoreImpl },
		{ provide: WebhookStore, useClass: WebhookStoreImpl },
		ProjectEventAdapter,
		DnsProviderGateway,
		{ provide: ProjectService, useClass: ProjectServiceImpl },
		{ provide: ProjectNetworkService, useClass: ProjectNetworkServiceImpl },
		{ provide: WebhookService, useClass: WebhookServiceImpl },
		{ provide: ApiKeyService, useClass: ApiKeyServiceImpl },
			{ provide: CoreEventStreamPool, useExisting: CoreEventStreamPoolService },
	],
	exports: [
		ProjectService,
		ProjectNetworkService,
		WebhookService,
		ApiKeyService,
		DnsProviderGateway,
	],
}, DatabasePort, ProjectEventService) {}

// ── `ProjectDomainModule`, NOT `ProjectModule` ─────────────────────────────────
// `app.module.ts` imports this by the `DomainModule` name, and every sibling
// service already uses that suffix for its domain module
// (`HealthDomainModule`, `UserDomainModule`, `DeploymentDomainModule`, ...).
// The mismatch was not a style issue — it failed at boot:
//
//   SyntaxError: Export named 'ProjectDomainModule' not found in module
//   '/app/apps/.../modules/project/project.module.ts'
//
// so this service could never start, which is why it alone stayed unready while
// the other four turned healthy.
//
// The doc described the rename; the `export` keyword was never added, so the
// class stayed module-private and `import { ProjectDomainModule }` kept throwing.
