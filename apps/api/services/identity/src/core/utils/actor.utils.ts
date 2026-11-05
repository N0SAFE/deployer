import type { Actor as CurrentActor } from '@deployer/effect-core'

/** The caller, as resolved by the BFF and forwarded over the service boundary. */
export type Actor = {
    readonly userId: string
    readonly role: string
}

/** The oRPC context shape `requireAuth()` guarantees. */
export type AuthenticatedContext = {
    auth: {
        user: {
            id: string
            role?: string | null
        }
    }
}

/**
 * Resolve the domain actor from an oRPC context.
 *
 * Every service controller repeats this cast otherwise; the domain never sees
 * a session, a cookie or a request.
 */
export function actorFromContext(context: AuthenticatedContext): Actor {
    return {
        userId: context.auth.user.id,
        role: context.auth.user.role ?? 'user',
    }
}

/**
 * The domain actor for the effect-core `CurrentActor`.
 *
 * A system actor has no platform role, so it gets the role `"system"`, which no rule treats as an
 * administrator: a component that needs to act on users must be granted that explicitly.
 */
export function actorFromCurrent(actor: CurrentActor): Actor {
    return actor.kind === 'user'
        ? { userId: actor.id, role: actor.role }
        : { userId: actor.id, role: 'system' }
}
