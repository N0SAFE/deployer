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
 * context is wider (index signatures, other keys). `InContext` is what the middleware requires of the procedure before it
 * (`AuthenticatedContext` for the access checks, so they cannot precede `requireAuth()`).
 */
export function effectMiddleware<
    Deps,
    Out extends OrpcContext = object,
    In = unknown,
    InContext extends OrpcContext = object,
>(
    body: (
        options: MiddlewareGenOptions<WithServices<Deps> & InContext, unknown, ORPCErrorConstructorMap<ErrorMap>>,
        input: In
    ) => Generator<Effect.Effect<unknown, unknown, Deps>, MiddlewareResult<Out, unknown>, never>
): Middleware<InContext, Out & Marked<Deps>, In, unknown, ErrorMap> {
    // A typed domain failure raised by the body (Unauthenticated, Forbidden, …) is mapped by kind to its oRPC error here, once,
    // so no middleware repeats it; whatever `next()` fails with (the handler's, already mapped) passes through untouched.
    const generated = middlewareGen<WithServices<Deps>, Out, In, unknown, ErrorMap>(function* (options, input) {
        // `InContext` is what `.use()` already checked the procedure carries (the type of the middleware says so), so the
        // options a body sees are those of the wider context.
        const seen = options as MiddlewareGenOptions<WithServices<Deps> & InContext, unknown, ORPCErrorConstructorMap<ErrorMap>>
        return yield* catchDomainErrors(Effect.gen(() => body(seen, input)))
    })
    // The two typing worlds meet here and nowhere else: `middlewareGen` sees a context that carries the services; the
    // procedure sees one that carries what `InContext` says and the services as a requirement (`Marked<Deps>`). Neither is
    // assignable to the other, which is exactly what this function exists to bridge.
    return generated as unknown as Middleware<InContext, Out & Marked<Deps>, In, unknown, ErrorMap>
}
