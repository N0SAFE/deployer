import { Context } from 'effect'

import { DockerEngine } from '@deployer/docker'
import type { ClusterNodeInventoryRepositoryShape } from '@deployer/node-state'
import type { ClusterNodeRepositoryShape } from '@deployer/node-state'
import type { EnvService } from '@deployer/shared/config/env/env.module'
import type {
    SwarmClusterShape,
    SwarmFleetShape,
    SwarmParticipationShape,
} from '@deployer/swarm'

import type { ClusterSwarmEventsService } from './events/cluster-swarm-events.service'

/**
 * What the cluster module depends on, as Effect ports.
 *
 * The swarm services and node repositories are Promise-based (or synchronous) Nest providers owned
 * by other packages; each tag is registered in the module with `useExisting`, so a Layer asks for the
 * port without importing Nest. `ClusterEventsPort` is the RxJS stream hub that feeds the `stream*`
 * procedures: it owns Docker-event subscriptions and lifecycle hooks, so it stays a Nest provider
 * and the controller reaches it through this port.
 */
export class SwarmClusterPort extends Context.Service<
    SwarmClusterPort,
    SwarmClusterShape
>()('fleet/SwarmClusterPort') {}
export class SwarmFleetPort extends Context.Service<
    SwarmFleetPort,
    SwarmFleetShape
>()('fleet/SwarmFleetPort') {}
export class SwarmParticipationPort extends Context.Service<
    SwarmParticipationPort,
    SwarmParticipationShape
>()('fleet/SwarmParticipationPort') {}
export class ClusterNodeRepoPort extends Context.Service<
    ClusterNodeRepoPort,
    ClusterNodeRepositoryShape
>()('fleet/ClusterNodeRepoPort') {}
export class NodeInventoryPort extends Context.Service<
    NodeInventoryPort,
    ClusterNodeInventoryRepositoryShape
>()('fleet/NodeInventoryPort') {}
export class ClusterEnvPort extends Context.Service<
    ClusterEnvPort,
    EnvService
>()('fleet/ClusterEnvPort') {}
export class ClusterEventsPort extends Context.Service<
    ClusterEventsPort,
    ClusterSwarmEventsService
>()('fleet/ClusterEventsPort') {}
