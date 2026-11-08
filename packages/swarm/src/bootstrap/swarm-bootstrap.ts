import { Context, Effect, Layer } from 'effect'

import { SwarmParticipation } from '../participation/swarm-participation'

export type SwarmBootstrapShape = {
    /**
     * Converges the cluster from the PERSISTED participation. The setup flow calls it as its final step
     * and the app calls it again at boot for an already-set-up node. Never fails: a failed convergence
     * degrades the supervisors, it does not crash the platform.
     *
     * It YIELDS `SwarmParticipation`: the run is on the app runtime, whose context carries every
     * Effect-keyed provider, so the dependency is resolved where the work happens instead of being
     * handed to the constructor.
     */
    readonly converge: (
        trigger: 'boot' | 'setup'
    ) => Effect.Effect<void, never, SwarmParticipation>
    /**
     * Converges at boot when this app may and setup is done; otherwise says why it did not. Whether THIS
     * app converges at boot depends on who owns the cluster decision: the API must re-converge on restart
     * so its supervisors have a swarm to schedule onto, whereas setup FOUNDS the cluster inside an
     * operator-driven flow and would otherwise touch the engine on every restart before anything was
     * triggered, then converge a second time from the trigger itself.
     */
    readonly onBoot: Effect.Effect<void, never, SwarmParticipation>
}

/**
 * The one implementation of `SwarmBootstrapShape`.
 *
 * A NAMED class: this package emits declarations, and TS4094 forbids private members on an
 * anonymous exported class.
 *
 * The only field is `convergeOnBoot`, which is genuine per-instance configuration (the API and
 * setup converge differently, and that is decided at module assembly). `SwarmParticipation` is not
 * a field: it is yielded inside each member, so it comes from the runtime that runs the work.
 */
class SwarmBootstrapImpl implements SwarmBootstrapShape {
    private readonly convergeOnBoot: boolean

    constructor(convergeOnBoot: boolean) {
        this.convergeOnBoot = convergeOnBoot
    }

    converge(
        trigger: 'boot' | 'setup'
    ): Effect.Effect<void, never, SwarmParticipation> {
        return Effect.fn('SwarmBootstrap.converge')(function* () {
            const participation = yield* SwarmParticipation
            yield* participation.converge().pipe(
                Effect.matchEffect({
                    onSuccess: (snapshot) =>
                        Effect.gen(function* () {
                            const node = snapshot.localNode
                            yield* Effect.logInfo(
                                `Swarm converged (${trigger}) — state=${snapshot.localNodeState}, role=${node.swarmRole}, availability=${node.availability}, nodes=${String(snapshot.nodeCount)}, managers=${String(snapshot.managerCount)}, master=${snapshot.master?.nodeId ?? 'none'}`
                            )
                            const { policy } = yield* participation
                                .effectiveConfig()
                                .pipe(Effect.orDie)
                            yield* Effect.logInfo(
                                `🐝 Swarm active (policy=${policy}) — every supervised platform service + Deployer workload is scheduled on Swarm`
                            )
                        }),
                    onFailure: (error) =>
                        Effect.logWarning(
                            `Swarm convergence (${trigger}) skipped — engine is not in an active cluster: ${error.message}`
                        ),
                })
            )
        })()
    }

    get onBoot(): Effect.Effect<void, never, SwarmParticipation> {
        const { convergeOnBoot } = this
        return Effect.gen({ self: this }, function* () {
            if (!convergeOnBoot) {
                return yield* Effect.logInfo(
                    'Swarm boot convergence is disabled for this app — the cluster is converged by its own flow, not at startup'
                )
            }
            const participation = yield* SwarmParticipation
            const done = yield* participation
                .setupDone()
                .pipe(Effect.orElseSucceed(() => false))
            if (!done) {
                return yield* Effect.logInfo(
                    'Swarm convergence deferred until setup — the cluster entry mode (create vs join) and role policy are decided during setup'
                )
            }
            yield* this.converge('boot')
        })
    }
}

/**
 * Converges the local engine into Swarm mode AFTER the setup wizard recorded how this node participates.
 *
 * Setup, not boot, because the cluster decision belongs to the operator: a node about to JOIN a fleet
 * must not first invent a cluster of its own, and `docker swarm init` cannot be undone without
 * destroying the local Raft state. The engine stays untouched until setup writes the participation.
 */
export class SwarmBootstrap extends Context.Service<
    SwarmBootstrap,
    SwarmBootstrapShape
>()('swarm/SwarmBootstrap') {
    /**
     * The `Layer` no longer needs `SwarmParticipation`: the service resolves it per call. Only the
     * per-instance flag is supplied here.
     */
    static readonly layer = (options: {
        readonly convergeOnBoot: boolean
    }): Layer.Layer<SwarmBootstrap> =>
        Layer.succeed(
            SwarmBootstrap,
            new SwarmBootstrap.live(options.convergeOnBoot)
        )

    /** The implementation: it owns both collaborators. */
    static readonly live = SwarmBootstrapImpl
}

