import { Cause, Effect, Exit, Fiber, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import z from 'zod/v4'

import { SupervisorEventBus } from '../events/event-bus'
import { baseSupervisorPayloadSchema } from '../schemas/probe'
import { baseSupervisorProcessInfoSchema } from '../schemas/process-info'

import { withBackoff } from './backoff'
import { supervisorIdentifier } from './identifier'
import { makeSupervisor } from './supervisor'

import type { SupervisorSpec } from './spec'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

const payload = () => ({ checkedAt: new Date().toISOString(), latencyMs: 3 })

function spec(
    overrides: Partial<
        SupervisorSpec<
            typeof baseSupervisorPayloadSchema,
            typeof baseSupervisorProcessInfoSchema
        >
    > = {}
) {
    return {
        id: 'test-supervisor',
        description: 'a test resource',
        payloadSchema: baseSupervisorPayloadSchema,
        processInfoSchema: baseSupervisorProcessInfoSchema,
        converge: Effect.void,
        probe: Effect.succeed({ healthy: true, payload: payload() }),
        degradedPayload: () => payload(),
        processInfo: Effect.succeed({}),
        ...overrides,
    } satisfies SupervisorSpec<
        typeof baseSupervisorPayloadSchema,
        typeof baseSupervisorProcessInfoSchema
    >
}

describe('makeSupervisor', () => {
    it('starts idle, converges, and reports healthy', async () => {
        const supervisor = makeSupervisor(spec())
        expect((await run(supervisor.getStateSnapshot)).state).toBe('idle')

        expect(await run(supervisor.ensureDesiredState)).toBe('converged')
        const health = await run(supervisor.getHealth)

        expect(health).toEqual(
            expect.objectContaining({
                healthy: true,
                state: 'converged',
                warnings: [],
            })
        )
    })

    it('turns a failed convergence into degraded, with a warning, instead of failing', async () => {
        const supervisor = makeSupervisor(
            spec({ converge: Effect.fail(new Error('engine down')) })
        )

        expect(await run(supervisor.ensureDesiredState)).toBe('degraded')
        const health = await run(supervisor.getHealth)

        expect(health.healthy).toBe(false)
        expect(health.detail).toBe('engine down')
        expect(health.warnings).toEqual([
            'test-supervisor: convergence degraded — engine down',
        ])
    })

    it('defers to pending, without converging, while a blocker holds', async () => {
        const converge = vi.fn(() => Effect.void)
        const supervisor = makeSupervisor(
            spec({
                converge: Effect.suspend(converge),
                blocker: Effect.succeed('no swarm yet'),
            })
        )

        expect(await run(supervisor.ensureDesiredState)).toBe('pending')
        const health = await run(supervisor.getHealth)

        expect(converge).not.toHaveBeenCalled()
        expect(health).toEqual(
            expect.objectContaining({
                healthy: false,
                state: 'pending',
                detail: 'no swarm yet',
            })
        )
    })

    it('reports a failing probe as unhealthy with the degraded payload', async () => {
        const supervisor = makeSupervisor(
            spec({ probe: Effect.fail(new Error('socket unreachable')) })
        )
        await run(supervisor.ensureDesiredState)

        const health = await run(supervisor.getHealth)

        expect(health.healthy).toBe(false)
        expect(health.detail).toBe('socket unreachable')
    })

    it('rejects a probe payload that does not satisfy the schema', async () => {
        const bad = {
            healthy: true,
            payload: { checkedAt: 'not a date', latencyMs: -1 },
        }
        const supervisor = makeSupervisor(spec({ probe: Effect.succeed(bad) }))
        await run(supervisor.ensureDesiredState)

        // The invalid payload is a probe failure: reported as unhealthy with the degraded payload.
        expect((await run(supervisor.getHealth)).healthy).toBe(false)
    })

    it('merges the process fragment into validated process info', async () => {
        const processSchema = baseSupervisorProcessInfoSchema.extend({
            port: z.number(),
        })
        const supervisor = makeSupervisor({
            ...spec(),
            processInfoSchema: processSchema,
            processInfo: Effect.succeed({ port: 8080 }),
        })
        await run(supervisor.ensureDesiredState)

        const info = await run(supervisor.getProcessInfo)

        expect(info).toEqual(
            expect.objectContaining({
                supervisorId: 'test-supervisor',
                port: 8080,
                healthy: true,
            })
        )
    })

    it('publishes state changes, the reconcile and health snapshots on the bus', async () => {
        const bus = await run(SupervisorEventBus.live)
        const supervisor = makeSupervisor(spec(), { bus })

        const types = await run(
            Effect.gen(function* () {
                const listener = yield* Effect.forkDetach(
                    bus.events.pipe(
                        Stream.take(4),
                        Stream.map((event) => event.type),
                        Stream.runCollect
                    )
                )
                yield* Effect.sleep(10)
                yield* supervisor.ensureDesiredState
                yield* supervisor.getHealthAndNotify
                return yield* Fiber.join(listener)
            })
        )

        expect([...types]).toEqual([
            'state-changed',
            'state-changed',
            'reconciled',
            'health-snapshot',
        ])
    })
})

describe('supervisorIdentifier', () => {
    it('is the base for a single instance and a stable, distinct hash per instance', () => {
        expect(supervisorIdentifier('platform-redis')).toBe('platform-redis')
        const a = supervisorIdentifier('db', { prefix: 'acme' })
        expect(a).toBe(supervisorIdentifier('db', { prefix: 'acme' }))
        expect(a).not.toBe(supervisorIdentifier('db', { prefix: 'other' }))
        expect(a).toMatch(/^db:[0-9a-f]{12}$/)
    })
})

describe('withBackoff', () => {
    const noWait = () => Effect.void

    it('retries until the attempt succeeds', async () => {
        let calls = 0
        const attempt = Effect.suspend(() =>
            ++calls < 3
                ? Effect.fail(new Error('not yet'))
                : Effect.succeed('done')
        )

        expect(await run(withBackoff('x', attempt, { sleep: noWait }))).toBe(
            'done'
        )
        expect(calls).toBe(3)
    })

    it('fails with the last error once the attempts run out', async () => {
        const attempt = Effect.fail(new Error('still broken'))

        await expect(
            run(withBackoff('x', attempt, { maxAttempts: 2, sleep: noWait }))
        ).rejects.toThrow('still broken')
    })

    it('does not retry a fatal error', async () => {
        let calls = 0
        const attempt = Effect.suspend(() => {
            calls += 1
            return Effect.fail(new Error('port in use'))
        })

        await expect(
            run(
                withBackoff('x', attempt, {
                    isFatal: () => true,
                    sleep: noWait,
                })
            )
        ).rejects.toThrow('port in use')
        expect(calls).toBe(1)
    })

    it('doubles the wait up to the ceiling', async () => {
        const waits: number[] = []
        const sleep = (ms: number) => Effect.sync(() => void waits.push(ms))

        await run(
            withBackoff('x', Effect.fail(new Error('no')), {
                maxAttempts: 5,
                baseDelayMs: 100,
                maxDelayMs: 300,
                sleep,
            })
        ).catch(() => undefined)

        expect(waits).toEqual([100, 200, 300, 300])
    })
})
