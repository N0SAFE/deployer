import { Actor } from '@deployer/effect-core'
import {
    handle,
    provideRequest,
    type RequestContextInput,
} from '@deployer/effect-orpc'
import { standardErrorActions } from '@deployer/orpc-utils'
import { Cause, Effect } from 'effect'

const logDefect = (
    cause: Cause.Cause<unknown>,
    correlationId: string
): void => {
    console.error(`[svc-identity] defect ${correlationId}`, Cause.pretty(cause))
}

/**
 * Run one use case at the request boundary: provide `CurrentActor` and `Correlation`, map domain
 * errors by kind, hide defects behind the correlation id. A caller with no actor is refused as
 * unauthorized; `requireAuth()` already guarantees one, so this is the belt to its braces.
 */
export const serve =
    (context: RequestContextInput) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
            handle(logDefect),
            provideRequest(context, () =>
                Effect.fail(
                    standardErrorActions.UNAUTHORIZED('authentication required')
                )
            )
        )

/** Like `serve`, for a public procedure: an anonymous caller acts as the `anonymous` user. */
export const serveAnonymous =
    (context: RequestContextInput) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
            handle(logDefect),
            provideRequest(context, () =>
                Effect.succeed(Actor.user('anonymous', 'anonymous'))
            )
        )
