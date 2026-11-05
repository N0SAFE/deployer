import { Context, type Effect } from 'effect'

/** The election's cadence and thresholds. */
export type SwarmElectionConfig = {
    readonly evalStableMs: number
    readonly evalVolatileMs: number
    readonly cooldownMs: number
    readonly deltaMaster: number
    readonly heartbeatTtlMs: number
    readonly masterGraceMs: number
}

export type SwarmJoinConfig = {
    /** The most managers the cluster aims to hold quorum with. */
    readonly quorumMax: number
}

/**
 * First-run participation defaults, supplied as DATA by the app. The persisted
 * `node_config.swarmConfig` always wins; these are consulted only before the wizard has recorded a
 * decision. They arrive as a value because which variables carry them is an app convention.
 */
export type SwarmParticipationDefaults = {
    readonly mode?: 'create' | 'join'
    readonly policy?: 'auto' | 'manager' | 'worker'
    readonly advertiseAddr?: string | null
    readonly joinToken?: string | null
    readonly joinAddrs?: readonly string[]
    /** This node's mesh address, resolved when needed. A failure counts as "no address yet". */
    readonly meshAddress?: Effect.Effect<string | null, unknown>
    /** False when the deployment owns every platform service and no swarm is wanted. */
    readonly swarmManaged?: boolean
}

export class SwarmElectionConfigService extends Context.Service<
    SwarmElectionConfigService,
    SwarmElectionConfig
>()('swarm/ElectionConfig') {}
export class SwarmJoinConfigService extends Context.Service<
    SwarmJoinConfigService,
    SwarmJoinConfig
>()('swarm/JoinConfig') {}
export class SwarmParticipationDefaultsService extends Context.Service<
    SwarmParticipationDefaultsService,
    SwarmParticipationDefaults
>()('swarm/ParticipationDefaults') {}
