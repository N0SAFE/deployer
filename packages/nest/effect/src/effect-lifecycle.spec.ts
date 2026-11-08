import { Context, Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    ServiceLifecycleRunner,
    serviceLifecycle,
    type ServiceLifecycleShape,
} from './effect-lifecycle'

import type { EffectHostShape } from './effect-host'

/** A host that records instead of running, so the ordering is observable. */
function recordingHost() {
    const calls: string[] = []
    const host: EffectHostShape = {
        run: async (effect) => {
            calls.push('run')
            return Effect.runPromise(effect as Effect.Effect<never>)
        },
        runUnwrapped: async (effect) => {
            calls.push('runUnwrapped')
            return Effect.runPromise(effect as Effect.Effect<never>)
        },
        fork: (_label, _effect) => {
            calls.push('fork')
            return () => {
                calls.push('interrupt')
                return Promise.resolve()
            }
        },
        context: () =>
            Promise.resolve(Context.empty() as Context.Context<unknown>),
        contextFor: () => Context.empty() as Context.Context<unknown>,
        size: () => 0,
    }
    return { host, calls }
}

const shape = (
    overrides: Partial<ServiceLifecycleShape> = {}
): ServiceLifecycleShape => ({ ...overrides })

describe('ServiceLifecycleRunner', () => {
    it('runs onApplicationBootstrap at application bootstrap, after onModuleInit and the fork', async () => {
        const { host, calls } = recordingHost()
        const runner = new ServiceLifecycleRunner(
            'test/Service',
            shape({
                onModuleInit: () => Effect.void,
                run: () => Effect.never,
                onApplicationBootstrap: () => Effect.void,
            }),
            host
        )

        await runner.onModuleInit()
        await runner.onApplicationBootstrap()

        expect(calls).toEqual(['runUnwrapped', 'fork', 'runUnwrapped'])
    })

    it('runs onModuleInit, then forks run', async () => {
        const { host, calls } = recordingHost()
        const runner = new ServiceLifecycleRunner(
            'test/Service',
            shape({ onModuleInit: () => Effect.void, run: () => Effect.never }),
            host
        )

        await runner.onModuleInit()

        expect(calls).toEqual(['runUnwrapped', 'fork'])
    })

    it('interrupts run before onModuleDestroy, so nothing stops under a live loop', async () => {
        const { host, calls } = recordingHost()
        const runner = new ServiceLifecycleRunner(
            'test/Service',
            shape({ run: () => Effect.never, onModuleDestroy: () => Effect.void }),
            host
        )

        await runner.onModuleInit()
        await runner.onModuleDestroy()

        expect(calls).toEqual(['fork', 'interrupt', 'run'])
    })

    it('does not fork when the shape has no run', async () => {
        const { host, calls } = recordingHost()
        const runner = new ServiceLifecycleRunner(
            'test/Service',
            shape({ onModuleInit: () => Effect.void, onModuleDestroy: () => Effect.void }),
            host
        )

        await runner.onModuleInit()
        await runner.onModuleDestroy()

        expect(calls).toEqual(['runUnwrapped', 'run'])
    })

    it('logs a failing onModuleDestroy instead of failing the shutdown', async () => {
        const { host } = recordingHost()
        const failing = {
            ...host,
            run: vi.fn(async (effect: Effect.Effect<unknown>) =>
                Effect.runPromise(effect)
            ),
        }
        const runner = new ServiceLifecycleRunner(
            'test/Service',
            shape({ onModuleDestroy: () => Effect.fail(new Error('close refused')) }),
            failing as unknown as EffectHostShape
        )

        await expect(runner.onModuleDestroy()).resolves.toBeUndefined()
        expect(failing.run).toHaveBeenCalledTimes(1)
    })

    it('is interruptible: a forked program is reused on every module init cycle', async () => {
        const { host, calls } = recordingHost()
        const runner = new ServiceLifecycleRunner(
            'test/Service',
            shape({ run: () => Effect.never }),
            host
        )

        await runner.onModuleInit()
        await runner.onModuleDestroy()
        await runner.onModuleInit()

        expect(calls).toEqual(['fork', 'interrupt', 'fork'])
    })
})

describe('serviceLifecycle', () => {
    const Outbox = class extends Context.Service<
        never,
        ServiceLifecycleShape & { readonly tick: () => Effect.Effect<void> }
    >()('test/Outbox') {}

    it("binds the tag's instance and the host, under a stable token", () => {
        const provider = serviceLifecycle(Outbox) as {
            provide: symbol
            inject: readonly unknown[]
        }

        expect(provider.provide).toBe(
            Symbol.for('effect-lifecycle:test/Outbox')
        )
        expect(provider.inject).toContain(Outbox)
    })

    it('keeps the token stable across two calls, so a module cannot register two runners', () => {
        const first = serviceLifecycle(Outbox) as { provide: symbol }
        const second = serviceLifecycle(Outbox) as { provide: symbol }

        expect(first.provide).toBe(second.provide)
    })
})

/**
 * Type-level: a shape with no lifecycle member is refused.
 *
 * A compile check, not a test — the `@ts-expect-error` fails the build the day the constraint stops holding.
 */
describe("serviceLifecycle's shape constraint", () => {
    it('refuses a tag whose shape declares no lifecycle', () => {
        const Plain = class extends Context.Service<
            never,
            { readonly ping: () => Effect.Effect<void> }
        >()('test/Plain') {}

        // The gate is the compiler: `@ts-expect-error` fails this build the day the constraint stops holding. At
        // runtime the provider is ordinary, which is what makes the check free.
        // @ts-expect-error — `serviceLifecycle` requires onModuleInit / run / onModuleDestroy in the shape
        const provider = serviceLifecycle(Plain)

        expect(provider).toBeDefined()
    })
})
