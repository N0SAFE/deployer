import { Module } from '@nestjs/common'

import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createModuleContext } from "@deployer/nest-effect";

import { EnvModule } from '../../../config/env/env.module'
import { EnvService } from '../../../config/env/env.module'
import { DatabaseModule } from '../database/database.module'
import { EventsModule } from '../events/events.module'
import { NodeStateModule } from '../node-state/node-state.module'
import { SystemMetricsModule } from '../system-metrics/system-metrics.module'

import { MeshController } from './controllers/mesh.controller'
import { MeshInitializationModule } from './initialization/mesh-initialization.module'
import { NodeMeshConfigRepository } from './repositories/node-mesh-config.repository'
import { SystemMeshClusterRepository, MESH_NODE_DOOR } from './repositories/system-mesh-cluster.repository'
import { SystemMeshConfigService } from './services/system-mesh-config.service'



/**
 * What is left of the platform's old mesh: the node's identity and configuration, the registry of the fleet's nodes, and
 * the ping, metrics, event-stream and node-configuration procedures. Discovery, routing and the links between nodes are
 * the mesh agent's; this module holds no peer sessions, no trust keyring and no topic bus.
 */
export class MeshCoreModule extends createModuleContext({
    imports: [EventsModule, DatabaseModule, SystemMetricsModule, MeshInitializationModule, NodeStateModule, EnvModule],
    controllers: [MeshController],
    providers: [
        NodeMeshConfigRepository,
        SystemMeshConfigService,
        // The repository mints join tokens through this node's agent; the door gets its socket from the environment.
        { provide: MESH_NODE_DOOR, useFactory: (env: EnvService) => nodeDoorFromEnv(env), inject: [EnvService] },
        SystemMeshClusterRepository,
    ],
    exports: [NodeMeshConfigRepository, SystemMeshConfigService, SystemMeshClusterRepository, SystemMetricsModule],
}) {}
