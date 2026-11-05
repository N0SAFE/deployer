import { os } from '@orpc/server'

import {
    domainErrorOptions,
    standardDomainErrorPayloadSchema,
} from '@deployer/orpc-utils'

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
 * An oRPC middleware that limits each client (see `clientKey`) to `max` requests per `windowMs`.
 *
 * The thrown error is ALWAYS the contract-declared `TOO_MANY_REQUESTS` (declared on the procedures that
 * use it); the middleware declares the same code through `.errors(...)`, so only that one code can be
 * thrown. It lives in one place so every endpoint that needs "how many requests may you make" is
 * protected by the same implementation.
 */
export function rateLimit(options: RateLimitOptions) {
    const limiter = makeSlidingWindowLimiter(options)

    return os
        .$context<RequestContext>()
        .errors({
            TOO_MANY_REQUESTS: {
                message: 'Too many requests',
                status: 429,
                data: standardDomainErrorPayloadSchema,
            },
        })
        .middleware(({ context, next, errors }) => {
            if (!limiter.consumeNow(clientKey(context.request)).allowed) {
                throw errors.TOO_MANY_REQUESTS(
                    domainErrorOptions(
                        'TOO_MANY_REQUESTS',
                        429,
                        options.message ?? 'Too many requests — try again later'
                    )
                )
            }
            return next({ context })
        })
}
