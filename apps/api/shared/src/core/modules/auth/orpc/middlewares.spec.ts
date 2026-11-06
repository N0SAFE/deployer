import { oc } from '@orpc/contract'
import { call } from '@orpc/server'
import { Context, Effect } from 'effect'
import { describe, expect, expectTypeOf, it } from 'vitest'
import z from 'zod/v4'

import { CurrentActor } from '@deployer/effect-core'
import { procedure, type RequiredBy } from '@deployer/nest-effect'

import { signSystemActorClaim, SYSTEM_ACTOR_HEADER } from '../system-actor'

import { AuthUtils, AuthUtilsEmpty } from './auth-utils'
import {
    publicAccess,
    requireAuth,
    requirePlatformRole,
    requireSystemActor,
} from './middlewares'
import { PlatformSecret, type PlatformSecretShape } from './secrets'
import { SessionResolver, type SessionResolverShape } from './session-resolver'
import { assertAuthenticated } from './types'

import type { UserSession } from './auth-utils'

/**
 * The auth middlewares are Effects whose dependencies are services, so every case supplies them with a Context (what a Layer
 * builds) and calls the real procedure: the same path a request takes, with nothing mocked but the credential sources.
 */
const contract = oc.input(z.object({}))

const sessionOf = (id: string, role = 'user'): UserSession =>
    ({
        session: { id: `session-${id}` },
        user: { id, role },
    }) as unknown as UserSession

const sessions = (found: UserSession | null): SessionResolverShape => ({
    resolve: () => Effect.succeed(found),
})
/** The platform secret ring: the current value first, then the earlier generations still accepted. */
const ring = (current: string | null, ...earlier: string[]): PlatformSecretShape => ({
    get: () => Effect.succeed(current),
    accepted: () => Effect.succeed(current === null ? [] : [current, ...earlier]),
})

type Services = SessionResolver | PlatformSecret

/** A request as the host builds it: a real `Request`, and `auth` anonymous until a middleware resolves the session. */
const request = (headers: Record<string, string> = {}) => ({
    request: new Request('http://service.test/rpc', { headers }),
    auth: new AuthUtilsEmpty(),
})

const world = (options: {
    session?: UserSession | null
    platform?: string | null
    /** Earlier generations of the platform secret that are still accepted. */
    earlier?: string[]
}): Context.Context<Services> =>
    Context.make(SessionResolver, sessions(options.session ?? null)).pipe(
        Context.add(PlatformSecret, ring(options.platform ?? null, ...(options.earlier ?? [])))
    )

describe('requireAuth', () => {
    const whoAmI = () =>
        procedure(contract)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const actor = yield* CurrentActor
                return { actor: actor.id, via: context.auth.user.id }
            })

    it('resolves the session through SessionResolver and provides the actor it validated', async () => {
        const context = { ...request(), 'effect/context': world({ session: sessionOf('u1', 'admin') }) }
        await expect(call(whoAmI(), {}, { context })).resolves.toEqual({ actor: 'u1', via: 'u1' })
    })

    it('uses a session the request already carries, without asking again', async () => {
        const asked: string[] = []
        const resolver: SessionResolverShape = {
            resolve: () => {
                asked.push('resolve')
                return Effect.succeed(null)
            },
        }
        const context = {
            ...request(),
            auth: assertAuthenticated(new AuthUtils(sessionOf('u2'))),
            'effect/context': Context.make(SessionResolver, resolver),
        }
        await expect(call(whoAmI(), {}, { context })).resolves.toEqual({ actor: 'u2', via: 'u2' })
        expect(asked).toEqual([])
    })

    it('fails with a typed 401 before the handler when there is no session', async () => {
        let ran = false
        const guarded = procedure(contract)
            .use(requireAuth())
            .effect(function* () {
                ran = true
                yield* Effect.void
                return 1
            })
        const context = { ...request(), 'effect/context': world({ session: null }) }
        await expect(call(guarded, {}, { context })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
        expect(ran).toBe(false)
    })

    it('treats a failed session lookup as no session, not as a 500', async () => {
        const failing: SessionResolverShape = {
            resolve: () => Effect.fail({ _tag: 'SessionLookupFailed', cause: 'db down' } as never),
        }
        const context = { ...request(), 'effect/context': Context.make(SessionResolver, failing) }
        await expect(call(whoAmI(), {}, { context })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })
})

