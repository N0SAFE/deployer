import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { ProjectCoreModule } from "@/core/modules/project/project-core.module";
import { ServiceController } from "./controllers/service.controller";
import { ServiceRepository } from "./repositories/service.repository";
import { ServiceService } from "./services/service.service";
import { ServiceEventService } from "./services/service-event.service";
import { PreviewTopologyService } from "./services/preview-topology.service";
import { ServiceNetworkService } from "./services/service-network.service";
import { ProjectModule } from "@/modules/project/project.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { CoreEventSyncService } from "@/core/modules/events";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";

@Module({
    imports: [DatabaseModule, ProjectCoreModule, ConfigurationCoreModule, EventsModule, ProjectModule, ProvidersModule],
    controllers: [ServiceController],
    providers: [
        ServiceService,
        ServiceRepository,
        ServiceEventService,
        PreviewTopologyService,
        ServiceNetworkService,
    ],
    exports: [ServiceService, ServiceRepository, ServiceEventService, ServiceNetworkService],
})
export class ServiceModule {}
