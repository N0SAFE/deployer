import type { DockerService } from '@deployer/nest-docker/services/docker.service'
import type { SwarmClusterService, SwarmFleetService, SwarmParticipationService } from "@deployer/nest-effect/swarm";
import type { ClusterNodeInventoryRepository } from "@deployer/nest-effect/node-state";
import type { ClusterNodeRepository } from "@deployer/nest-effect/node-state";
import type { EnvService } from '@deployer/shared/config/env/env.module'
import { Context } from 'effect'

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
    SwarmClusterService
>()('fleet/SwarmClusterPort') {}
export class SwarmFleetPort extends Context.Service<
    SwarmFleetPort,
    SwarmFleetService
>()('fleet/SwarmFleetPort') {}
export class SwarmParticipationPort extends Context.Service<
    SwarmParticipationPort,
    SwarmParticipationService
>()('fleet/SwarmParticipationPort') {}
export class ClusterNodeRepoPort extends Context.Service<
    ClusterNodeRepoPort,
    ClusterNodeRepository
>()('fleet/ClusterNodeRepoPort') {}
export class NodeInventoryPort extends Context.Service<
    NodeInventoryPort,
    ClusterNodeInventoryRepository
>()('fleet/NodeInventoryPort') {}
export class ClusterEnvPort extends Context.Service<
    ClusterEnvPort,
    EnvService
>()('fleet/ClusterEnvPort') {}
export class ClusterEventsPort extends Context.Service<
    ClusterEventsPort,
    ClusterSwarmEventsService
>()('fleet/ClusterEventsPort') {}
export type { DockerService }
