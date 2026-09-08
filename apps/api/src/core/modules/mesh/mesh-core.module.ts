import { Module } from '@nestjs/common'
import { DatabaseModule } from '@/core/modules/database/database.module'
import { EventsModule } from '@/core/modules/events/events.module'
import { SystemMeshEventService } from './events/system-mesh-event.service'
import { SystemMeshClusterRepository } from './repositories/system-mesh-cluster.repository'
import { SystemMeshLogicService } from './services/system-mesh-logic.service'
import { SystemMeshOverlayScopeService } from './services/system-mesh-overlay-scope.service'
import { MeshQueueTransitionService } from './services/mesh-queue-transition.service'
import { SystemMeshResourceDiscoveryService } from './services/system-mesh-resource-discovery/system-mesh-resource-discovery.service'
import { SystemMeshResourceService } from './services/system-mesh-resource.service';
import { NodeInfoService } from './services/node-info.mesh.service';
import { MESH_SERVICE_TOKEN } from './tokens';
import { MeshQueryExecutor } from './query/mesh-query-executor';
import { SystemMeshTopicService } from './services/system-mesh-topic/orchestrator/system-mesh-topic.service'
import { SystemMeshTopologyService } from './services/system-mesh-topology/orchestrator/system-mesh-topology.service'
import { MeshStreamRuntimeService } from './services/mesh-stream-runtime.service'
import { SystemMetricsModule } from '@/core/modules/system-metrics/system-metrics.module'
import { SystemMeshConfigService } from './services/system-mesh-config.service'
import { NodeMeshConfigRepository } from './repositories/node-mesh-config.repository'
import { CoreEventStreamPoolService } from '@repo/nest-events'
import { MeshInternalRequestService } from './services/mesh-internal-request.service'
import { MeshRuntimeModule } from './runtime/mesh-runtime.module'
import { MeshOrchestrationService } from './orchestration/mesh-orchestration.service'
import { MeshInitializationModule } from './initialization/mesh-initialization.module'
import { MeshResourceDispatcher, MeshResourceController } from './dispatcher'
import { MeshController } from './controllers/mesh.controller'
import { MeshIdentityService } from './services/system-mesh-topology/services/mesh-identity.service'
import { MeshTrustService } from './services/system-mesh-topology/services/mesh-trust.service'
import { MeshTrustStrictModeService } from './services/system-mesh-topology/services/mesh-trust-strict-mode.service'
import { MeshPeerSessionService } from './services/system-mesh-topology/services/mesh-peer-session.service'
import { MeshHealthMonitorService } from './services/system-mesh-topology/services/mesh-health-monitor.service'
import { MeshMembershipService } from './services/system-mesh-topology/services/mesh-membership.service'
import { MeshResourceRegistryService } from './services/system-mesh-topology/services/mesh-resource-registry.service'
import { MeshStreamRouterService } from './services/system-mesh-topology/services/mesh-stream-router.service'
import { MeshQueueReplicationService } from './services/system-mesh-topology/services/mesh-queue-replication.service'
import { MeshControlPlaneService } from './services/system-mesh-topology/services/mesh-control-plane.service'
import { MeshClusterSyncService } from './services/system-mesh-topology/services/mesh-cluster-sync.service'
import { MeshStreamSessionService } from './services/system-mesh-topology/services/mesh-stream-session.service'
import { MeshEnvelopeSideEffectsService } from './services/system-mesh-topology/services/mesh-envelope-side-effects.service'
import { MeshTopicRegistryService } from './services/system-mesh-topic/services/mesh-topic-registry.service'
import { MeshTopicEnvelopeHandlerService } from './services/system-mesh-topic/services/mesh-topic-envelope-handler.service'
import { MeshTopicQueryBusService } from './services/system-mesh-topic/services/mesh-topic-query-bus.service'
import { MeshTopicPublisherService } from './services/system-mesh-topic/services/mesh-topic-publisher.service'
import { MeshTopicResourceIndexService } from './services/system-mesh-topic/services/mesh-topic-resource-index.service'
import { CLOCK_TOKEN, SystemClock } from './shared/primitives/clock';
import { ID_GENERATOR_TOKEN, SystemIdGenerator } from './shared/primitives/id-generator';
import { MeshConnectionRegistry } from './connection/mesh-connection-registry';
import { ServerConnectionConsumerRegistry } from './connection/mesh-consumer-registry';
import { OwnershipResolverService } from './services/ownership/ownership-resolver.service';
import { StreamManagerService } from './services/stream-manager/stream-manager.service';
import { SetupModule } from '@/modules/setup/setup.module';
import { CoreDockerModule } from '@/core/modules/docker/docker.module';
import type { MeshNodeCaller } from './services/system-mesh-resource-discovery/query/mesh-query-executor';
import { MESH_NODE_CALLER_TOKEN } from './tokens';

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
        MeshRuntimeModule,
        MeshInitializationModule,
        SetupModule,
        CoreDockerModule,
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
