import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { makeSwarmBootstrap } from './swarm-bootstrap'

import type { SwarmParticipationShape } from '../participation/swarm-participation'

const snapshot = {
    localNodeState: 'active',
    nodeCount: 1,
    managerCount: 1,
    master: null,
    localNode: { swarmRole: 'manager', availability: 'active' },
}

function participation(overrides: { done?: boolean; fail?: boolean } = {}) {
    const converge = vi.fn(() =>
        overrides.fail
            ? Effect.fail(new Error('no cluster') as never)
            : Effect.succeed(snapshot as never)
    )
    const shape = {
        converge,
        setupDone: () => Effect.succeed(overrides.done ?? true),
        effectiveConfig: () => Effect.succeed({ policy: 'auto' } as never),
    } as unknown as SwarmParticipationShape
    return { shape, converge }
}

describe('SwarmBootstrap', () => {
    it('converges at boot only when this app may and setup is done', async () => {
        const { shape, converge } = participation()
        await Effect.runPromise(makeSwarmBootstrap(shape, true).onBoot)
        expect(converge).toHaveBeenCalledTimes(1)

        const disabled = participation()
        await Effect.runPromise(
            makeSwarmBootstrap(disabled.shape, false).onBoot
        )
        expect(disabled.converge).not.toHaveBeenCalled()

        const notDone = participation({ done: false })
        await Effect.runPromise(makeSwarmBootstrap(notDone.shape, true).onBoot)
        expect(notDone.converge).not.toHaveBeenCalled()
    })

    it('never fails: a failed convergence only degrades', async () => {
        const { shape } = participation({ fail: true })

        await expect(
            Effect.runPromise(makeSwarmBootstrap(shape, true).converge('setup'))
        ).resolves.toBeUndefined()
    })
})
