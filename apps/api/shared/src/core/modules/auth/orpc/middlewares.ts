import { fromNodeHeaders } from 'better-auth/node'
import { Effect } from 'effect'
import z from 'zod/v4'

import { Actor, CurrentActor } from '@deployer/effect-core'
import { actorFromContext } from '@deployer/effect-orpc'
import { effectMiddleware, Forbidden, Unauthenticated } from '@deployer/nest-effect'

import { SYSTEM_ACTOR_HEADER, verifySystemActorClaim } from '../system-actor'

import { AuthUtils, AuthUtilsEmpty } from './auth-utils'
import { PlatformSecret } from './secrets'
import { SessionResolver } from './session-resolver'
import { assertAuthenticated, type ORPCAuthContext } from './types'

/**
 * The auth middlewares, written as Effects (`effectMiddleware`, over `@orpc/effect`'s `middlewareGen`).
 *
 * Each one declares what it needs as a service (`SessionResolver`, `PlatformSecret`), and that need is carried
 * into the procedure's requirements: a service whose module does not provide it fails to compile instead of failing at the
 * first request. A refusal is a typed domain error (`Unauthenticated`, `Forbidden`) mapped to its status by kind.
 *
 * `requireAuth()` and `requireSystemActor()` are also what GRANT the actor: they provide `CurrentActor` to everything after
 * them, so code that needs one cannot be reached without having been validated here.
 */

const headerRecord = z.record(
    z.string(),
    z.union([z.string(), z.array(z.string()), z.undefined()])
)

/** The request's headers as web standard `Headers`, whichever shape the transport handed over. */
function headersOf(context: unknown): Headers | null {
    const request: unknown =
        context !== null && typeof context === 'object'
            ? Reflect.get(context, 'request')
            : undefined
    if (request === null || typeof request !== 'object') return null
    const headers: unknown = Reflect.get(request, 'headers')
    if (headers instanceof Headers) return headers
    const parsed = headerRecord.safeParse(headers)
    return parsed.success ? fromNodeHeaders(parsed.data) : null
}

/** An auth face that is a real session: logged in, with a session and a user. */
function isLoggedIn(value: unknown): value is ORPCAuthContext<true> {
    return (
        value !== null &&
        typeof value === 'object' &&
        Reflect.get(value, 'isLoggedIn') === true &&
        Reflect.get(value, 'session') !== null &&
        Reflect.get(value, 'session') !== undefined &&
        Reflect.get(value, 'user') !== null &&
        Reflect.get(value, 'user') !== undefined
    )
}

/**
 * Who is calling, resolved ONCE per request: a session the request already carries (a test, the BFF's forwarded context)
 * wins; otherwise Better Auth answers through `SessionResolver`. A lookup that fails is "no session", logged, never a 500.
 */
const sessionOf = (context: unknown) =>
    Effect.gen(function* () {
        const existing: unknown =
            context !== null && typeof context === 'object'
                ? Reflect.get(context, 'auth')
                : undefined
        if (isLoggedIn(existing)) return existing
        const headers = headersOf(context)
        if (headers === null) return null
        const sessions = yield* SessionResolver
        const session = yield* sessions.resolve(headers).pipe(
            Effect.catch((failure) =>
                Effect.logWarning(
                    `session lookup failed, treating the caller as anonymous: ${String(failure.cause)}`
                ).pipe(Effect.as(null))
            )
        )
        return session === null ? null : assertAuthenticated(new AuthUtils(session))
    })

/** The `Actor` a verified session stands for, with the same impersonation downgrade the boundary applies. */
const actorOfAuth = (auth: ORPCAuthContext<true>): Actor =>
    actorFromContext({ auth: { user: auth.user, session: auth.session } }) ??
    Actor.user(auth.user.id, auth.user.role ?? 'user', auth.session.id)

