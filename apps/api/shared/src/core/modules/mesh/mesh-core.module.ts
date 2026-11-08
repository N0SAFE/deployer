import { nodeDoorFromEnv } from '@deployer/mesh-client'
import {
    createModuleContext,
    effectHostProvider,
    serviceLifecycle,
} from '@deployer/nest-effect'
import {
    LocalDatabase,
    NodeConfigRepository,
    type LocalDatabaseShape,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'

import { EnvModule, EnvService } from '../../../config/env/env.module'
import { DatabaseModule } from '../database/database.module'
import { DatabasePort } from '../database/storage'
import { EventsModule } from '../events/events.module'
import { NodeStateModule } from '../node-state/node-state.module'
import { SystemMetricsModule } from '../system-metrics/system-metrics.module'

import { MeshController } from './controllers/mesh.controller'
import { MeshInitializationModule } from './initialization/mesh-initialization.module'
import {
    makeNodeMeshConfigRepository,
    NodeMeshConfigRepository,
    type NodeMeshConfigRepositoryShape,
} from './repositories/node-mesh-config.repository'
import {
    makeSystemMeshClusterRepository,
    SystemMeshClusterRepository,
} from './repositories/system-mesh-cluster.repository'
import {
    SystemMeshConfigService,
} from './services/system-mesh-config.service'

import type { Context } from 'effect'

/**
 * What is left of the platform's old mesh: the node's identity and configuration, the registry of the fleet's nodes, and
 * the ping, metrics, event-stream and node-configuration procedures. Discovery, routing and the links between nodes are
 * the mesh agent's; this module holds no peer sessions, no trust keyring and no topic bus.
 */
export class MeshCoreModule extends createModuleContext({
    imports: [
        EventsModule,
        DatabaseModule,
        SystemMetricsModule,
        MeshInitializationModule,
        NodeStateModule,
        EnvModule,
    ],
    controllers: [MeshController],
    providers: [
        effectHostProvider(),
        {
            provide: NodeMeshConfigRepository,
            useFactory: (localDb: LocalDatabaseShape) =>
                makeNodeMeshConfigRepository(localDb),
            inject: [LocalDatabase],
        },
        {
            provide: SystemMeshConfigService,
            useFactory: (
                nodeConfig: NodeConfigRepositoryShape,
                meshConfigs: NodeMeshConfigRepositoryShape,
                env: EnvService
            ) =>
                new SystemMeshConfigService.live({
                    nodeConfig,
                    meshConfigs,
                    env: {
                        appUrl: () => env.get('APP_URL'),
                        bootstrapPeers: () => env.get('MESH_BOOTSTRAP_PEERS'),
                    },
                }),
            inject: [
                NodeConfigRepository,
                NodeMeshConfigRepository,
                EnvService,
            ],
        },
        serviceLifecycle(SystemMeshConfigService),
        {
            provide: SystemMeshClusterRepository,
            // The repository mints join tokens through this node's agent; the door gets its socket from the environment.
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>,
                nodeConfig: NodeConfigRepositoryShape,
                env: EnvService
            ) =>
                makeSystemMeshClusterRepository({
                    database,
                    nodeConfig,
                    nodeDoor: nodeDoorFromEnv(env),
                }),
            inject: [DatabasePort, NodeConfigRepository, EnvService],
        },
    ],
    exports: [
        NodeMeshConfigRepository,
        SystemMeshConfigService,
        SystemMeshClusterRepository,
        SystemMetricsModule,
    ],
}) {}
