import { middlewareGen } from '@orpc/effect'
import { ORPCError } from '@orpc/server'
import { Effect } from 'effect'

import { domainErrorOptions } from '@deployer/orpc-utils'

import { clientKey } from './client-key'
import { makeSlidingWindowLimiter } from './sliding-window'

/** Minimal context contract: the runtime provides `request` on every call (set as the initial context by `ORPCModule`). */
export type RequestContext = {
    request: globalThis.Request
}

export type RateLimitOptions = {
    /** Sliding window length in milliseconds. */
    windowMs: number
    /** Maximum requests per window per key. */
    max: number
    /** Human-readable message sent to the client. */
    message?: string
}

/**
 * An oRPC middleware, written as an Effect, that limits each client (see `clientKey`) to `max` requests per `windowMs`.
 *
 * The refusal is ALWAYS the contract-declared `TOO_MANY_REQUESTS` (declared on the procedures that use it), failed in the
 * Effect's error channel before the handler runs. It lives in one place so every endpoint that needs "how many requests may
 * you make" is protected by the same implementation.
 */
export function rateLimit(options: RateLimitOptions) {
    const limiter = makeSlidingWindowLimiter(options)

    return middlewareGen<RequestContext>(function* ({ context, next }) {
        if (!limiter.consumeNow(clientKey(context.request)).allowed) {
            return yield* Effect.fail(
                new ORPCError(
                    'TOO_MANY_REQUESTS',
                    domainErrorOptions(
                        'TOO_MANY_REQUESTS',
                        429,
                        options.message ?? 'Too many requests — try again later'
                    )
                )
            )
        }
        return yield* next()
    })
}
