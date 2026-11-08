import type {
    ClusterNodeRepositoryShape,
    NodeConfigRepositoryShape,
} from '@deployer/node-state'

import { makeSwarmBootstrap } from './bootstrap/swarm-bootstrap'
import {
    SwarmCluster,
    type SwarmClusterShape,
} from './cluster/swarm-cluster'
import {
    makeSwarmLeadership,
    type ClusterMetricsProvider,
    type LeadershipEventSink,
} from './election/swarm-leadership'
import { makeSwarmFleet } from './fleet/swarm-fleet'
import { makeSwarmJoinGrant } from './join/swarm-join-grant'
import { makeSwarmParticipation } from './participation/swarm-participation'

import type {
    SwarmElectionConfig,
    SwarmJoinConfig,
    SwarmParticipationDefaults,
} from './config'

/** The engine the cluster services run on. */
type Engine = ConstructorParameters<typeof SwarmCluster.live>[0]

export type SwarmServicesDeps = {
    readonly docker: Engine
    readonly nodeConfig: NodeConfigRepositoryShape
    readonly clusterNode: ClusterNodeRepositoryShape
}

export type SwarmServicesOptions = {
    /** The election's cadence and thresholds. The package has no defaults: the right cadence depends on the fleet. */
    readonly election: SwarmElectionConfig
    readonly join: SwarmJoinConfig
    /** First-run participation defaults; the persisted `node_config` choice always wins. */
    readonly participation: SwarmParticipationDefaults
    /** Whether THIS app converges the engine at boot (the API does; setup founds the cluster from its own flow). Default true. */
    readonly convergeOnBoot?: boolean
    readonly metricsProvider: ClusterMetricsProvider | null
    readonly eventSink: LeadershipEventSink | null
}

/**
 * Builds every swarm service over one engine and one set of node repositories, so a host provides them
 * once and they share the same cluster view. The host runs `bootstrap.onBoot` at startup and
 * `leadership.run` for the life of the process.
 */
export type SwarmServices = {
    readonly cluster: SwarmClusterShape
    readonly fleet: ReturnType<typeof makeSwarmFleet>
    readonly participation: ReturnType<typeof makeSwarmParticipation>
    readonly joinGrant: ReturnType<typeof makeSwarmJoinGrant>
    readonly bootstrap: ReturnType<typeof makeSwarmBootstrap>
    readonly leadership: ReturnType<typeof makeSwarmLeadership>
}

export const makeSwarmServices = (
    deps: SwarmServicesDeps,
    options: SwarmServicesOptions
): SwarmServices => {
    const { docker, nodeConfig, clusterNode } = deps
    const cluster = new SwarmCluster.live(docker)
    const fleet = makeSwarmFleet(docker)
    const participation = makeSwarmParticipation({
        defaults: options.participation,
        nodeConfig,
        clusterNode,
        cluster,
        docker,
    })
    const joinGrant = makeSwarmJoinGrant({
        cluster,
        config: options.join,
        participation: options.participation,
    })
    const bootstrap = makeSwarmBootstrap(
        participation,
        options.convergeOnBoot ?? true
    )
    const leadership = makeSwarmLeadership({
        cluster,
        clusterNode,
        config: options.election,
        metricsProvider: options.metricsProvider,
        eventSink: options.eventSink,
    })
    return { cluster, fleet, participation, joinGrant, bootstrap, leadership }
}
