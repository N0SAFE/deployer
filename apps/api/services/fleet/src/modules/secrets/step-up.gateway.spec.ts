import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { Actor, CurrentActor, provideTo } from '@deployer/effect-core'
import { PlatformSecret } from '@deployer/shared/core/modules/auth/orpc/secrets'
import { verifySystemActorClaim } from '@deployer/shared/core/modules/auth/system-actor/system-actor'

import { SystemActorClients } from '@/core/ports/system-actor-clients.port'

import { StepUpGateway, StepUpRequired, StepUpUnavailable } from './step-up.gateway'

const SECRET = 'a-secret-that-is-long-enough-for-tests'

function gateway(options: {
    actor?: Actor
    secret?: string | null
    identity?: () => Promise<unknown>
}) {
    const assertCritical = vi.fn(options.identity ?? (() => Promise.resolve({ critical: true })))
    const systemActorClientFor = vi.fn(() => ({ assertCritical }))
    const service = provideTo(
        StepUpGateway.live,
        (effect) =>
            effect.pipe(
                Effect.provideService(SystemActorClients, { systemActorClientFor } as never),
                Effect.provideService(PlatformSecret, {
                    get: () => Effect.succeed(options.secret === undefined ? SECRET : options.secret),
                    accepted: () => Effect.succeed([SECRET]),
                }),
                Effect.provideService(CurrentActor, options.actor ?? Actor.user('u1', 'superAdmin', 'session-1'))
            ) as Effect.Effect<unknown>
    )
    return { run: () => Effect.runPromiseExit(service.assertCritical()), systemActorClientFor, assertCritical }
}

const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined)

describe('StepUpGateway', () => {
    it('asks identity as the system, with a claim that names the caller\'s session', async () => {
        const world = gateway({})

        const exit = await world.run()

        expect(Exit.isSuccess(exit)).toBe(true)
        const [service, , token] = world.systemActorClientFor.mock.calls[0] as unknown as [string, unknown, string]
        expect(service).toBe('identity')
        expect(verifySystemActorClaim(token, SECRET, 'identity')).toMatchObject({
            source: 'fleet-secrets',
            subject: 'session-1',
        })
    })

    it("refuses with identity's own sentence when the session has not stepped up", async () => {
        const world = gateway({
            identity: () =>
                Promise.reject(
                    Object.assign(new Error('step-up required: verify with a passkey and retry'), {
                        code: 'FORBIDDEN',
                    })
                ),
        })

        const error = failure(await world.run())

        expect(error).toBeInstanceOf(StepUpRequired)
        expect((error as StepUpRequired).publicMessage()).toContain('passkey')
    })

    it('fails closed when identity does not answer', async () => {
        const world = gateway({ identity: () => Promise.reject(new Error('connection refused')) })

        expect(failure(await world.run())).toBeInstanceOf(StepUpUnavailable)
    })

    it('refuses a caller that is not a user session, and a node with no secret to sign with', async () => {
        expect(failure(await gateway({ actor: Actor.system('scheduler') }).run())).toBeInstanceOf(
            StepUpRequired
        )
        const noSecret = gateway({ secret: null })
        expect(failure(await noSecret.run())).toBeInstanceOf(StepUpUnavailable)
        expect(noSecret.assertCritical).not.toHaveBeenCalled()
    })
})
