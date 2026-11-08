import { Context, Effect, Layer } from 'effect'

import type {
    MeshSwarmJoinGrant,
    SwarmNodePolicy,
} from '@deployer/contracts-entities'

import {
    SwarmCluster,
    type SwarmClusterShape,
} from '../cluster/swarm-cluster'
import type { DockerError } from '@deployer/docker'

import { SwarmTimeout, SwarmUnavailable } from '../errors'
import {
    SwarmJoinConfigService,
    SwarmParticipationDefaultsService,
    type SwarmJoinConfig,
    type SwarmParticipationDefaults,
} from '../config'

import { decideRole, quorumTarget } from './join-decision'

export type SwarmJoinGrantShape = {
    /**
     * The fleet's answer to "may this joining node become a manager?": the join tokens and the role it is
     * granted, or null when there is no converged swarm to join. Never fails: a fleet that cannot produce
     * a grant leaves the joiner converging later (its supervisors degrade with a clear reason) instead of
     * failing its whole setup. The decision order: no converged swarm, no grant; "worker" asked, worker
     * granted; "manager" or "auto" is a candidate admitted to quorum only while the fleet benefits.
     */
    readonly buildGrant: (
        requested: SwarmNodePolicy | undefined
    ) => Effect.Effect<MeshSwarmJoinGrant | null>
    readonly decideRole: typeof decideRole
}

/** The FLEET's role decision for a joining node: a node cannot promote itself into the Raft quorum. */
/**
 * The one implementation of `SwarmJoinGrantShape`.
 *
 * A NAMED class: this package emits declarations, and TS4094 forbids private members on an
 * anonymous exported class. All three collaborators are constructor arguments.
 */
class SwarmJoinGrantImpl implements SwarmJoinGrantShape {
    private readonly cluster: SwarmClusterShape
    /** The quorum cap, supplied as data: which variables name it is an app convention. */
    private readonly config: SwarmJoinConfig
    private readonly participation: SwarmParticipationDefaults

    constructor(deps: {
        readonly cluster: SwarmClusterShape
        readonly config: SwarmJoinConfig
        readonly participation: SwarmParticipationDefaults
    }) {
        this.cluster = deps.cluster
        this.config = deps.config
        this.participation = deps.participation
    }

    private reachable(addrs: string[]): string[] {
        return addrs.filter(
            (addr) => !addr.startsWith('127.') && !addr.startsWith('0.0.0.0')
        )
    }

    /**
     * Where a joiner reaches the control plane: the addresses its MANAGERS advertise, read from the
     * engine, the only set guaranteed to be where it listens. A lone cluster founded before the node
     * had a mesh address advertises loopback, which no joiner can dial, so it is re-anchored onto the
     * mesh address first.
     */
    private get controlPlaneAddrs(): Effect.Effect<
        string[],
        SwarmTimeout | SwarmUnavailable | DockerError
    > {
        const { cluster, participation } = this
        return Effect.gen({ self: this }, function* () {
            const first = this.reachable(yield* cluster.managerAddresses())
            if (first.length > 0) return first
            const mesh = yield* (
                participation.meshAddress ?? Effect.succeed(null)
            ).pipe(Effect.catch(() => Effect.succeed(null)))
            if (mesh === null) return []
            yield* cluster.reanchorLoneCluster(mesh)
            return this.reachable(yield* cluster.managerAddresses())
        })
    }

    buildGrant(
        requested: SwarmNodePolicy | undefined
    ): Effect.Effect<MeshSwarmJoinGrant | null> {
        const inner = this.buildGrantInner(requested)
        return Effect.fn('SwarmJoinGrant.buildGrant')(function* () {
            return yield* inner.pipe(
                Effect.catch((error: { message: string }) =>
                    Effect.logWarning(
                        `Swarm join grant unavailable: ${error.message}`
                    ).pipe(Effect.as(null))
                )
            )
        })()
    }

    private buildGrantInner(
        requested: SwarmNodePolicy | undefined
    ): Effect.Effect<
        MeshSwarmJoinGrant | null,
        SwarmTimeout | SwarmUnavailable | DockerError
    > {
        const { cluster, config } = this
        return Effect.gen({ self: this }, function* () {
                const snapshot = yield* cluster.getLocalClusterSnapshot()
                if (snapshot.localNodeState !== 'active') {
                    yield* Effect.logInfo(
                        `No swarm join grant — this node's engine is ${snapshot.localNodeState} (not an active cluster)`
                    )
                    return null
                }
                const tokens = yield* cluster.getJoinTokens()
                if (tokens === null) {
                    yield* Effect.logWarning(
                        'No swarm join grant — the cluster reports no join tokens'
                    )
                    return null
                }
                const { target, warning } = quorumTarget(config.quorumMax)
                if (warning !== null) yield* Effect.logWarning(warning)
                const { role, reason } = decideRole({
                    requested,
                    managerCount: snapshot.managerCount,
                    target,
                })
                const controlPlaneAddrs = yield* this.controlPlaneAddrs
                if (controlPlaneAddrs.length === 0) {
                    yield* Effect.logWarning(
                        'No swarm join grant — no control-plane address could be resolved for the joiner'
                    )
                    return null
                }
                yield* Effect.logInfo(
                    `Swarm join grant: role=${role} (requested=${requested ?? 'auto'}, managers=${String(snapshot.managerCount)}/${String(target)}) — ${reason}`
                )
                return {
                    workerToken: tokens.worker,
                    managerToken: role === 'manager' ? tokens.manager : null,
                    controlPlaneAddrs,
                    role,
                    reason,
                } satisfies MeshSwarmJoinGrant
        })
    }

    readonly decideRole = decideRole
}

export class SwarmJoinGrant extends Context.Service<
    SwarmJoinGrant,
    SwarmJoinGrantShape
>()('swarm/SwarmJoinGrant') {
    static readonly layer: Layer.Layer<
        SwarmJoinGrant,
        never,
        | SwarmCluster
        | SwarmJoinConfigService
        | SwarmParticipationDefaultsService
    > = Layer.effect(
        SwarmJoinGrant,
        Effect.gen(function* () {
            return new SwarmJoinGrant.live({
                cluster: yield* SwarmCluster,
                config: yield* SwarmJoinConfigService,
                participation: yield* SwarmParticipationDefaultsService,
            })
        })
    )

    /** The implementation: it owns the three collaborators. */
    static readonly live = SwarmJoinGrantImpl
}
