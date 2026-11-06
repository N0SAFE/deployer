import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STEP_UP_WINDOW_SECONDS } from '@deployer/auth/authz'
import { Actor, CurrentActor } from '@deployer/effect-core'
import { ForbiddenError } from '@deployer/errors'

import { DatabasePort } from '@identity/core/database/database.port'

import {
    StepUpRepository,
    type StepUpRepositoryShape,
} from './step-up.repository'
import { StepUpService } from './step-up.service'

describe('StepUpService', () => {
    const latestForSession = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        latestForSession.mockImplementation(() => Effect.succeed(null))
    })

    /** The service over a fake repository, run as one actor. */
    const run = (actor: Actor) =>
        StepUpService.live.status().pipe(
            Effect.provideService(StepUpRepository, {
                latestForSession,
            } as unknown as StepUpRepositoryShape),
            Effect.provideService(CurrentActor, actor),
            Effect.provideService(DatabasePort, {} as never)
        )

    it('refuses a system caller: a proof belongs to a session', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(run(Actor.system('scheduler')))
        )

        expect(outcome).toBeInstanceOf(ForbiddenError)
        expect(latestForSession).not.toHaveBeenCalled()
    })

    it('refuses a user actor with no session id', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(run(Actor.user('u1', 'admin')))
        )

        expect(outcome).toBeInstanceOf(ForbiddenError)
    })

    it('answers not stepped up when the session holds no proof inside the window', async () => {
        const status = await Effect.runPromise(
            run(Actor.user('u1', 'admin', 'session-1'))
        )

        expect(status).toMatchObject({
            steppedUp: false,
            critical: false,
            method: null,
            windowSeconds: STEP_UP_WINDOW_SECONDS,
        })
        // The window is what the repository is asked for, not a timestamp the caller supplies.
        const since = latestForSession.mock.calls[0]?.[1] as Date
        expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(
            STEP_UP_WINDOW_SECONDS * 1000
        )
    })

    it('reports a passkey proof as a critical step-up, expiring after the window', async () => {
        const verifiedAt = new Date()
        latestForSession.mockImplementation(() =>
            Effect.succeed({ method: 'passkey', verifiedAt })
        )

        const status = await Effect.runPromise(
            run(Actor.user('u1', 'admin', 'session-1'))
        )

        expect(status).toMatchObject({
            steppedUp: true,
            critical: true,
            method: 'passkey',
        })
        expect(status.expiresAt?.getTime()).toBe(
            verifiedAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000
        )
    })

    it('reports a TOTP proof as a step-up that is NOT critical', async () => {
        latestForSession.mockImplementation(() =>
            Effect.succeed({ method: 'totp', verifiedAt: new Date() })
        )

        const status = await Effect.runPromise(
            run(Actor.user('u1', 'admin', 'session-1'))
        )

        expect(status).toMatchObject({
            steppedUp: true,
            critical: false,
            method: 'totp',
        })
    })

    describe('assertCriticalFor: the session a peer names', () => {
        const forSession = (sessionId: string) =>
            StepUpService.live.assertCriticalFor(sessionId).pipe(
                Effect.provideService(StepUpRepository, {
                    latestForSession,
                } as unknown as StepUpRepositoryShape),
                Effect.provideService(DatabasePort, {} as never)
            )

        it('accepts a session with a passkey proof inside the window', async () => {
            latestForSession.mockImplementation(() =>
                Effect.succeed({ method: 'passkey', verifiedAt: new Date() })
            )

            await expect(Effect.runPromise(forSession('session-1'))).resolves.toBeUndefined()
            expect(latestForSession.mock.calls[0]?.[0]).toBe('session-1')
        })

        it('refuses a session with no proof, or only a TOTP one', async () => {
            expect(await Effect.runPromise(Effect.flip(forSession('session-1')))).toBeInstanceOf(
                ForbiddenError
            )

            latestForSession.mockImplementation(() =>
                Effect.succeed({ method: 'totp', verifiedAt: new Date() })
            )
            expect(await Effect.runPromise(Effect.flip(forSession('session-1')))).toBeInstanceOf(
                ForbiddenError
            )
        })
    })
})
