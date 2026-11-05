import { type AnyRouter, createRouterClient } from '@orpc/server'
import { describe, expect, it } from 'vitest'

import { type MeshPeerInfo, peerInfoRouter } from './index'

/** The peer surface called in process: the same handlers, without a socket in the way. */
function clientOf(options: Parameters<typeof peerInfoRouter>[0]) {
    const router = peerInfoRouter(options) as unknown as AnyRouter
    return createRouterClient(router, { context: {} }) as unknown as {
        peers: { info: (input: Record<string, never>) => Promise<MeshPeerInfo> }
    }
}

describe('peerInfoRouter', () => {
    it("answers the replica's own facts: the service, the id it registered under, and the keys it beats with", async () => {
        const client = clientOf({
            service: 'project',
            replicaId: 'project-host-a',
            keys: () => ['project:p-1'],
            env: { NODE_AGENT_SOCKET: '/nowhere/agent.sock' },
        })

        await expect(client.peers.info({})).resolves.toEqual({
            service: 'project',
            replicaId: 'project-host-a',
            nodeId: null,
            load: null,
            keys: ['project:p-1'],
        })
    })

    it('reads the keys at call time, from the provider the heartbeat uses', async () => {
        let held = ['project:p-1']
        const client = clientOf({
            service: 'project',
            replicaId: 'project-host-a',
            keys: async () => held,
            env: { NODE_AGENT_SOCKET: '/nowhere/agent.sock' },
        })

        expect((await client.peers.info({})).keys).toEqual(['project:p-1'])
        held = []
        expect((await client.peers.info({})).keys).toEqual([])
    })

    it('reports no keys when the service announces none', async () => {
        const client = clientOf({
            service: 'health',
            replicaId: 'health-a',
            env: { NODE_AGENT_SOCKET: '/nowhere/agent.sock' },
        })

        expect((await client.peers.info({})).keys).toEqual([])
    })
})
