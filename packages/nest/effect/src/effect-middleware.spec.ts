import '@orpc/effect/extensions/effect'

import { oc } from '@orpc/contract'
import { call } from '@orpc/server'
import { Context, Effect } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import z from 'zod/v4'

import { domainError } from '@deployer/effect-core'

import { effectMiddleware } from './effect-middleware'
import { procedure, type RequiredBy } from './requirements'

class Clock2 extends Context.Service<Clock2, { readonly now: () => number }>()('test/Clock2') {}

const contract = oc.input(z.object({}))

const stamped = () =>
    effectMiddleware<Clock2, { readonly stampedAt: number }>(function* ({ next }) {
        const clock = yield* Clock2
        return yield* next({ context: { stampedAt: clock.now() } })
    })

class Refused extends domainError('Refused', 'forbidden')() {}

describe('effectMiddleware', () => {
    const p = () =>
        procedure(contract)
            .use(stamped())
            .effect(function* ({ context }) {
                yield* Effect.void
                return context.stampedAt
            })

    it('runs as an Effect on the request context and hands its output to the handler', async () => {
        const context = { 'effect/context': Context.make(Clock2, { now: () => 42 }) }
        await expect(call(p(), {}, { context })).resolves.toBe(42)
    })

    it('maps a typed domain failure to its oRPC error before the handler runs', async () => {
        let ran = false
        const guard = effectMiddleware<Clock2>(function* () {
            yield* new Refused({})
            return yield* Effect.never
        })
        const refused = procedure(contract)
            .use(guard)
            .effect(function* () {
                ran = true
                yield* Effect.void
                return 1
            })
        const context = { 'effect/context': Context.make(Clock2, { now: () => 0 }) }
        await expect(call(refused, {}, { context })).rejects.toMatchObject({ code: 'FORBIDDEN' })
        expect(ran).toBe(false)
    })

    it('turns its dependencies into a checked requirement of the procedure', () => {
        expectTypeOf<RequiredBy<ReturnType<typeof p>>>().toEqualTypeOf<Clock2>()
    })
})
