import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { SwarmBootstrap } from './swarm-bootstrap'

import {
    SwarmParticipation,
    type SwarmParticipationShape,
} from '../participation/swarm-participation'

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
    /** The members yield `SwarmParticipation`, so every run provides it — the same act the app runtime does. */
    const withParticipation = <A, E>(
        effect: Effect.Effect<A, E, SwarmParticipation>,
        shape: SwarmParticipationShape
    ): Effect.Effect<A, E> =>
        Effect.provideService(effect, SwarmParticipation, shape)

    it('converges at boot only when this app may and setup is done', async () => {
        const { shape, converge } = participation()
        await Effect.runPromise(
            withParticipation(new SwarmBootstrap.live(true).onBoot, shape)
        )
        expect(converge).toHaveBeenCalledTimes(1)

        const disabled = participation()
        await Effect.runPromise(
            withParticipation(
                new SwarmBootstrap.live(false).onBoot,
                disabled.shape
            )
        )
        expect(disabled.converge).not.toHaveBeenCalled()

        const notDone = participation({ done: false })
        await Effect.runPromise(
            withParticipation(
                new SwarmBootstrap.live(true).onBoot,
                notDone.shape
            )
        )
        expect(notDone.converge).not.toHaveBeenCalled()
    })

    it('never fails: a failed convergence only degrades', async () => {
        const { shape } = participation({ fail: true })

        await expect(
            Effect.runPromise(
                withParticipation(
                    new SwarmBootstrap.live(true).converge('setup'),
                    shape
                )
            )
        ).resolves.toBeUndefined()
    })

    it('resolves the participation per call, so one instance serves any runtime', async () => {
        const first = participation()
        const second = participation()
        const bootstrap = new SwarmBootstrap.live(true)

        await Effect.runPromise(
            withParticipation(bootstrap.converge('boot'), first.shape)
        )
        await Effect.runPromise(
            withParticipation(bootstrap.converge('boot'), second.shape)
        )

        expect(first.converge).toHaveBeenCalledTimes(1)
        expect(second.converge).toHaveBeenCalledTimes(1)
    })
})
