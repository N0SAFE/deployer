import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { MeshPeerUnreachable, MeshPeerUrlInvalid } from '../../mesh.errors'

import {
    makeMeshInitializationService,
    type MeshClientFactory,
} from './mesh-initialization.service'

function service(client: {
    ping: () => Promise<unknown>
    getLocalNode: () => Promise<unknown>
}) {
    const createClient = vi.fn(() => client) as unknown as MeshClientFactory &
        ReturnType<typeof vi.fn>
    return { shape: makeMeshInitializationService(createClient), createClient }
}

describe('MeshInitializationService.connectToMesh', () => {
    it("opens a session on the peer's origin after pinging it", async () => {
        const { shape, createClient } = service({
            ping: () => Promise.resolve({ ok: true }),
            getLocalNode: () => Promise.resolve({ nodeId: 'n2' }),
        })

        const session = await Effect.runPromise(
            shape.connectToMesh('https://peer.example.com/some/path', {
                peerServiceToken: 'tok',
            })
        )

        expect(session).toMatchObject({
            remoteNodeId: 'n2',
            remoteBaseUrl: 'https://peer.example.com',
            peerServiceToken: 'tok',
        })
        expect(createClient).toHaveBeenLastCalledWith(
            'https://peer.example.com',
            { 'x-mesh-internal-key': 'tok' }
        )
    })

    it('fails with MeshPeerUrlInvalid for something that is not a URL', async () => {
        const { shape } = service({
            ping: () => Promise.resolve({}),
            getLocalNode: () => Promise.resolve({}),
        })
        expect(
            await Effect.runPromise(Effect.flip(shape.connectToMesh('nope')))
        ).toBeInstanceOf(MeshPeerUrlInvalid)
    })

    it('fails with MeshPeerUnreachable, carrying the reason, when the peer does not answer the ping', async () => {
        const { shape } = service({
            ping: () => Promise.reject(new Error('ECONNREFUSED')),
            getLocalNode: () => Promise.resolve({}),
        })
        const failure = await Effect.runPromise(
            Effect.flip(shape.connectToMesh('https://peer.example.com'))
        )
        expect(failure).toBeInstanceOf(MeshPeerUnreachable)
        expect(failure.publicMessage()).toBe(
            'Cannot reach mesh at https://peer.example.com: ECONNREFUSED'
        )
    })
})
