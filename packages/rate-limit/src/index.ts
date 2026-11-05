/**
 * @deployer/rate-limit — a sliding-window rate limiter and the oRPC middleware that applies it.
 *
 * Framework-free except for `rateLimit`, the oRPC middleware.
 */
export { clientKey, readHeader, UNKNOWN_CLIENT } from './client-key'
export { rateLimit } from './orpc-middleware'
export type { RateLimitOptions, RequestContext } from './orpc-middleware'
export { makeSlidingWindowLimiter, RateLimiter } from './sliding-window'
export type {
    RateLimitDecision,
    RateLimiterShape,
    SlidingWindowOptions,
} from './sliding-window'
