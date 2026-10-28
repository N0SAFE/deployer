import { CoreEventStreamPoolService } from "@deployer/nest-effect/events";
import { createModuleContext } from "@deployer/nest-effect";

import { CoreEventStreamPool } from "@project/core/ports/core-event-stream-pool.port";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { RuntimeConfigurationAccessorService } from "@deployer/shared/core/modules/configuration/services/runtime-configuration-accessor.service";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { ProjectDomainRepository } from "@deployer/shared/core/modules/domain/repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "@deployer/shared/core/modules/domain/repositories/service-domain-mapping.repository";
import { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { ProjectAccessService } from "@deployer/shared/core/modules/project/services/project-access.service";
import { ProjectCoreModule } from "@deployer/shared/core/modules/project/project-core.module";
import { DatabasePort } from "@project/core/database/database.port";
import { CoreEventSync } from "@project/core/ports/core-event-sync.port";
import { DnsProvider } from "@project/core/ports/dns-provider.port";
import { ProjectAccess } from "@project/core/ports/project-access.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import { ServiceDomainMappingLookup } from "@project/core/ports/service-domain-mapping-lookup.port";
import { DnsProviderGateway } from "@/modules/network/dns-provider.gateway";
import { ProjectDomainModule } from "@/modules/project/project.module";

import { ServiceController } from "./controllers/service.controller";
import { ServiceStore } from "./repositories/service.repository";
import { ServiceEventAdapter } from "./services/service-event-adapter";
import { ServiceEventService } from "./services/service-event.service";
import { PreviewTopologyService } from "./services/preview-topology.service";
import { ServiceNetworkService } from "./services/service-network.service";
import { ServiceService } from "./services/service.service";

/**
 * Services: the deployable units inside a project, their hierarchy, their
 * dependency graph, their network config and their event stream.
 *
 * Shared core services stay Nest providers; each one is exposed to the Effect layer through a
 * port so the services can `yield*` them. The store and use cases are Layers (`ServiceLive`, see
 * `service.layers.ts`) built by the app's Effect runtime. `ProjectStore` comes
 * from `ProjectDomainModule` — a service lives inside a project, so the store is
 * read, never re-provided (two `useClass` providers would mean two instances).
 * The module's Effect context is derived from these providers by
 * `createModuleContext`.
 */
export class ServiceDomainModule extends createModuleContext({
	imports: [
		DatabaseModule,
		ProjectCoreModule,
		ConfigurationCoreModule,
		EventsModule,
		CoreDomainModule,
		ProjectDomainModule,
	],
	controllers: [ServiceController],
	providers: [
		{ provide: DnsProvider, useExisting: DnsProviderGateway },
		{ provide: ProjectAccess, useExisting: ProjectAccessService },
		{ provide: ProjectDomainRepo, useExisting: ProjectDomainRepository },
		{
			provide: RuntimeConfigurationAccessor,
			useExisting: RuntimeConfigurationAccessorService,
		},
		{ provide: CoreEventSync, useExisting: CoreEventSyncService },
		{
			provide: ServiceDomainMappingLookup,
			useExisting: ServiceDomainMappingRepository,
		},
		ServiceEventAdapter,
			{ provide: CoreEventStreamPool, useExisting: CoreEventStreamPoolService },
	],
	exports: [],
}, DatabasePort, ServiceEventService, ServiceStore, ServiceService, PreviewTopologyService, ServiceNetworkService) {}
