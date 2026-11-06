import { Context, Effect } from 'effect'

import {
    mergePlatformSecretRing,
    platformSecretRingSchema,
    type PlatformSecretRingValue,
} from '@deployer/node-agent-contracts'

import { AgentStore } from '../../../local/agent-store'
import { NodeState } from '../../node/services/node-state.service'

import { AgentLinkFactory } from './agent-link-factory.service'
import { NodeAgents } from './node-agents.service'
import { NodeIdentity } from './node-identity.service'
import { GossipSettings } from './roster-gossip.service'

const PATH = ['roster', 'platformSecret']
const PEER_CONCURRENCY = 8

export type PlatformSecretSyncShape = {
    /**
     * Looks at the peers' platform secret rings and adopts the highest generation this node is behind. True when it changed.
     * A peer that does not answer, or answers with something that is not a ring, counts for nothing.
     */
    readonly round: () => Effect.Effect<
        boolean,
        never,
        | NodeState
        | NodeAgents
        | GossipSettings
        | AgentLinkFactory
        | AgentStore
        | NodeIdentity
    >
}

/**
 * How a rotation spreads (SEC-101): no node is the source of truth, so an agent that finds a peer on a higher generation
 * pulls that peer's ring and takes it in. It runs after each gossip round, so a rotation reaches every reachable node within
 * a few rounds, and a node that was offline catches up the moment it is seen again.
 *
 * Only a node that is already configured adopts one: creating a node record is the setup flow's act, never a side effect of
 * gossip.
 */
export class PlatformSecretSync extends Context.Service<
    PlatformSecretSync,
    PlatformSecretSyncShape
>()('node-agent/PlatformSecretSync') {
    static readonly live = class PlatformSecretSyncImpl
        implements PlatformSecretSyncShape
    {
        round() {
            return Effect.gen(function* () {
                const state = yield* NodeState
                const agents = yield* NodeAgents
                const settings = yield* GossipSettings

                const { config } = yield* state
                    .state()
                    .pipe(Effect.catch(() => Effect.succeed({ config: null })))
                if (config === null) return false
                const local: PlatformSecretRingValue | null =
                    config.platformSecret === null
                        ? null
                        : {
                              generation: config.platformSecretGeneration,
                              value: config.platformSecret,
                              previous: config.platformSecretPrevious,
                          }

                const answers = yield* Effect.forEach(
                    yield* agents.known(),
                    (agent) =>
                        agents.linkTo(agent.nodeId).pipe(
                            Effect.flatMap((link) =>
                                Effect.tryPromise(() =>
                                    link.call(PATH, {}, { context: {} })
                                )
                            ),
                            Effect.timeout(settings.callTimeoutMs),
                            Effect.map((answer) => {
                                const ring = platformSecretRingSchema
                                    .nullable()
                                    .safeParse(
                                        typeof answer === 'object' &&
                                            answer !== null &&
                                            'ring' in answer
                                            ? answer.ring
                                            : undefined
                                    )
                                return ring.success ? ring.data : null
                            }),
                            Effect.catch(() => Effect.succeed(null))
                        ),
                    { concurrency: PEER_CONCURRENCY }
                )

                // The highest generation any peer holds that this node does not.
                const best = answers
                    .filter((ring): ring is PlatformSecretRingValue => ring !== null)
                    .sort((a, b) => b.generation - a.generation)[0]
                if (best === undefined) return false
                const merged = mergePlatformSecretRing(local, best)
                if (merged === null) return false

                yield* state
                    .configure({
                        platformSecret: merged.value,
                        platformSecretUpdatedAt: new Date().toISOString(),
                        platformSecretGeneration: merged.generation,
                        platformSecretPrevious: merged.previous.map((entry) => ({
                            ...entry,
                        })),
                    })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                yield* Effect.logInfo(
                    `Adopted platform secret generation ${String(merged.generation)} from a peer`
                )
                return true
            })
        }
    }
}
