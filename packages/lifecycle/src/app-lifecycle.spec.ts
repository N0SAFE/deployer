import { Effect, Fiber, Stream } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeAppLifecycle } from './app-lifecycle'
import { AppLifecyclePhase, BootstrapStep } from './phases'

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe('AppLifecycle', () => {
    it('starts initialized with no step, error or metadata', () => {
        const state = makeAppLifecycle().stateNow()
        expect(state).toEqual({
            phase: AppLifecyclePhase.INITIALIZED,
            step: null,
            error: null,
            metadata: {},
        })
    })

    it('transition moves the phase, clears the step and merges metadata', async () => {
        const lifecycle = makeAppLifecycle()
        await run(lifecycle.enterStep(BootstrapStep.DATABASE))
        await run(
            lifecycle.transition(AppLifecyclePhase.PROBING, {
                message: 'probing',
                attempt: 1,
            })
        )
        const state = await run(lifecycle.state)
        expect(state.phase).toBe(AppLifecyclePhase.PROBING)
        expect(state.step).toBeNull()
        expect(state.metadata).toEqual({ attempt: 1 })
    })

    it('keeps the last error across later transitions and records new ones', () => {
        const lifecycle = makeAppLifecycle()
        lifecycle.markErrorNow('db down')
        lifecycle.transitionNow(AppLifecyclePhase.DEGRADED)
        expect(lifecycle.stateNow().error).toBe('db down')
        lifecycle.transitionNow(AppLifecyclePhase.ERROR, { error: 'worse' })
        expect(lifecycle.stateNow().error).toBe('worse')
    })

    it('markDatabaseProbe and markMeshConnected change metadata and tell subscribers', async () => {
        const lifecycle = makeAppLifecycle()
        const seen = Effect.runFork(
            lifecycle.events.pipe(Stream.take(2), Stream.runCollect)
        )
        await Promise.resolve()
        lifecycle.markDatabaseProbeNow('postgres://x', false)
        lifecycle.markMeshConnectedNow(true)
        const events = Array.from(await run(Fiber.join(seen)))
        expect(events.map((event) => event.message)).toEqual([
            'Database unreachable',
            'Mesh connected',
        ])
        expect(lifecycle.stateNow().metadata).toEqual({
            databaseUrl: 'postgres://x',
            databaseReachable: false,
            meshConnected: true,
        })
    })

    it('only delivers changes from the moment of subscription', async () => {
        const lifecycle = makeAppLifecycle()
        lifecycle.markReadyNow()
        const seen = Effect.runFork(
            lifecycle.events.pipe(Stream.take(1), Stream.runCollect)
        )
        await Promise.resolve()
        lifecycle.markErrorNow('boom')
        const [event] = Array.from(await run(Fiber.join(seen)))
        expect(event?.phase).toBe(AppLifecyclePhase.ERROR)
        expect(event?.error).toBe('boom')
    })

    it('snapshots the state with the default message for the phase', async () => {
        const lifecycle = makeAppLifecycle()
        lifecycle.markErrorNow('nope')
        const snapshot = await run(lifecycle.snapshot)
        expect(snapshot.message).toBe('Bootstrap failed: nope')
        expect(snapshot.error).toBe('nope')
    })
})
