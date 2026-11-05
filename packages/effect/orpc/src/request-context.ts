import { Effect, Option } from 'effect'

import {
    Actor,
    Correlation,
    CurrentActor,
    HttpRequest,
    type Ambient,
} from '@deployer/effect-core'

type HeadersLike =
    | { get(name: string): string | null }
    | Readonly<Record<string, string | readonly string[] | undefined>>

const readHeader = (headers: HeadersLike, name: string): string | undefined => {
    if (typeof (headers as { get?: unknown }).get === 'function') {
        return (
            (headers as { get(name: string): string | null }).get(name) ??
            undefined
        )
    }
    const value = (
        headers as Record<string, string | readonly string[] | undefined>
    )[name]
    return typeof value === 'string' ? value : value?.[0]
}

export const CORRELATION_HEADER = 'x-correlation-id'

/**
 * The slice of an oRPC request context this package reads. Structural on purpose: the package
 * never imports the app's context augmentation, so any service whose context has these fields
 * can use it.
 */
export type RequestContextInput = {
    /** Web `Headers` (fetch hosts) or a plain Node header record (Nest's HTTP adapter). */
    readonly request?: {
        readonly headers: HeadersLike
        /** Present on the Web `Request` the oRPC host hands a handler. */
        readonly method?: string
        readonly url?: string
    }
    readonly auth?: {
        readonly user?: {
            readonly id: string
            readonly role?: string | null
        } | null
        /**
         * The verified session the request arrived on. `id` is what a step-up is bound to; `impersonatedBy` is read to
         * DOWNGRADE the actor (see `actorFromContext`).
         */
        readonly session?: {
            readonly id: string
            readonly impersonatedBy?: string | null
            /** Set by the impersonating admin after a further passkey proof (`DEC-AUTH-25`). */
            readonly impersonationWrites?: boolean | null
        } | null
    }
    readonly systemActor?: {
        readonly kind: 'system'
        readonly source: string
    } | null
}

/** The acting identity: a verified system claim wins over a user session; neither means anonymous. */
export function actorFromContext(context: RequestContextInput): Actor | null {
    if (context.systemActor) return Actor.system(context.systemActor.source)
    const user = context.auth?.user
    if (!user) return null

    // An impersonated session is READ-ONLY by construction (`DEC-AUTH-25`): the platform `viewer` role grants the read
    // capabilities and none of the writes, so no handler has to remember a flag. The web shows the banner from
    // `session.impersonatedBy`; the API re-derives this on every request. Enabling writes is a further passkey proof,
    // recorded on the session — only then does the target's own role apply.
    const session = context.auth.session
    const impersonated = session?.impersonatedBy
    const readOnly =
        impersonated !== null &&
        impersonated !== undefined &&
        session?.impersonationWrites !== true
    return Actor.user(
        user.id,
        readOnly ? 'viewer' : (user.role ?? 'user'),
        session?.id ?? null
    )
}

/** The caller's correlation id, or a fresh one when it sent none. */
export function correlationFromContext(context: RequestContextInput): string {
    const sent = context.request
        ? readHeader(context.request.headers, CORRELATION_HEADER)
        : undefined
    return sent !== undefined && sent !== '' ? sent : crypto.randomUUID()
}

/**
 * Discharge the ambient requirements for one request.
 *
 * `onAnonymous` runs when no actor is present and decides what that means (typically failing
 * `unauthorized`); a public procedure passes an anonymous actor instead.
 */
export const provideRequest =
    <E2>(
        context: RequestContextInput,
        onAnonymous: () => Effect.Effect<Actor, E2>
    ) =>
    <A, E, R>(
        effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | E2, Exclude<R, Ambient>> =>
        Effect.gen(function* () {
            // An actor an earlier middleware already established and provided (`authenticated()`) is the actor: the boundary
            // only falls back to the request's own session when nothing validated one.
            const established = yield* Effect.serviceOption(CurrentActor)
            const actor = Option.isSome(established)
                ? established.value
                : (actorFromContext(context) ?? (yield* onAnonymous()))
            return yield* effect.pipe(
                Effect.provideService(CurrentActor, actor),
                Effect.provideService(Correlation, {
                    id: correlationFromContext(context),
                }),
                // The request itself (`AUTH-0xx`): supplied here, per call, so a handler can `yield* HttpRequest` without
                // the module providing it and without a request-scoped Nest graph. Immutable, so overlapping requests
                // cannot see each other's.
                Effect.provideService(HttpRequest, {
                    headers: context.request?.headers ?? {},
                    method: context.request?.method ?? 'POST',
                    url: context.request?.url ?? '',
                })
            )
        }) as Effect.Effect<A, E | E2, Exclude<R, Ambient>>
