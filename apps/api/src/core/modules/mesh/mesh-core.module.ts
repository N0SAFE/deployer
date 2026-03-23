import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { SystemMeshEventService } from "./events/system-mesh-event.service";
import { SystemMeshClusterRepository } from "./repositories/system-mesh-cluster.repository";
import { SystemMeshLogicService } from "./services/system-mesh-logic.service";
import { SystemMeshOverlayScopeService } from "./services/system-mesh-overlay-scope.service";
import { MeshQueueTransitionService } from "./services/mesh-queue-transition.service";
import { SystemMeshTopicService } from "./services/system-mesh-topic.service";
import { SystemMeshTopologyService } from "./services/system-mesh-topology.service";

@Module({
    imports: [EventsModule, DatabaseModule],
    providers: [
        SystemMeshEventService,
        SystemMeshClusterRepository,
        {
            provide: SystemMeshTopologyService,
            useFactory: (
                systemMeshEventService: SystemMeshEventService,
                systemMeshLogicService: SystemMeshLogicService,
                systemMeshOverlayScopeService: SystemMeshOverlayScopeService,
                systemMeshClusterRepository?: SystemMeshClusterRepository,
            ) =>
                new SystemMeshTopologyService(
                    systemMeshEventService,
                    systemMeshLogicService,
                    systemMeshOverlayScopeService,
                    systemMeshClusterRepository,
                ),
            inject: [
                SystemMeshEventService,
                SystemMeshLogicService,
                SystemMeshOverlayScopeService,
                { token: SystemMeshClusterRepository, optional: true },
            ],
        },
        SystemMeshLogicService,
        SystemMeshOverlayScopeService,
        {
            provide: SystemMeshTopicService,
            useFactory: (systemMeshTopologyService: SystemMeshTopologyService) =>
                new SystemMeshTopicService(systemMeshTopologyService),
            inject: [SystemMeshTopologyService],
        },
        {
            provide: MeshQueueTransitionService,
            useFactory: (
                systemMeshTopicService: SystemMeshTopicService,
                systemMeshTopologyService: SystemMeshTopologyService,
            ) => new MeshQueueTransitionService(systemMeshTopicService, systemMeshTopologyService),
            inject: [SystemMeshTopicService, SystemMeshTopologyService],
        },
    ],
    exports: [
        SystemMeshEventService,
        SystemMeshClusterRepository,
        SystemMeshTopologyService,
        SystemMeshLogicService,
        SystemMeshOverlayScopeService,
        MeshQueueTransitionService,
        SystemMeshTopicService,
    ],
})
export class MeshCoreModule {}
