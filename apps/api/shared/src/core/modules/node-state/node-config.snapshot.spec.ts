import { Effect, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    LocalDatabaseError,
    type NodeConfigRepositoryShape,
    type NodeConfigRow,
} from '@deployer/node-state'

import { makeNodeConfigSnapshot } from './node-config.snapshot'

const row = (databaseUrl: string): NodeConfigRow => ({
    id: 1,
    nodeId: 'n1',
    strategy: 'local',
    setupState: 'setup_done',
    deployerVersion: null,
    upgradedAtVersion: null,
    meshUrlsSnapshot: null,
    databaseUrl,
    databaseProvisioning: 'local',
    configuredAt: null,
    peerServiceToken: null,
    peerServiceTokenExpiresAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    meshSharedSecret: null,
    meshSharedSecretUpdatedAt: null,
    platformSecret: null,
    platformSecretUpdatedAt: null,
    platformSecretGeneration: 1,
    platformSecretPrevious: null,
    scanConfig: null,
    postSetupFlags: null,
    swarmConfig: null,
})

/** A repository whose `find` answers the current value, or fails once told to. */
function makeRepository(initial: NodeConfigRow | null) {
    const state = { row: initial, fails: false }
    const find = vi.fn(() =>
        state.fails
            ? Effect.fail(
                  new LocalDatabaseError({
                      operation: 'read node_config',
                      reason: 'unavailable',
                  })
              )
            : Effect.succeed(state.row)
    )
    return {
        repository: { find } as unknown as NodeConfigRepositoryShape,
        find,
        write: (next: NodeConfigRow | null) => {
            state.row = next
        },
        failWith: (fails: boolean) => {
            state.fails = fails
        },
    }
}

describe('NodeConfigSnapshot', () => {
    it('reads null before the first refresh', () => {
        const repo = makeRepository(row('postgres://first'))
        const snapshot = makeNodeConfigSnapshot(repo.repository)

        expect(snapshot.current()).toBeNull()
        expect(repo.find).not.toHaveBeenCalled()
    })

    it('loads the row on refresh', async () => {
        const repo = makeRepository(row('postgres://first'))
        const snapshot = makeNodeConfigSnapshot(repo.repository)

        await Effect.runPromise(snapshot.refresh())

        expect(snapshot.current()?.databaseUrl).toBe('postgres://first')
    })

    it('keeps the previous value when a refresh fails', async () => {
        const repo = makeRepository(row('postgres://first'))
        const snapshot = makeNodeConfigSnapshot(repo.repository)
        await Effect.runPromise(snapshot.refresh())

        repo.failWith(true)

        await expect(
            Effect.runPromise(snapshot.refresh())
        ).resolves.toMatchObject({ databaseUrl: 'postgres://first' })
        expect(snapshot.current()?.databaseUrl).toBe('postgres://first')
    })

    it('sees a later write on the next refresh', async () => {
        const repo = makeRepository(row('postgres://first'))
        const snapshot = makeNodeConfigSnapshot(repo.repository)
        await Effect.runPromise(snapshot.refresh())

        repo.write(row('postgres://second'))
        await Effect.runPromise(snapshot.refresh())

        expect(snapshot.current()?.databaseUrl).toBe('postgres://second')
    })

    it('loads once on start, then refreshes on its own until interrupted', async () => {
        const repo = makeRepository(row('postgres://first'))
        const snapshot = makeNodeConfigSnapshot(repo.repository, {
            refreshIntervalMs: 5,
        })

        await Effect.runPromise(snapshot.onStart?.() ?? Effect.void)
        expect(snapshot.current()?.databaseUrl).toBe('postgres://first')
        expect(repo.find).toHaveBeenCalledTimes(1)

        repo.write(row('postgres://second'))
        const fiber = Effect.runFork(snapshot.run?.() ?? Effect.void)
        await new Promise((resolve) => setTimeout(resolve, 40))
        await Effect.runPromise(Fiber.interrupt(fiber))

        expect(snapshot.current()?.databaseUrl).toBe('postgres://second')
    })
})
