import { Context, Effect } from 'effect'

import type { MeshPlatformSecretRetirement } from '@deployer/node-agent-contracts'

import { AgentStore } from '../../../local/agent-store'
import { SecretRotationRefused } from '../../node/secret-rotation.errors'
import { NodeState } from '../../node/services/node-state.service'

import { AgentLinkFactory } from './agent-link-factory.service'
import { FleetSecrets } from './fleet-secrets.service'
import { NodeAgents } from './node-agents.service'
import { NodeIdentity } from './node-identity.service'
import { GossipSettings } from './roster-gossip.service'

const RETIRE_PATH = ['roster', 'retirePlatformSecret']

type Needs =
    | NodeState
    | FleetSecrets
    | NodeAgents
    | GossipSettings
    | AgentLinkFactory
    | AgentStore
    | NodeIdentity

export type PlatformSecretOpsShape = {
    /** Retires an earlier generation here and on every reachable node, once every reachable node has taken in the current one. */
    readonly retire: (
        generation: number
    ) => Effect.Effect<
        MeshPlatformSecretRetirement,
        | SecretRotationRefused
        | Effect.Error<ReturnType<NodeState['Service']['retirePlatformSecret']>>,
        Needs
    >
}

/**
 * Retiring a generation is the one step of a rotation that can lose data: sealed rows under it stop opening. So it is
 * refused while any node the agent can reach is still on an older generation than the current one (it would be cut off from
 * what the others still write), and it is carried to every reachable node, because a node that kept it would keep accepting
 * what the others have stopped trusting. A node that cannot be reached is reported, not waited for.
 */
export class PlatformSecretOps extends Context.Service<
    PlatformSecretOps,
    PlatformSecretOpsShape
>()('node-agent/PlatformSecretOps') {
    static readonly live = class PlatformSecretOpsImpl
        implements PlatformSecretOpsShape
    {
        retire(generation: number) {
            return Effect.gen(function* () {
                const state = yield* NodeState
                const fleet = yield* FleetSecrets
                const agents = yield* NodeAgents
                const settings = yield* GossipSettings

                const picture = yield* fleet.collect()
                const platform = picture.adoption.find((entry) => entry.id === 'platform')
                const current = platform?.currentGeneration ?? null
                const behind = (platform?.nodes ?? []).filter(
                    (node) =>
                        node.generation !== null &&
                        current !== null &&
                        node.generation < current
                )
                if (behind.length > 0) {
                    return yield* new SecretRotationRefused({
                        reason: `Not every node has taken in the current generation yet (${behind.map((node) => node.nodeId).join(', ')}). Retiring ${String(generation)} now would cut them off.`,
                    })
                }

                const local = yield* state.retirePlatformSecret(generation)

                const reached: string[] = []
                const unreachable: string[] = []
                yield* Effect.forEach(
                    yield* agents.known(),
                    (agent) =>
                        agents.linkTo(agent.nodeId).pipe(
                            Effect.flatMap((link) =>
                                Effect.tryPromise(() =>
                                    link.call(RETIRE_PATH, { generation }, { context: {} })
                                )
                            ),
                            Effect.timeout(settings.callTimeoutMs),
                            Effect.map(() => {
                                reached.push(agent.nodeId)
                            }),
                            Effect.catch(() =>
                                Effect.sync(() => {
                                    unreachable.push(agent.nodeId)
                                })
                            )
                        ),
                    { concurrency: 8 }
                )
                return {
                    generation: local.generation ?? generation,
                    reached,
                    unreachable,
                }
            })
        }
    }
}
