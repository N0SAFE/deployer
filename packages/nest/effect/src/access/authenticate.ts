import { middlewareGen } from '@orpc/effect'
import { Context, Effect, Layer } from 'effect'

import { domainError, type Actor, CurrentActor } from '@deployer/effect-core'
import {
    actorFromContext,
    catchDomainErrors,
    type RequestContextInput,
} from '@deployer/effect-orpc'

/** Nobody validated is calling. A typed failure raised by the middleware itself, before any handler or service runs. */
export class Unauthenticated extends domainError('Unauthenticated', 'unauthorized')() {
    override publicMessage(): string {
        return 'Authentication required'
    }
}

/**
 * Who is calling, decided from the request. A service, not a function: another credential kind (an API key, a mesh peer, a
 * system claim) is another implementation of the same tag, and a spec swaps it with a Layer instead of faking a session.
 */
export class Authentication extends Context.Service<
    Authentication,
    {
        readonly actorOf: (
            request: RequestContextInput
        ) => Effect.Effect<Actor, Unauthenticated>
    }
>()('access/Authentication') {
    /** The request's verified session (what `requireAuth()` reads today): no session, no actor. */
    static readonly session = Layer.succeed(Authentication, {
        actorOf: (request) => {
            const actor = actorFromContext(request)
            return actor === null
                ? Effect.fail(new Unauthenticated({}))
                : Effect.succeed(actor)
        },
    })
}

/** What an authenticating middleware needs from the request's Effect context. */
type AuthenticationContext = RequestContextInput & {
    readonly 'effect/context': Context.Context<Authentication>
}

/**
 * Validate the caller, and let validation be what grants the actor.
 *
 * The middleware is an Effect (`middlewareGen`): it asks `Authentication`, fails with `Unauthenticated` before anything
 * downstream runs, and provides `CurrentActor` to everything after it. There is no anonymous fallback: a handler reaches an
 * actor only through this, so code that needs one cannot be reached without having been validated.
 */
export function authenticated() {
    return middlewareGen<AuthenticationContext>(function* ({ context, next }) {
        // The refusal is the middleware's own typed failure, mapped by kind to a 401 like any domain error; whatever
        // `next()` fails with (the handler's, already mapped) passes through untouched.
        const actor = yield* catchDomainErrors(
            Effect.gen(function* () {
                const authentication = yield* Authentication
                return yield* authentication.actorOf(context)
            })
        )
        return yield* next().pipe(Effect.provideService(CurrentActor, actor))
    })
}
