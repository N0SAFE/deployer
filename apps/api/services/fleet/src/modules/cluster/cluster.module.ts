import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import { createModuleContext, serviceLifecycle } from '@deployer/nest-effect'
import {
    ClusterNodeInventoryRepository,
    type ClusterNodeInventoryRepositoryShape,
} from '@deployer/node-state'
import { ClusterNodeRepository } from '@deployer/node-state'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '@deployer/shared/core/modules/events/base/index'
import { SwarmCoreModule } from '@deployer/shared/core/modules/swarm/swarm.module'
import {
    SwarmCluster,
    SwarmFleet,
    SwarmParticipation,
    type SwarmClusterShape,
    type SwarmFleetShape,
} from '@deployer/swarm'

import {
    ClusterEnvPort,
    ClusterNodeRepoPort,
    NodeInventoryPort,
    SwarmClusterPort,
    SwarmFleetPort,
    SwarmParticipationPort,
} from './cluster.ports'
import { ClusterController } from './controllers/cluster.controller'
import { ClusterEvents } from './events/cluster-events'
import { ClusterService } from './services/cluster.service'

/**
 * `EnvModule` IS IMPORTED EXPLICITLY: the cluster ports alias `EnvService`, so it must be
 * resolvable from THIS module's scope rather than assumed to be registered globally elsewhere.
 *
 * `ClusterService` is a constant over the swarm ports. `ClusterEvents` is the live-state hub: stateful, so built once by a
 * factory from its collaborators, with its lifetime (first load, the Docker event subscription) declared in its shape and run
 * by `serviceLifecycle`. Its streams are RxJS, which stays the streaming surface.
 */
export class ClusterModule extends createModuleContext({
    imports: [SwarmCoreModule, EnvModule],
    controllers: [ClusterController],
    providers: [
        { provide: SwarmClusterPort, useExisting: SwarmCluster },
        { provide: SwarmFleetPort, useExisting: SwarmFleet },
        { provide: SwarmParticipationPort, useExisting: SwarmParticipation },
        { provide: ClusterNodeRepoPort, useExisting: ClusterNodeRepository },
        {
            provide: NodeInventoryPort,
            useExisting: ClusterNodeInventoryRepository,
        },
        { provide: ClusterEnvPort, useExisting: EnvService },
        {
            provide: ClusterEvents,
            useFactory: (
                docker: DockerEngineShape,
                cluster: SwarmClusterShape,
                fleet: SwarmFleetShape,
                inventory: ClusterNodeInventoryRepositoryShape,
                pool: CoreEventStreamPoolServiceShape
            ) => new ClusterEvents.live({ docker, cluster, fleet, inventory, pool }),
            inject: [
                DockerEngine,
                SwarmCluster,
                SwarmFleet,
                ClusterNodeInventoryRepository,
                CoreEventStreamPoolService,
            ],
        },
        // Binds the hub's first load and its Docker event subscription to the app's lifecycle.
        serviceLifecycle(ClusterEvents),
        { provide: ClusterService, useClass: ClusterService.live },
    ],
}) {}
