import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { MeshFleetSecrets, MeshNodeSecret } from '@deployer/node-agent-contracts'

import { NodeState } from '../../node/services/node-state.service'

import { FleetSecrets } from './fleet-secrets.service'
import { NodeAgents } from './node-agents.service'
import { GossipSettings } from './roster-gossip.service'

const secret = (fingerprint: string | null): MeshNodeSecret => ({
    id: 'platform',
    purpose: 'p',
    fingerprint,
    generation: null,
    adoptedAt: null,
    consumers: [],
})

type PeerAnswer = object | 'down' | 'slow'

/** An agent with its own inventory and peers that answer, fail, or never answer. */
function collect(own: MeshNodeSecret[], peers: Record<string, PeerAnswer>) {
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
    return Effect.runPromise(
        new FleetSecrets.live().collect().pipe(
            Effect.provideService(NodeState, {
                secrets: () => Effect.succeed({ agentId: 'self', secrets: own }),
            } as never),
            Effect.provideService(NodeAgents, nodeAgents as never),
            Effect.provideService(GossipSettings, { fanout: 0, callTimeoutMs: 50 })
        // The fakes need nothing from the link factory, the store or the identity: those requirements are only types here.
        ) as unknown as Effect.Effect<MeshFleetSecrets>
    )
}

describe('FleetSecrets', () => {
    it('lists this node first and compares it with every peer that answers', async () => {
        const result = await collect([secret('f1')], {
            b: { agentId: 'b', secrets: [secret('f1')] },
            c: { agentId: 'c', secrets: [secret('f0')] },
        })

        expect(result.nodes.map((node) => node.nodeId)).toEqual(['self', 'b', 'c'])
        const statuses = Object.fromEntries(
            result.adoption[0]?.nodes.map((node) => [node.nodeId, node.status]) ?? []
        )
        expect(statuses).toEqual({ self: 'current', b: 'current', c: 'stale' })
    })

    it('lists a peer that is down or slow as unreachable and leaves it out of the comparison', async () => {
        const result = await collect([secret('f1')], {
            b: 'down',
            c: 'slow',
            d: { agentId: 'd', secrets: [secret('f1')] },
        })

        expect(result.nodes.map((node) => [node.nodeId, node.reachable])).toEqual([
            ['self', true],
            ['b', false],
            ['c', false],
            ['d', true],
        ])
        expect(result.adoption[0]?.nodes.map((node) => node.nodeId)).toEqual(['self', 'd'])
    })

    it('counts an answer that is not an inventory as no answer', async () => {
        const result = await collect([secret('f1')], { b: { nonsense: true } })

        expect(result.nodes[1]).toMatchObject({ nodeId: 'b', reachable: false, secrets: [] })
    })
})
