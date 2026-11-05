import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DEPLOYER_VERSION } from '../../../utils/deployer-version'
import { MeshPeerUnreachable } from '../mesh.errors'

import { makeMeshVersionService } from './mesh-version.service'

import type { MeshInitializationServiceShape } from '../initialization/services/mesh-initialization.service'

/** Each URL maps to the version its ping reports, or to `null` for an unreachable peer. */
function versions(table: Record<string, string | null>) {
    const mesh = {
        connectToMesh: (url: string) => {
            const version = table[url]
            return version === null || version === undefined
                ? Effect.fail(new MeshPeerUnreachable({ url, reason: 'down' }))
                : Effect.succeed({
                      client: { ping: () => Promise.resolve({ version }) },
                      close: () => Promise.resolve(),
                  })
        },
    } as unknown as MeshInitializationServiceShape
    return makeMeshVersionService(mesh)
}

describe('MeshVersionService', () => {
    it('reports unreachable peers instead of failing', async () => {
        const summary = await Effect.runPromise(
            versions({ a: '1.0.0', b: null }).gatherPeerVersions(['a', 'b'])
        )
        expect(summary).toMatchObject({
            consistent: true,
            meshVersion: '1.0.0',
            reachableCount: 1,
            unreachableCount: 1,
        })
        expect(summary.peers[1]).toMatchObject({
            reachable: false,
            error: 'Cannot reach mesh at b: down',
        })
    })

    it('says there are no peers when none is reachable', async () => {
        expect(
            (
                await Effect.runPromise(
                    versions({ a: null }).compareLocalWithMesh(['a'])
                )
            ).status
        ).toBe('no_peers')
    })

    it('flags an inconsistent mesh', async () => {
        const result = await Effect.runPromise(
            versions({ a: '1.0.0', b: '2.0.0' }).compareLocalWithMesh([
                'a',
                'b',
            ])
        )
        expect(result).toMatchObject({
            status: 'inconsistent_mesh',
            meshVersions: ['1.0.0', '2.0.0'],
        })
    })

    it('is `same` when the mesh runs the local version, `local_ahead` when it runs an older one', async () => {
        expect(
            (
                await Effect.runPromise(
                    versions({ a: DEPLOYER_VERSION }).compareLocalWithMesh([
                        'a',
                    ])
                )
            ).status
        ).toBe('same')
        expect(
            (
                await Effect.runPromise(
                    versions({ a: '0.0.1' }).compareLocalWithMesh(['a'])
                )
            ).status
        ).toBe('local_ahead')
    })

    it('answers null for an unreachable remote and the version for a reachable one', async () => {
        const service = versions({ a: '3.1.0', b: null })
        expect(await Effect.runPromise(service.getRemoteMeshVersion('a'))).toBe(
            '3.1.0'
        )
        expect(
            await Effect.runPromise(service.getRemoteMeshVersion('b'))
        ).toBeNull()
    })
})
