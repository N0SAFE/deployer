import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { createModuleContext, EffectHost, effectHostProvider } from "@deployer/nest-effect";

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
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import { ServiceDomainMappingLookup } from "@project/core/ports/service-domain-mapping-lookup.port";
import { ProjectDomainModule } from "@/modules/project/project.module";

import { ServiceController } from "./controllers/service.controller";
import { ServiceStore } from "./repositories/service.repository";
import { registerServiceEventAdapter, SERVICE_EVENT_REGISTRATION } from "./services/service-event-adapter";
import { ServiceEventService, ServiceEventServiceImpl } from "./services/service-event.service";
import { PreviewTopologyService } from "./services/preview-topology.service";
import { ServiceNetworkService } from "./services/service-network.service";
import { ServiceService } from "./services/service.service";

/**
 * Services: the deployable units inside a project, their hierarchy, their
 * dependency graph, their network config and their event stream.
 *
 * Shared core services stay Nest providers; each one is exposed to the Effect layer through a
 * port so the services can `yield*` them. The store and use cases are constants provided here
 * (`useValue`); the event bus is built over the stream pool (`useFactory`). `ProjectStore` comes
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
		effectHostProvider(),
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
		// Registers the service namespace on the core event bus when the module is built.
		{ provide: SERVICE_EVENT_REGISTRATION, useFactory: registerServiceEventAdapter, inject: [CoreEventSyncService, EffectHost] },
		{
			provide: ServiceEventService,
			useFactory: (pool: CoreEventStreamPoolService) => new ServiceEventServiceImpl(pool),
			inject: [CoreEventStreamPoolService],
		},
		{ provide: ServiceStore, useValue: ServiceStore.live },
		{ provide: ServiceService, useValue: ServiceService.live },
		{ provide: PreviewTopologyService, useValue: PreviewTopologyService.live },
		{ provide: ServiceNetworkService, useValue: ServiceNetworkService.live },
	],
	exports: [],
}, DatabasePort) {}
