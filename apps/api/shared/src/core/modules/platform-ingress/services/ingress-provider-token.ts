/**
 * The token Traefik presents when it polls its routes from the API.
 *
 * The config endpoint is reachable through Traefik itself (`api.<host>` routes to
 * the API), so "only the overlay can reach it" is not true and the endpoint must
 * authenticate its caller. The token is DERIVED from the platform secret rather
 * than stored: every API replica computes the same value with no shared state, and
 * rotating the platform secret rotates it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Path the ingress polls on the API (Traefik HTTP provider endpoint). */
export const TRAEFIK_CONFIG_PATH = 'internal/ingress/traefik-config'

/** Header Traefik's HTTP provider sends (`--providers.http.headers.<name>`). */
export const INGRESS_TOKEN_HEADER = 'X-Deployer-Ingress-Token'

const DERIVATION_LABEL = 'deployer:traefik-http-provider:v1'

/**
 * The secret the token is derived from: the node's platform secret (`PlatformSecret`). Throws when there is none — an
 * ingress whose poll cannot be authenticated must fail loudly rather than accept a token derived from an empty key.
 */
export function requireIngressSecret(
    platformSecret: string | null | undefined
): string {
    const secret = platformSecret?.trim()
    if (secret === undefined || secret === '') {
        throw new Error(
            'The platform secret is not available — the ingress cannot authenticate its route poll'
        )
    }
    return secret
}

export function deriveIngressProviderToken(authSecret: string): string {
    return createHmac('sha256', authSecret)
        .update(DERIVATION_LABEL)
        .digest('hex')
}

/** Constant-time comparison, so the token cannot be guessed byte by byte. */
export function ingressTokenMatches(
    presented: string | undefined,
    authSecret: string
): boolean {
    if (presented === undefined) return false
    const expected = Buffer.from(deriveIngressProviderToken(authSecret))
    const actual = Buffer.from(presented)
    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    )
}
