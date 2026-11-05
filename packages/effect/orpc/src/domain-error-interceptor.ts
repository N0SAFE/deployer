import { onError } from '@orpc/server'

import { isDomainError } from '@deployer/effect-core'

import { mapDomainError } from './map-domain-error'

import type { Interceptor } from '@orpc/shared'

/**
 * oRPC interceptor for code that THROWS a domain error (Promise-based services, middleware)
 * instead of failing an Effect: the throw becomes the oRPC error its kind maps to. Anything
 * that is not a domain error is left for the next interceptor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the host accepts interceptors of any context
export function domainErrorInterceptor(): Interceptor<any, any> {
    return onError((error: unknown) => {
        if (isDomainError(error)) throw mapDomainError(error)
    })
}