/**
 * Require a logged-in caller, and let validation be what grants the actor.
 *
 * Narrows `context.auth` to the authenticated face (non-null `user` and `session`) and provides `CurrentActor`. Without a
 * session it fails with `Unauthenticated` before the handler, or anything after this middleware, runs.
 */
export function requireAuth() {
    return effectMiddleware<SessionResolver, { readonly auth: ORPCAuthContext<true> }>(function* ({
        context,
        next,
    }) {
        const auth = yield* sessionOf(context)
        if (auth === null) return yield* new Unauthenticated({})
        return yield* next({ context: { auth } }).pipe(
            Effect.provideService(CurrentActor, actorOfAuth(auth))
        )
    })
}

/**
 * Mark a procedure as public (no authentication required). `context.auth` is still the caller's session when there is one
 * (`isLoggedIn` may be false), and the actor is provided only when there is one: public code that needs an actor is a
 * requirement nothing satisfies.
 */
export function publicAccess() {
    return effectMiddleware<SessionResolver, { readonly auth: ORPCAuthContext }>(function* ({
        context,
        next,
    }) {
        const auth = yield* sessionOf(context)
        if (auth === null) {
            return yield* next({ context: { auth: new AuthUtilsEmpty() } })
        }
        return yield* next({ context: { auth } }).pipe(
            Effect.provideService(CurrentActor, actorOfAuth(auth))
        )
    })
}

/**
 * Require a SYSTEM ACTOR: a call that no person made (a webhook, a schedule), vouched for by a peer service with a signed
 * claim in `X-Deployer-System-Actor`. Use it instead of `requireAuth()` on a procedure only a peer service should call.
 * It narrows `context.systemActor` to the verified claim and provides the system `CurrentActor`.
 *
 * @param audience - the service name the claim must be addressed to (e.g. `"runtime"`)
 *
 * Failures: `Unauthenticated` (no claim, a bad signature, a wrong audience, an expired claim), `Forbidden` (the platform
 * secret is not configured, so no claim can be verified).
 */
export function requireSystemActor(audience: string) {
    return effectMiddleware<
        PlatformSecret,
        { readonly systemActor: NonNullable<ReturnType<typeof verifySystemActorClaim>> }
    >(function* ({ context, next }) {
        const token = headersOf(context)?.get(SYSTEM_ACTOR_HEADER) ?? null
        if (token === null || token === '') {
            return yield* new Unauthenticated({ reason: 'System actor claim required' })
        }
        const secrets = yield* PlatformSecret
        const accepted = yield* secrets.accepted()
        if (accepted.length === 0) {
            return yield* new Forbidden({ reason: 'Platform secret is not configured' })
        }
        // A claim signed just before a rotation is still good: try every generation that is still accepted.
        let claim: ReturnType<typeof verifySystemActorClaim> = null
        for (const secret of accepted) {
            claim = verifySystemActorClaim(token, secret, audience)
            if (claim !== null) break
        }
        if (claim === null) {
            return yield* new Unauthenticated({
                reason: 'Invalid or expired system actor claim',
            })
        }
        return yield* next({ context: { systemActor: claim } }).pipe(
            Effect.provideService(CurrentActor, Actor.system(claim.source))
        )
    })
}

/**
 * Require specific platform role(s). Use it after `requireAuth()`: the role is read off the authenticated session. A caller
 * with none of the allowed roles fails with `Forbidden`.
 *
 * Interim: roles are data and the code should name permissions (`AUTHZ-024`); this stays until the routes that use it declare
 * a requirement instead.
 */
export function requirePlatformRole(allowedRoles: string[]) {
    return effectMiddleware<never>(function* ({ context, next }) {
        const auth: unknown = Reflect.get(context, 'auth')
        if (!isLoggedIn(auth)) return yield* new Unauthenticated({})
        const role = auth.user.role
        if (role === undefined || !allowedRoles.includes(role)) {
            return yield* new Forbidden({
                reason: `Insufficient permissions. Required role: ${allowedRoles.join(', ')}`,
            })
        }
        return yield* next()
    })
}

