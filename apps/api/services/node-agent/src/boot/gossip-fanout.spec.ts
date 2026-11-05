import { Effect } from 'effect'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
    type BootedAgent,
    bootAgent,
    peerClient,
    removeDataDir,
} from './boot-agent'

const SECRET = 'mesh-gossip-fanout-spec-secret-at-least-32'

/**
 * The fan-out is a real deployment setting, so it is checked on real agents: A knows B, B knows C, and with a fan-out of
 * one each round asks a single peer. The replica registered on C still reaches A, through B, within a few rounds.
 */
describe('gossip fan-out over real sockets', () => {
    const running: BootedAgent[] = []
    const dirs: string[] = []
    const fanoutOne = { MESH_GOSSIP_FANOUT: '1' }

    afterAll(async () => {
        await Promise.all(
            running.map((agent) => agent.stop().catch(() => undefined))
        )
        dirs.forEach(removeDataDir)
    })

    const boot = async (
        nodeId: string,
        seeds: readonly string[] = []
    ): Promise<BootedAgent> => {
        const agent = await bootAgent({
            pin: { nodeId, secret: SECRET, seeds: [...seeds] },
            env: fanoutOne,
        })
        running.push(agent)
        dirs.push(agent.dataDir)
        return agent
    }

    it("learns a third agent's replica through the chain, one peer per round", async () => {
        const a = await boot('node-a')
        const b = await boot('node-b', [a.ws])
        const c = await boot('node-c', [b.ws])

        await Effect.runPromise(
            peerClient(c, SECRET).directory.register({
                service: 'runtime',
                replicaId: 'runtime-c',
                address: 'ws://127.0.0.1:1/mesh/ws',
            })
        )

        // A never asked C directly as a seed: it learns of C from B, and C's replica arrives over the following rounds.
        await vi.waitFor(
            async () => {
                const resolved = await Effect.runPromise(
                    peerClient(a, SECRET).directory.resolve({
                        service: 'runtime',
                    })
                )
                expect(resolved).toMatchObject({
                    replica: { replicaId: 'runtime-c', nodeId: 'node-c' },
                })
            },
            { timeout: 15_000, interval: 100 }
        )
    }, 60_000)
})
