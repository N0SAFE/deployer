import { Context, Effect, Layer } from 'effect'

import {
    SwarmParticipation,
    type SwarmParticipationShape,
} from '../participation/swarm-participation'

export type SwarmBootstrapShape = {
    /**
     * Converges the cluster from the PERSISTED participation. The setup flow calls it as its final step
     * and the app calls it again at boot for an already-set-up node. Never fails: a failed convergence
     * degrades the supervisors, it does not crash the platform.
     */
    readonly converge: (trigger: 'boot' | 'setup') => Effect.Effect<void>
    /**
     * Converges at boot when this app may and setup is done; otherwise says why it did not. Whether THIS
     * app converges at boot depends on who owns the cluster decision: the API must re-converge on restart
     * so its supervisors have a swarm to schedule onto, whereas setup FOUNDS the cluster inside an
     * operator-driven flow and would otherwise touch the engine on every restart before anything was
     * triggered, then converge a second time from the trigger itself.
     */
    readonly onBoot: Effect.Effect<void>
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
    static readonly layer = (options: {
        readonly convergeOnBoot: boolean
    }): Layer.Layer<SwarmBootstrap, never, SwarmParticipation> =>
        Layer.effect(
            SwarmBootstrap,
            Effect.gen(function* () {
                return makeSwarmBootstrap(
                    yield* SwarmParticipation,
                    options.convergeOnBoot
                )
            })
        )
}

export function makeSwarmBootstrap(
    participation: SwarmParticipationShape,
    convergeOnBoot: boolean
): SwarmBootstrapShape {
    const converge: SwarmBootstrapShape['converge'] = Effect.fn(
        'SwarmBootstrap.converge'
    )(function* (trigger) {
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
    })

    const onBoot = Effect.gen(function* () {
        if (!convergeOnBoot) {
            return yield* Effect.logInfo(
                'Swarm boot convergence is disabled for this app — the cluster is converged by its own flow, not at startup'
            )
        }
        const done = yield* participation
            .setupDone()
            .pipe(Effect.orElseSucceed(() => false))
        if (!done) {
            return yield* Effect.logInfo(
                'Swarm convergence deferred until setup — the cluster entry mode (create vs join) and role policy are decided during setup'
            )
        }
        yield* converge('boot')
    })

    return { converge, onBoot }
}
