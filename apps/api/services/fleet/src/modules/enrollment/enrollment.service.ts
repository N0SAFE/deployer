import { ORPCError } from '@orpc/client'

import type {
    MeshEnrollmentDescribeResult,
    MeshEnrollmentEnrollInput,
    MeshEnrollmentEnrollResult,
    MeshSwarmJoinGrant,
} from '@deployer/contracts-entities'

/** What enrolling a node touches, as plain functions so the rules can be tested without the platform. */
export type EnrollmentPorts = {
    readonly version: string
    /** The fleet's swarm role decision for a joiner, or null when it has no swarm to hand over. */
    readonly swarmGrant: (
        policy: MeshEnrollmentEnrollInput['requestedSwarmPolicy']
    ) => Promise<MeshSwarmJoinGrant | null>
    /** Whether this node's agent vouches for a join token; null when it has no agent to ask. */
    readonly checkToken: (token: string) => Promise<boolean | null>
    /** The shared database URL a joiner points at, or null when this node was never set up. */
    readonly databaseUrl: () => string | null | Promise<string | null>
    /** The platform secret ring every node of the fleet shares (generated on first use), or null when this node has no config yet. */
    readonly platformSecret: () => Promise<{
        readonly generation: number
        readonly value: string
        readonly previous: readonly {
            readonly generation: number
            readonly value: string
        }[]
    } | null>
    /** Records the joiner in the fleet's registry. */
    readonly register: (input: {
        nodeId: string
        serverUrl: string
        displayName: string | null
    }) => Promise<{ nodeId: string; enrolledAt: string }>
}

/**
 * Takes a node that holds a join token into the fleet.
 *
 * The token is the authorization: only the agent holds the swarm's credential, so the fleet asks its own agent whether
 * the token is the swarm's and still good. A node with no agent cannot vouch for anyone, so it enrolls no one.
 */
export class EnrollmentService {
    constructor(private readonly ports: EnrollmentPorts) {}

    async describe(token: string): Promise<MeshEnrollmentDescribeResult> {
        await this.authorize(token)
        // No cluster id or CIDR to hand over: the token names the swarm, and the joiner's agent joins it directly.
        return { version: this.ports.version, meshNetwork: null }
    }

    async enroll(
        input: MeshEnrollmentEnrollInput
    ): Promise<MeshEnrollmentEnrollResult> {
        await this.authorize(input.token)

        const databaseUrl = await this.ports.databaseUrl()
        if (databaseUrl === null || databaseUrl.length === 0) {
            throw new ORPCError('PRECONDITION_FAILED', {
                message:
                    'This node has no database URL to hand over: run its setup first',
            })
        }

        const ring = await this.ports.platformSecret()
        if (ring === null || ring.value.length === 0) {
            throw new ORPCError('PRECONDITION_FAILED', {
                message:
                    'This node has no platform secret to hand over: run its setup first',
            })
        }

        const registered = await this.ports.register({
            nodeId: input.nodeId,
            serverUrl: input.serverUrl,
            displayName: input.displayName ?? null,
        })
        const swarmGrant = await this.ports.swarmGrant(
            input.requestedSwarmPolicy
        )

        return {
            nodeId: registered.nodeId,
            enrolledAt: registered.enrolledAt,
            databaseUrl,
            platformSecret: ring.value,
            platformSecretGeneration: ring.generation,
            platformSecretPrevious: ring.previous.map((entry) => ({ ...entry })),
            swarmGrant,
            // The agent token this fleet's own agent vouched for: the joiner keeps it if it ever has to repeat the join.
            meshJoinToken: input.token,
        }
    }

    /** Whether this agent vouches for the token. Absent agent, absent voucher. */
    private async authorize(token: string): Promise<void> {
        if ((await this.ports.checkToken(token)) !== true) {
            throw new ORPCError('UNAUTHORIZED', {
                message: 'The join token is not valid',
            })
        }
    }
}
