import { middlewareGen, type MiddlewareGenOptions } from '@orpc/effect'
import { Effect } from 'effect'

import { catchDomainErrors } from '@deployer/effect-orpc'

import type { Marked } from './requirements'
import type { ErrorMap } from '@orpc/contract'
import type {
    Context as OrpcContext,
    Middleware,
    MiddlewareResult,
    ORPCErrorConstructorMap,
} from '@orpc/server'
import type { Context } from 'effect'

/** What `middlewareGen` reads its dependencies from: the request's Effect context, typed by what the middleware needs. */
type WithServices<Deps> = { readonly 'effect/context': Context.Context<Deps> }

/**
 * An oRPC middleware written as an Effect, whose dependencies are CHECKED instead of assumed.
 *
 * `middlewareGen` constrains a middleware's yields by the `effect/context` the procedure's context declares, which real
 * controllers do not declare (it is an untyped slot filled at request time). So the generator is typed against exactly the
 * services it needs (`Deps`), and the middleware that comes out carries them as a requirement in its output context
 * (`Marked<Deps>`), the same marker `.effect()` handlers use. The module then has to provide them, or it does not compile:
 * `Missing<[Controller, SessionResolver]>` instead of a "service not found" at the first request.
 *
 * Failures are the Effect's own: a typed domain error raised here is mapped by kind like any other, before the handler.
 *
 * The one assertion lives here, once: the generator is built for `WithServices<Deps>` and offered to procedures whose
 * context is wider (index signatures, other keys), which is what `Middleware<object, …>` says.
 */
export function effectMiddleware<
    Deps,
    Out extends OrpcContext = object,
    In = unknown,
>(
    body: (
        options: MiddlewareGenOptions<WithServices<Deps>, unknown, ORPCErrorConstructorMap<ErrorMap>>,
        input: In
    ) => Generator<Effect.Effect<unknown, unknown, Deps>, MiddlewareResult<Out, unknown>, never>
): Middleware<object, Out & Marked<Deps>, In, unknown, ErrorMap> {
    // A typed domain failure raised by the body (Unauthenticated, Forbidden, …) is mapped by kind to its oRPC error here, once,
    // so no middleware repeats it; whatever `next()` fails with (the handler's, already mapped) passes through untouched.
    return middlewareGen<WithServices<Deps>, Out, In, unknown>(function* (options, input) {
        return yield* catchDomainErrors(Effect.gen(() => body(options, input)))
    }) as Middleware<
        object,
        Out & Marked<Deps>,
        In,
        unknown,
        ErrorMap
    >
}
