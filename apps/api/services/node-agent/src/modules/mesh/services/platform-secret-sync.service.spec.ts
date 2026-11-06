import { DatabaseSync } from 'node:sqlite'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { AgentStore, agentStoreOver } from '../../../local/agent-store'
import { NodeState } from '../../node/services/node-state.service'

import { NodeAgents } from './node-agents.service'
import { NodeIdentity } from './node-identity.service'
import { PlatformSecretSync } from './platform-secret-sync.service'
import { GossipSettings } from './roster-gossip.service'

const NODE_ID = '0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f60'

type PeerAnswer = object | 'down' | 'slow'

/** An agent whose own record holds `own`, with peers that answer, fail or never answer. */
async function nodeWith(
    own: { platformSecret: string | null; generation: number } | null,
    peers: Record<string, PeerAnswer>
) {
    const store = agentStoreOver(new DatabaseSync(':memory:') as never)
    const identity = { nodeId: 'self' }
    const nodeAgents = {
        known: () =>
            Effect.succeed(
                Object.keys(peers).map((nodeId) => ({
                    nodeId,
                    address: `ws://${nodeId}`,
                    overlay: null,
                    labels: {},
                }))
            ),
        linkTo: (nodeId: string) =>
            Effect.succeed({
                call: () => {
                    const answer = peers[nodeId]
                    if (answer === 'down') return Promise.reject(new Error('refused'))
                    if (answer === 'slow') return new Promise(() => undefined)
                    return Promise.resolve(answer)
                },
            }),
    }
    const state = new NodeState.live()
    const provide = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
        Effect.runPromise(
            (effect as Effect.Effect<A, unknown>).pipe(
                Effect.provideService(AgentStore, store),
                Effect.provideService(NodeIdentity, identity),
                Effect.provideService(NodeState, state as never),
                Effect.provideService(NodeAgents, nodeAgents as never),
                Effect.provideService(GossipSettings, { fanout: 0, callTimeoutMs: 50 })
            ) as Effect.Effect<A>
        )
    if (own !== null) {
        await provide(
            state.configure({
                nodeId: NODE_ID,
                strategy: 'local',
                platformSecret: own.platformSecret,
                platformSecretGeneration: own.generation,
            } as never)
        )
    }
    return {
        round: () => provide(new PlatformSecretSync.live().round()),
        ring: async () => (await provide(state.state())).config,
    }
}

const ring = (generation: number, value: string, previous: { generation: number; value: string }[] = []) => ({
    ring: { generation, value, previous },
})

describe('PlatformSecretSync', () => {
    it('adopts the highest generation a peer holds, keeping its own as an earlier one', async () => {
        const node = await nodeWith({ platformSecret: 'mine-g1', generation: 1 }, {
            b: ring(2, 'two', [{ generation: 1, value: 'mine-g1' }]),
            c: ring(3, 'three', [{ generation: 2, value: 'two' }]),
        })

        expect(await node.round()).toBe(true)
        expect(await node.ring()).toMatchObject({
            platformSecret: 'three',
            platformSecretGeneration: 3,
            platformSecretPrevious: [
                { generation: 2, value: 'two' },
                { generation: 1, value: 'mine-g1' },
            ],
        })
    })

    it('does nothing when no peer is ahead, and never goes back', async () => {
        const node = await nodeWith({ platformSecret: 'mine-g3', generation: 3 }, {
            b: ring(2, 'two'),
            c: ring(3, 'someone-elses-three'),
        })

        expect(await node.round()).toBe(false)
        expect(await node.ring()).toMatchObject({ platformSecret: 'mine-g3', platformSecretGeneration: 3 })
    })

    it('counts a peer that is down, slow, or answers nonsense for nothing', async () => {
        const node = await nodeWith({ platformSecret: 'mine-g1', generation: 1 }, {
            b: 'down',
            c: 'slow',
            d: { ring: { generation: 'high', value: 1 } },
            e: ring(2, 'two'),
        })

        expect(await node.round()).toBe(true)
        expect(await node.ring()).toMatchObject({ platformSecretGeneration: 2 })
    })

    it('does not create a node record on an unconfigured node', async () => {
        const node = await nodeWith(null, { b: ring(2, 'two') })

        expect(await node.round()).toBe(false)
        expect((await node.ring())).toBeNull()
    })

    it('takes a ring from a peer when this node holds none yet', async () => {
        const node = await nodeWith({ platformSecret: null, generation: 1 }, { b: ring(1, 'fleet-one') })

        expect(await node.round()).toBe(true)
        expect(await node.ring()).toMatchObject({ platformSecret: 'fleet-one' })
    })
})
