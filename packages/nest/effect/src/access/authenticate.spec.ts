import '@orpc/effect/extensions/effect'

import { oc } from '@orpc/contract'
import { call } from '@orpc/server'
import { Context, Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import z from 'zod/v4'

import { Actor, CurrentActor } from '@deployer/effect-core'
import type { RequestContextInput } from '@deployer/effect-orpc'

import { procedure } from '../requirements'

import { Authentication, authenticated, Unauthenticated } from './authenticate'

const contract = oc.input(z.object({}))

/** What the request carries: an Effect context holding the authentication service, and the session fields the boundary reads. */
type Ctx = RequestContextInput & {
    readonly 'effect/context': Context.Context<Authentication>
}

const withAuthentication = (
    actorOf: (typeof Authentication)['Service']['actorOf']
): Ctx['effect/context'] => Context.make(Authentication, { actorOf })

const whoAmI = () =>
    procedure<typeof contract, Ctx>(contract)
        .use(authenticated())
        .effect(function* () {
            const actor = yield* CurrentActor
            return actor.id
        })

describe('authenticated() is an Effect that grants the actor', () => {
    it('provides the actor the Authentication service validated, not one the boundary invented', async () => {
        // the request says `u1`; the service says `validated`: the handler must see what validation decided
        const context: Ctx = {
            auth: { user: { id: 'u1', role: 'user' } },
            'effect/context': withAuthentication(() =>
                Effect.succeed(Actor.user('validated', 'admin'))
            ),
        }
        await expect(call(whoAmI(), {}, { context })).resolves.toBe('validated')
    })

    it('fails with a typed 401 before the handler runs, when nothing validates', async () => {
        let ran = false
        const guarded = procedure<typeof contract, Ctx>(contract)
            .use(authenticated())
            .effect(function* () {
                ran = true
                yield* Effect.void
                return 1
            })
        const context: Ctx = {
            'effect/context': withAuthentication(() => Effect.fail(new Unauthenticated({}))),
        }
        await expect(call(guarded, {}, { context })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
        expect(ran).toBe(false)
    })

    it('uses the session layer: no session is no actor, a verified session is the actor', async () => {
        const session = await Effect.runPromise(
            Effect.gen(function* () {
                return yield* Authentication
            }).pipe(Effect.provide(Authentication.session))
        )
        const context = (auth?: RequestContextInput['auth']): Ctx => ({
            ...(auth === undefined ? {} : { auth }),
            'effect/context': withAuthentication(session.actorOf),
        })
        await expect(call(whoAmI(), {}, { context: context() })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        })
        await expect(
            call(whoAmI(), {}, { context: context({ user: { id: 'u7', role: 'user' } }) })
        ).resolves.toBe('u7')
    })
})
