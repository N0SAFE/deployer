import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { NodeConfigRepositoryShape } from '@deployer/node-state'

import { SystemMeshClusterRepository } from './system-mesh-cluster.repository'

const GRANT_ID = '9f1b7a2e-0b4e-4f6a-9c1d-1f2e3d4c5b6a'
const EXPIRES_AT = new Date('2026-10-30T12:00:00.000Z')

/** Only the one insert chain `issueJoinGrant` uses; everything else is not reached by this call. */
function repository(
    door: {
        issueJoinToken: (
            ttlMs?: number
        ) => Promise<{ token: string; expiresAt: number } | null>
    } | null = null
) {
    return new SystemMeshClusterRepository.live(
        {
            db: {
                insert: () => ({
                    values: () => ({
                        returning: () =>
                            Promise.resolve([
                                { id: GRANT_ID, expiresAt: EXPIRES_AT },
                            ]),
                    }),
                }),
            },
        } as never,
        {
            find: () => Effect.succeed(null),
        } as unknown as NodeConfigRepositoryShape,
        door
    )
}

const input = { issuedByUserId: 'user-1', ttlSeconds: 900 }

describe('issueJoinGrant', () => {
    it("mints the agent's own join token alongside the platform grant", async () => {
        const issueJoinToken = vi.fn(() =>
            Promise.resolve({
                token: 'agent-join-token',
                expiresAt: Date.now() + 900_000,
            })
        )

        const result = await Effect.runPromise(
            repository({ issueJoinToken }).issueJoinGrant(input)
        )

        expect(issueJoinToken).toHaveBeenCalledWith(900_000)
        expect(result).toMatchObject({
            grantId: GRANT_ID,
            expiresAt: EXPIRES_AT.toISOString(),
            meshJoinToken: 'agent-join-token',
        })
        expect(result.grantToken).not.toBe('agent-join-token')
    })

    it('returns no agent token when this node runs no new agent', async () => {
        const issueJoinToken = vi.fn(() => Promise.resolve(null))

        const result = await Effect.runPromise(
            repository({ issueJoinToken }).issueJoinGrant(input)
        )

        expect(result.meshJoinToken).toBeNull()
        expect(issueJoinToken).toHaveBeenCalledWith(900_000)
    })

    it('returns no agent token when the repository has no agent at all', async () => {
        await expect(
            Effect.runPromise(repository(null).issueJoinGrant(input))
        ).resolves.toMatchObject({ meshJoinToken: null })
    })
})
