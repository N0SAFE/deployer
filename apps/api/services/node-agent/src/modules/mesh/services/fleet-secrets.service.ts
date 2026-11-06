import { Context, Effect } from 'effect'

import {
    meshNodeSecretsSchema,
    type MeshFleetSecrets,
} from '@deployer/node-agent-contracts'

import { AgentStore } from '../../../local/agent-store'
import { adoptionOf } from '../../node/secret-inventory'
import { NodeState } from '../../node/services/node-state.service'

import { AgentLinkFactory } from './agent-link-factory.service'
import { NodeAgents } from './node-agents.service'
import { NodeIdentity } from './node-identity.service'
import { GossipSettings } from './roster-gossip.service'

/** Asks the peers at most this many at once: the fleet is small, and a slow one must not hold the rest. */
const PEER_CONCURRENCY = 8

export type FleetSecretsShape = {
    /** This node's inventory and every reachable peer's, compared. An unreachable peer is listed, never hidden. */
    readonly collect: () => Effect.Effect<
        MeshFleetSecrets,
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
 * The fleet's picture of its secrets, assembled by the agent, because only an agent can call another agent.
 *
 * Nothing is trusted from a peer beyond its shape: an answer is parsed, and one that does not parse counts as no answer.
 * A peer that is slow or down is `reachable: false` with no secrets, so a missing node is visible rather than quietly
 * absent from the comparison.
 */
export class FleetSecrets extends Context.Service<FleetSecrets, FleetSecretsShape>()(
    'node-agent/FleetSecrets'
) {
    static readonly live = class FleetSecretsImpl implements FleetSecretsShape {
        collect() {
            return Effect.gen(function* () {
                const state = yield* NodeState
                const agents = yield* NodeAgents
                const settings = yield* GossipSettings

                const own = yield* state.secrets().pipe(
                    Effect.catch(() =>
                        Effect.succeed({ agentId: 'self', secrets: [] })
                    )
                )
                const known = yield* agents.known()

                const peers = yield* Effect.forEach(
                    known,
                    (agent) =>
                        agents.linkTo(agent.nodeId).pipe(
                            Effect.flatMap((link) =>
                                Effect.tryPromise(() =>
                                    link.call(['roster', 'secrets'], {}, { context: {} })
                                )
                            ),
                            Effect.timeout(settings.callTimeoutMs),
                            Effect.map((answer) => meshNodeSecretsSchema.safeParse(answer)),
                            Effect.map((parsed) =>
                                parsed.success
                                    ? {
                                          nodeId: agent.nodeId,
                                          reachable: true,
                                          secrets: parsed.data.secrets,
                                      }
                                    : { nodeId: agent.nodeId, reachable: false, secrets: [] }
                            ),
                            Effect.catch(() =>
                                Effect.succeed({
                                    nodeId: agent.nodeId,
                                    reachable: false,
                                    secrets: [],
                                })
                            )
                        ),
                    { concurrency: PEER_CONCURRENCY }
                )

                const nodes = [
                    { nodeId: own.agentId, reachable: true, secrets: own.secrets },
                    ...peers,
                ]
                // An unreachable peer says nothing, so it must not count as "missing": only nodes that answered are compared.
                return {
                    nodes,
                    adoption: adoptionOf(nodes.filter((node) => node.reachable)),
                }
            })
        }
    }
}
