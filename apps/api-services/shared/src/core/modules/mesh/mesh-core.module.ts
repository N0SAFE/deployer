import { Module } from '@nestjs/common'
import { DatabaseModule } from '@/core/modules/database/database.module'
import { EventsModule } from '@/core/modules/events/events.module'
import { SystemMeshEventService } from '@/core/modules/mesh/events/system-mesh-event.service'
import { SystemMeshClusterRepository } from '@/core/modules/mesh/repositories/system-mesh-cluster.repository'
import { SystemMeshLogicService } from '@/core/modules/mesh/services/system-mesh-logic.service'
import { SystemMeshOverlayScopeService } from '@/core/modules/mesh/services/system-mesh-overlay-scope.service'
import { MeshQueueTransitionService } from '@/core/modules/mesh/services/mesh-queue-transition.service'
import { SystemMeshResourceDiscoveryService } from '@/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service'
import { SystemMeshResourceService } from '@/core/modules/mesh/services/system-mesh-resource.service';
import { NodeInfoService } from '@/core/modules/mesh/services/node-info.mesh.service';
import { MESH_SERVICE_TOKEN } from '@/core/modules/mesh/tokens';
import { MeshQueryExecutor } from '@/core/modules/mesh/query/mesh-query-executor';
import { SystemMeshTopicService } from '@/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service'
import { SystemMeshTopologyService } from '@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service'
import { MeshStreamRuntimeService } from '@/core/modules/mesh/services/mesh-stream-runtime.service'
import { SystemMetricsModule } from '@/core/modules/system-metrics/system-metrics.module'
import { SystemMeshConfigService } from '@/core/modules/mesh/services/system-mesh-config.service'
import { NodeMeshConfigRepository } from '@/core/modules/mesh/repositories/node-mesh-config.repository'
import { CoreEventStreamPoolService } from '@deployer/nest-events'
import { MeshInternalRequestService } from '@/core/modules/mesh/services/mesh-internal-request.service'
import { MeshOrchestrationService } from '@/core/modules/mesh/orchestration/mesh-orchestration.service'
import { MeshInitializationModule } from '@/core/modules/mesh/initialization/mesh-initialization.module'
import { MeshResourceDispatcher, MeshResourceController } from '@/core/modules/mesh/dispatcher'
import { MeshController } from '@/core/modules/mesh/controllers/mesh.controller'
import { MeshIdentityService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-identity.service'
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module"
import { MeshTrustService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-trust.service'
import { MeshTrustStrictModeService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-trust-strict-mode.service'
import { MeshPeerSessionService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-peer-session.service'
import { MeshHealthMonitorService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-health-monitor.service'
import { MeshMembershipService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-membership.service'
import { MeshResourceRegistryService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-resource-registry.service'
import { MeshStreamRouterService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-stream-router.service'
import { MeshQueueReplicationService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-queue-replication.service'
import { MeshControlPlaneService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-control-plane.service'
import { MeshClusterSyncService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-cluster-sync.service'
import { MeshStreamSessionService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-stream-session.service'
import { MeshEnvelopeSideEffectsService } from '@/core/modules/mesh/services/system-mesh-topology/services/mesh-envelope-side-effects.service'
import { MeshTopicRegistryService } from '@/core/modules/mesh/services/system-mesh-topic/services/mesh-topic-registry.service'
import { MeshTopicEnvelopeHandlerService } from '@/core/modules/mesh/services/system-mesh-topic/services/mesh-topic-envelope-handler.service'
import { MeshTopicQueryBusService } from '@/core/modules/mesh/services/system-mesh-topic/services/mesh-topic-query-bus.service'
import { MeshTopicPublisherService } from '@/core/modules/mesh/services/system-mesh-topic/services/mesh-topic-publisher.service'
import { MeshTopicResourceIndexService } from '@/core/modules/mesh/services/system-mesh-topic/services/mesh-topic-resource-index.service'
import { CLOCK_TOKEN, SystemClock } from '@/core/modules/mesh/shared/primitives/clock';
import { ID_GENERATOR_TOKEN, SystemIdGenerator } from '@/core/modules/mesh/shared/primitives/id-generator';
import { MeshConnectionRegistry } from '@/core/modules/mesh/connection/mesh-connection-registry';
import { ServerConnectionConsumerRegistry } from '@/core/modules/mesh/connection/mesh-consumer-registry';
import { OwnershipResolverService } from '@/core/modules/mesh/services/ownership/ownership-resolver.service';
import { StreamManagerService } from '@/core/modules/mesh/services/stream-manager/stream-manager.service';
import { NodeStateModule } from "@/core/modules/node-state/node-state.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import type { MeshNodeCaller } from '@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-query-executor';
import { MESH_NODE_CALLER_TOKEN } from '@/core/modules/mesh/tokens';
import { EnvModule, EnvService } from "@/config/env/env.module";

/** Stub MeshNodeCaller — replace with real impl at runtime */
class StubMeshNodeCaller implements MeshNodeCaller {
    async callMany<TItem>(
        _entityKey: string,
        _methodName: string,
        _payload: Record<string, unknown>,
        _options: { timeoutMs?: number },
    ): Promise<readonly { nodeId: string; items: readonly TItem[]; durationMs: number }[]> {
        return [];
    }
}

const MESH_TOPOLOGY_SERVICES = [
    MeshIdentityService,
    MeshTrustService,
    MeshTrustStrictModeService,
    MeshPeerSessionService,
    MeshHealthMonitorService,
    MeshMembershipService,
    MeshResourceRegistryService,
    MeshStreamRouterService,
    MeshQueueReplicationService,
    MeshControlPlaneService,
    MeshClusterSyncService,
    MeshStreamSessionService,
    MeshEnvelopeSideEffectsService,
]

const MESH_TOPIC_SERVICES = [
    CoreEventStreamPoolService,
    MeshTopicResourceIndexService,
    MeshTopicPublisherService,
    MeshTopicQueryBusService,
    MeshTopicEnvelopeHandlerService,
    MeshTopicRegistryService,
    SystemMeshTopicService,
]

@Module({
    imports: [
        EventsModule,
        DatabaseModule,
        SystemMetricsModule,
        MeshInitializationModule,
        // NodeStateModule (LOCAL SQLite only) instead of SetupModule: mesh needs
        // NodeConfigRepository, which reads a file that exists before setup. The
        // former import of the setup FEATURE module closed a cycle
        // (mesh → setup → initialization → swarm → mesh).
        NodeStateModule,
        CoreDockerModule,
        // SwarmCoreModule is SETUP-SAFE and imports only NodeStateModule, so
        // this edge is ACYCLIC (swarm never imports mesh at the module level).
        // The mesh needs it to issue the SWARM JOIN GRANT: `consumeJoinGrant`
        // is the fleet's chance to decide whether a joining node may become a
        // manager — a decision only this node (the cluster owner) can make.
        SwarmCoreModule,
		EnvModule,
	],
    controllers: [
        MeshResourceController,
        MeshController,
    ],
    providers: [
        {
            provide: CLOCK_TOKEN,
            useClass: SystemClock,
        },
        {
            provide: ID_GENERATOR_TOKEN,
            useClass: SystemIdGenerator,
        },
        ...MESH_TOPOLOGY_SERVICES,
        ...MESH_TOPIC_SERVICES,
        SystemMeshTopologyService,
        NodeMeshConfigRepository,
        SystemMeshConfigService,
        SystemMeshEventService,
        SystemMeshClusterRepository,
        SystemMeshLogicService,
        SystemMeshOverlayScopeService,
        SystemMeshResourceDiscoveryService,
        SystemMeshResourceService,
        {
            provide: MeshQueryExecutor,
            useFactory: (nodeCaller: MeshNodeCaller) => new MeshQueryExecutor(nodeCaller),
            inject: [MESH_NODE_CALLER_TOKEN],
        },
        {
            provide: MESH_SERVICE_TOKEN,
            useExisting: SystemMeshResourceService,
        },
        {
            provide: MESH_NODE_CALLER_TOKEN,
            useClass: StubMeshNodeCaller,
        },
        {
            provide: MeshQueueTransitionService,
            useFactory: (
                systemMeshTopicService: SystemMeshTopicService,
                systemMeshTopologyService: SystemMeshTopologyService
            ) =>
                new MeshQueueTransitionService(
                    systemMeshTopicService,
                    systemMeshTopologyService
                ),
            inject: [SystemMeshTopicService, SystemMeshTopologyService],
        },
        MeshStreamRuntimeService,
        MeshInternalRequestService,
        MeshOrchestrationService,
        OwnershipResolverService,
        StreamManagerService,
        MeshConnectionRegistry,
        ServerConnectionConsumerRegistry,
        NodeInfoService,
        MeshResourceDispatcher,
    ],
    exports: [
        MeshResourceDispatcher,
        MeshQueryExecutor,
        NodeMeshConfigRepository,
        SystemMeshConfigService,
        SystemMeshEventService,
        SystemMeshClusterRepository,
        SystemMeshTopologyService,
        SystemMeshLogicService,
        SystemMeshOverlayScopeService,
        SystemMeshResourceDiscoveryService,
        SystemMeshResourceService,
        MeshQueueTransitionService,
        SystemMeshTopicService,
        MeshStreamRuntimeService,
        MeshInternalRequestService,
        SystemMetricsModule,
        MeshConnectionRegistry,
        ServerConnectionConsumerRegistry,
        OwnershipResolverService,
        StreamManagerService,
    ],
})
export class MeshCoreModule {}
