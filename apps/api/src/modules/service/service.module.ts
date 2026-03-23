import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { ProjectCoreModule } from "@/core/modules/project/project-core.module";
import { ServiceController } from "./controllers/service.controller";
import { ServiceRepository } from "./repositories/service.repository";
import { ServiceService } from "./services/service.service";
import { ServiceEventService } from "./services/service-event.service";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { CoreEventSyncService } from "@/core/modules/events";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";

@Module({
    imports: [DatabaseModule, ProjectCoreModule, ConfigurationCoreModule, EventsModule],
    controllers: [ServiceController],
    providers: [
        {
            provide: ServiceService,
            useFactory: (
                serviceRepository: ServiceRepository,
                serviceEventService: ServiceEventService,
                coreEventSyncService: CoreEventSyncService,
                projectAccessService: ProjectAccessService,
            ) =>
                new ServiceService(
                    serviceRepository,
                    serviceEventService,
                    coreEventSyncService,
                    projectAccessService,
                ),
            inject: [ServiceRepository, ServiceEventService, CoreEventSyncService, ProjectAccessService],
        },
        ServiceRepository,
        ServiceEventService,
    ],
    exports: [ServiceService, ServiceRepository, ServiceEventService],
})
export class ServiceModule {}
