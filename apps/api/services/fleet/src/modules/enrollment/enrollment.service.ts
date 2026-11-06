import { Context, Effect } from 'effect'

import type {
    MeshEnrollmentDescribeResult,
    MeshEnrollmentEnrollInput,
    MeshEnrollmentEnrollResult,
} from '@deployer/contracts-entities'
import { domainError } from '@deployer/effect-core'
import { DEPLOYER_VERSION } from '@deployer/shared/core/utils/deployer-version'

import {
    FleetConfig,
    JoinTokenVoucher,
    NodeRegistry,
    SwarmGrants,
} from './enrollment.ports'

/** The join token is not one this node's agent vouches for (or there is no agent to ask). */
export class JoinTokenInvalid extends domainError('JoinTokenInvalid', 'unauthorized')() {
    override publicMessage() {
        return 'The join token is not valid'
    }
}

/** This node cannot yet hand a joiner what it needs; `reason` says what is missing, for the operator. */
export class FleetNotSetUp extends domainError('FleetNotSetUp', 'dependency_missing')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

export type EnrollmentShape = {
    readonly describe: (
        token: string
    ) => Effect.Effect<MeshEnrollmentDescribeResult, JoinTokenInvalid, JoinTokenVoucher>
    readonly enroll: (
        input: MeshEnrollmentEnrollInput
    ) => Effect.Effect<
        MeshEnrollmentEnrollResult,
        unknown,
        JoinTokenVoucher | SwarmGrants | FleetConfig | NodeRegistry
    >
}

/** Whether this node's agent vouches for the token. Anything but a clear yes refuses. */
const authorize = (token: string) =>
    Effect.gen(function* () {
        const voucher = yield* JoinTokenVoucher
        if ((yield* voucher.check(token)) !== true) {
            return yield* new JoinTokenInvalid({})
        }
    })

/**
 * Takes a node that holds a join token into the fleet.
 *
 * The token is the authorization: only the agent holds the swarm's credential, so the fleet asks its own agent whether the
 * token is the swarm's and still good. A node with no agent cannot vouch for anyone, so it enrolls no one. The collaborators
 * are yielded when a method runs.
 */
export class Enrollment extends Context.Service<Enrollment, EnrollmentShape>()(
    'fleet/Enrollment'
) {
    static readonly live = class EnrollmentImpl implements EnrollmentShape {
        describe(token: string): ReturnType<EnrollmentShape['describe']> {
            return Effect.gen(function* () {
                yield* authorize(token)
                // No cluster id or CIDR to hand over: the token names the swarm, and the joiner's agent joins it directly.
                return {
                    version: DEPLOYER_VERSION,
                    meshNetwork: null,
                } satisfies MeshEnrollmentDescribeResult
            })
        }

        enroll(
            input: MeshEnrollmentEnrollInput
        ): ReturnType<EnrollmentShape['enroll']> {
            return Effect.gen(function* () {
                yield* authorize(input.token)
                const config = yield* FleetConfig
                const registry = yield* NodeRegistry
                const grants = yield* SwarmGrants

                const databaseUrl = yield* config.databaseUrl()
                if (databaseUrl === null || databaseUrl.length === 0) {
                    return yield* new FleetNotSetUp({
                        reason: 'This node has no database URL to hand over: run its setup first',
                    })
                }
                const ring = yield* config.platformSecretRing()
                if (ring === null || ring.value.length === 0) {
                    return yield* new FleetNotSetUp({
                        reason: 'This node has no platform secret to hand over: run its setup first',
                    })
                }

                const registered = yield* registry.register({
                    nodeId: input.nodeId,
                    serverUrl: input.serverUrl,
                    displayName: input.displayName ?? null,
                })
                const swarmGrant = yield* grants.grantFor(
                    input.requestedSwarmPolicy
                )

                return {
                    nodeId: registered.nodeId,
                    enrolledAt: registered.enrolledAt,
                    databaseUrl,
                    platformSecret: ring.value,
                    platformSecretGeneration: ring.generation,
                    platformSecretPrevious: ring.previous.map((entry) => ({
                        ...entry,
                    })),
                    swarmGrant,
                    // The agent token this fleet's own agent vouched for: the joiner keeps it if it ever has to repeat the join.
                    meshJoinToken: input.token,
                } satisfies MeshEnrollmentEnrollResult
            })
        }
    }
}
