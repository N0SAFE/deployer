import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { EventsModule } from '../events/events.module'
import { SystemMetricsModule } from '../system-metrics/system-metrics.module'
import { NodeStateModule } from '../node-state/node-state.module'
import { EnvModule } from '../../../config/env/env.module'
import { SystemMeshClusterRepository } from './repositories/system-mesh-cluster.repository'
import { NodeMeshConfigRepository } from './repositories/node-mesh-config.repository'
import { SystemMeshConfigService } from './services/system-mesh-config.service'
import { MeshInitializationModule } from './initialization/mesh-initialization.module'
import { MeshController } from './controllers/mesh.controller'

/**
 * What is left of the platform's old mesh: the node's identity and configuration, the registry of the fleet's nodes, and
 * the ping, metrics, event-stream and node-configuration procedures. Discovery, routing and the links between nodes are
 * the mesh agent's; this module holds no peer sessions, no trust keyring and no topic bus.
 */
@Module({
    imports: [EventsModule, DatabaseModule, SystemMetricsModule, MeshInitializationModule, NodeStateModule, EnvModule],
    controllers: [MeshController],
    providers: [NodeMeshConfigRepository, SystemMeshConfigService, SystemMeshClusterRepository],
    exports: [NodeMeshConfigRepository, SystemMeshConfigService, SystemMeshClusterRepository, SystemMetricsModule],
})
export class MeshCoreModule {}