describe('publicAccess', () => {
    const open = () =>
        procedure(contract)
            .use(publicAccess())
            .effect(function* ({ context }) {
                yield* Effect.void
                return context.auth.isLoggedIn
            })

    it('lets an anonymous caller through with the empty auth face', async () => {
        const context = { ...request(), 'effect/context': world({ session: null }) }
        await expect(call(open(), {}, { context })).resolves.toBe(false)
    })

    it('still knows the caller when there is a session', async () => {
        const context = { ...request(), 'effect/context': world({ session: sessionOf('u3') }) }
        await expect(call(open(), {}, { context })).resolves.toBe(true)
    })
})

describe('requirePlatformRole', () => {
    const admin = () =>
        procedure(contract)
            .use(requireAuth())
            .use(requirePlatformRole(['admin', 'superAdmin']))
            .effect(function* () {
                yield* Effect.void
                return 'ok' as const
            })

    it('allows a holder of an allowed role and refuses everyone else with 403', async () => {
        const as = (role: string) => ({
            ...request(),
            'effect/context': world({ session: sessionOf('u', role) }),
        })
        await expect(call(admin(), {}, { context: as('admin') })).resolves.toBe('ok')
        await expect(call(admin(), {}, { context: as('viewer') })).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: expect.stringContaining('admin, superAdmin'),
        })
    })
})

describe('requireSystemActor', () => {
    const hook = () =>
        procedure(contract)
            .use(requireSystemActor('runtime'))
            .effect(function* ({ context }) {
                const actor = yield* CurrentActor
                return { actor: actor.kind, source: context.systemActor.source }
            })
    const as = (
        headers: Record<string, string>,
        platform: string | null = 'platform-secret-platform',
        earlier: string[] = []
    ) => ({
        ...request(headers),
        'effect/context': world({ platform, earlier }),
    })

    it('provides the system actor a verified claim stands for', async () => {
        const token = signSystemActorClaim({ source: 'github-push', aud: 'runtime' }, 'platform-secret-platform')
        await expect(
            call(hook(), {}, { context: as({ [SYSTEM_ACTOR_HEADER]: token }) })
        ).resolves.toEqual({ actor: 'system', source: 'github-push' })
    })

    it('still accepts a claim signed under the generation before a rotation, and refuses one from a retired generation', async () => {
        const beforeRotation = signSystemActorClaim({ source: 'github-push', aud: 'runtime' }, 'older-platform-secret')
        await expect(
            call(hook(), {}, { context: as({ [SYSTEM_ACTOR_HEADER]: beforeRotation }, 'platform-secret-platform', ['older-platform-secret']) })
        ).resolves.toEqual({ actor: 'system', source: 'github-push' })
        await expect(
            call(hook(), {}, { context: as({ [SYSTEM_ACTOR_HEADER]: beforeRotation }) })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('answers 401 for a missing, forged or wrongly addressed claim, and 403 without a platform secret', async () => {
        const good = signSystemActorClaim({ source: 's', aud: 'runtime' }, 'platform-secret-platform')
        const wrongAudience = signSystemActorClaim({ source: 's', aud: 'fleet' }, 'platform-secret-platform')
        const attempts: Record<string, string>[] = [
            {},
            { [SYSTEM_ACTOR_HEADER]: `${good}x` },
            { [SYSTEM_ACTOR_HEADER]: wrongAudience },
        ]
        for (const headers of attempts) {
            await expect(call(hook(), {}, { context: as(headers) })).rejects.toMatchObject({
                code: 'UNAUTHORIZED',
            })
        }
        await expect(
            call(hook(), {}, { context: as({ [SYSTEM_ACTOR_HEADER]: good }, null) })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
})

describe('dependencies are checked, not assumed', () => {
    it('carries the services each middleware needs into the procedure\'s requirements', () => {
        const authed = procedure(contract).use(requireAuth()).effect(function* () { yield* Effect.void; return 1 })
        const system = procedure(contract).use(requireSystemActor('x')).effect(function* () { yield* Effect.void; return 1 })
        const requirements = <P>(_p: P) => expectTypeOf<RequiredBy<P>>()
        requirements(authed).toEqualTypeOf<SessionResolver>()
        requirements(system).toEqualTypeOf<PlatformSecret>()
    })
})
