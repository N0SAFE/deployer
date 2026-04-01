import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { SetupModule } from "@/modules/setup/setup.module";
import { SystemMeshEventService } from "./events/system-mesh-event.service";
import { SystemMeshClusterRepository } from "./repositories/system-mesh-cluster.repository";
import { SystemMeshLogicService } from "./services/system-mesh-logic.service";
import { SystemMeshOverlayScopeService } from "./services/system-mesh-overlay-scope.service";
import { MeshQueueTransitionService } from "./services/mesh-queue-transition.service";
import { SystemMeshResourceDiscoveryService } from "./services/system-mesh-resource-discovery.service";
import { SystemMeshTopicService } from "./services/system-mesh-topic.service";
import { SystemMeshTopologyService } from "./services/system-mesh-topology.service";
import { MeshStreamRuntimeService } from "./services/mesh-stream-runtime.service";
import { SystemMetricsModule } from "@/core/modules/system-metrics/system-metrics.module";
import { SystemMeshConfigService } from "./services/system-mesh-config.service";
import { NodeMeshConfigRepository } from "./repositories/node-mesh-config.repository";
import { EnvService } from "@/config/env/env.service";

@Module({
    imports: [EventsModule, DatabaseModule, SystemMetricsModule, SetupModule],
    providers: [
        NodeMeshConfigRepository,
        SystemMeshConfigService,
        SystemMeshEventService,
        SystemMeshClusterRepository,
        {
            provide: SystemMeshTopologyService,
            useFactory: (
                systemMeshEventService: SystemMeshEventService,
                systemMeshLogicService: SystemMeshLogicService,
                systemMeshOverlayScopeService: SystemMeshOverlayScopeService,
                envService: EnvService,
                systemMeshConfigService: SystemMeshConfigService,
                systemMeshClusterRepository?: SystemMeshClusterRepository,
            ) =>
                new SystemMeshTopologyService(
                    systemMeshEventService,
                    systemMeshLogicService,
                    systemMeshOverlayScopeService,
                    envService,
                    systemMeshConfigService,
                    systemMeshClusterRepository,
                ),
            inject: [
                SystemMeshEventService,
                SystemMeshLogicService,
                SystemMeshOverlayScopeService,
                EnvService,
                SystemMeshConfigService,
                { token: SystemMeshClusterRepository, optional: true },
            ],
        },
        SystemMeshLogicService,
        SystemMeshOverlayScopeService,
        SystemMeshResourceDiscoveryService,
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
        MeshStreamRuntimeService,
    ],
    exports: [
        NodeMeshConfigRepository,
        SystemMeshConfigService,
        SystemMeshEventService,
        SystemMeshClusterRepository,
        SystemMeshTopologyService,
        SystemMeshLogicService,
        SystemMeshOverlayScopeService,
        SystemMeshResourceDiscoveryService,
        MeshQueueTransitionService,
        SystemMeshTopicService,
        MeshStreamRuntimeService,
        SystemMetricsModule,
    ],
})
export class MeshCoreModule {}
