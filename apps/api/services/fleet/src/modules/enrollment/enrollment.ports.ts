import { Context, type Effect } from 'effect'

import type {
    MeshEnrollmentEnrollInput,
    MeshSwarmJoinGrant,
} from '@deployer/contracts-entities'

/**
 * What enrolling a node touches, one tag per collaborator, so the rules can be tested with each substituted and the module
 * says in one place where each comes from. Every failure here is the collaborator's own (a database, the agent's socket); the
 * service adds the refusals that are the fleet's.
 */

/**
 * Whether this node's agent vouches for a join token: only the agent holds the swarm's credential. Null is "no agent to ask",
 * which is not an answer, so it vouches for no one.
 */
export type JoinTokenVoucherShape = {
    readonly check: (token: string) => Effect.Effect<boolean | null>
}
export class JoinTokenVoucher extends Context.Service<
    JoinTokenVoucher,
    JoinTokenVoucherShape
>()('fleet/JoinTokenVoucher') {}

/** The fleet's swarm role decision for a joiner, or null when it has no swarm to hand over. */
export type SwarmGrantsShape = {
    readonly grantFor: (
        policy: MeshEnrollmentEnrollInput['requestedSwarmPolicy']
    ) => Effect.Effect<MeshSwarmJoinGrant | null, unknown>
}
export class SwarmGrants extends Context.Service<SwarmGrants, SwarmGrantsShape>()(
    'fleet/SwarmGrants'
) {}

/** What a joiner is handed from this node's own configuration. */
export type FleetConfigShape = {
    /** The shared database URL a joiner points at, or null when this node was never set up. */
    readonly databaseUrl: () => Effect.Effect<string | null, unknown>
    /**
     * The platform secret ring every node of the fleet shares (generated on first use), or null when this node has no config yet.
     */
    readonly platformSecretRing: () => Effect.Effect<
        {
            readonly generation: number
            readonly value: string
            readonly previous: readonly {
                readonly generation: number
                readonly value: string
            }[]
        } | null,
        unknown
    >
}
export class FleetConfig extends Context.Service<FleetConfig, FleetConfigShape>()(
    'fleet/FleetConfig'
) {}

/** The fleet's registry of nodes: where an enrollment is written. */
export type NodeRegistryShape = {
    readonly register: (input: {
        readonly nodeId: string
        readonly serverUrl: string
        readonly displayName: string | null
    }) => Effect.Effect<
        { readonly nodeId: string; readonly enrolledAt: string },
        unknown
    >
}
export class NodeRegistry extends Context.Service<NodeRegistry, NodeRegistryShape>()(
    'fleet/NodeRegistry'
) {}
