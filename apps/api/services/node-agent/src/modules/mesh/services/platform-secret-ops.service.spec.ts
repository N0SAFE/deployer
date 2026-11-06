import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { MeshFleetSecrets } from '@deployer/node-agent-contracts'

import { NodeState } from '../../node/services/node-state.service'

import { FleetSecrets } from './fleet-secrets.service'
import { NodeAgents } from './node-agents.service'
import { PlatformSecretOps } from './platform-secret-ops.service'
import { GossipSettings } from './roster-gossip.service'

const picture = (generations: Record<string, number | null>): MeshFleetSecrets => ({
    nodes: [],
    adoption: [
        {
            id: 'platform',
            current: 'f',
            currentGeneration: Math.max(...Object.values(generations).map((g) => g ?? 0)),
            nodes: Object.entries(generations).map(([nodeId, generation]) => ({
                nodeId,
                fingerprint: 'f',
                generation,
                adoptedAt: null,
                status: 'current' as const,
            })),
        },
    ],
})

function ops(generations: Record<string, number | null>, peers: Record<string, 'down' | 'ok'>) {
    const retireLocal = vi.fn(() => Effect.succeed({ generation: 3 }))
    const called: string[] = []
    const nodeAgents = {
        known: () =>
            Effect.succeed(
                Object.keys(peers).map((nodeId) => ({ nodeId, address: `ws://${nodeId}`, overlay: null, labels: {} }))
            ),
        linkTo: (nodeId: string) =>
            Effect.succeed({
                call: () => {
                    called.push(nodeId)
                    return peers[nodeId] === 'down'
                        ? Promise.reject(new Error('refused'))
                        : Promise.resolve({ generation: 3 })
                },
            }),
    }
    const run = () =>
        Effect.runPromiseExit(
            new PlatformSecretOps.live().retire(1).pipe(
                Effect.provideService(NodeState, { retirePlatformSecret: retireLocal } as never),
                Effect.provideService(FleetSecrets, { collect: () => Effect.succeed(picture(generations)) } as never),
                Effect.provideService(NodeAgents, nodeAgents as never),
                Effect.provideService(GossipSettings, { fanout: 0, callTimeoutMs: 50 })
            // The fakes need nothing from the link factory, the store or the identity: those requirements are only types here.
            ) as unknown as Effect.Effect<{ generation: number; reached: string[]; unreachable: string[] }, { _tag: string }>
        )
    return { run, retireLocal, called }
}

describe('PlatformSecretOps.retire', () => {
    it('retires here and on every reachable node, and reports the one it could not reach', async () => {
        const world = ops({ self: 3, b: 3, c: 3 }, { b: 'ok', c: 'down' })

        const exit = await world.run()

        expect(exit._tag).toBe('Success')
        expect(world.retireLocal).toHaveBeenCalledWith(1)
        expect(world.called.sort()).toEqual(['b', 'c'])
        if (exit._tag === 'Success') {
            expect(exit.value).toMatchObject({ reached: ['b'], unreachable: ['c'] })
        }
    })

    it('refuses while a reachable node has not taken in the current generation, and changes nothing', async () => {
        const world = ops({ self: 3, b: 2 }, { b: 'ok' })

        const exit = await world.run()

        expect(exit._tag).toBe('Failure')
        expect(JSON.stringify(exit)).toContain('SecretRotationRefused')
        expect(world.retireLocal).not.toHaveBeenCalled()
        expect(world.called).toEqual([])
    })
})
