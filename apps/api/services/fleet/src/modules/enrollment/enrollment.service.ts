import { Context, Effect } from 'effect'

import type {
    MeshEnrollmentDescribeResult,
    MeshEnrollmentEnrollInput,
    MeshEnrollmentEnrollResult,
} from '@deployer/contracts-entities'
import { domainError, serviceOver, type Over } from '@deployer/effect-core'
import { DEPLOYER_VERSION } from '@deployer/shared/core/utils/deployer-version'

import {
    FleetConfig,
    JoinTokenVoucher,
    NodeRegistry,
    SwarmGrants,
    type FleetConfigShape,
    type JoinTokenVoucherShape,
    type NodeRegistryShape,
    type SwarmGrantsShape,
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

type Collaborators = {
    readonly voucher: JoinTokenVoucherShape
    readonly grants: SwarmGrantsShape
    readonly config: FleetConfigShape
    readonly registry: NodeRegistryShape
}

/**
 * Takes a node that holds a join token into the fleet.
 *
 * The token is the authorization: only the agent holds the swarm's credential, so the fleet asks its own agent whether the
 * token is the swarm's and still good. A node with no agent cannot vouch for anyone, so it enrolls no one.
 */
const makeEnrollment = ({ voucher, grants, config, registry }: Collaborators) => {
    const authorize = (token: string) =>
        Effect.gen(function* () {
            if ((yield* voucher.check(token)) !== true) {
                return yield* new JoinTokenInvalid({})
            }
        })

    return {
        describe: Effect.fn('Enrollment.describe')(function* (token: string) {
            yield* authorize(token)
            // No cluster id or CIDR to hand over: the token names the swarm, and the joiner's agent joins it directly.
            return { version: DEPLOYER_VERSION, meshNetwork: null } satisfies MeshEnrollmentDescribeResult
        }),

        enroll: Effect.fn('Enrollment.enroll')(function* (input: MeshEnrollmentEnrollInput) {
            yield* authorize(input.token)

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
            const swarmGrant = yield* grants.grantFor(input.requestedSwarmPolicy)

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
            } satisfies MeshEnrollmentEnrollResult
        }),
    }
}

export type EnrollmentShape = Over<
    ReturnType<typeof makeEnrollment>,
    JoinTokenVoucher | SwarmGrants | FleetConfig | NodeRegistry
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class Enrollment extends Context.Service<Enrollment, EnrollmentShape>()(
    'fleet/Enrollment'
) {
    /** The collaborators are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: EnrollmentShape = serviceOver(
        Effect.all({
            voucher: JoinTokenVoucher,
            grants: SwarmGrants,
            config: FleetConfig,
            registry: NodeRegistry,
        }),
        makeEnrollment
    )
}
