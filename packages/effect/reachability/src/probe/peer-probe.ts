import { Effect } from 'effect'

import { SafeHttp } from '@deployer/effect-infra'

import { decodeIdentity, originOf, requestOrReason } from './http'
import { PeerProbeResult, ProbePeerOptions } from './types'

/**
 * Probe a peer's identity endpoint, with an optional liveness fallback.
 *
 * Returns the identity the peer reported, so the caller learns the URL to dial
 * back without a second round trip. Never fails, for the same reason as
 * {@link probeAddress}.
 */
export const probePeer = (
    url: string,
    options: ProbePeerOptions
): Effect.Effect<PeerProbeResult, never, SafeHttp> =>
    Effect.gen(function* () {
        const origin = originOf(url)
        if (origin === undefined) {
            return {
                url,
                reachable: false,
                probeUrl: url,
                latencyMs: 0,
                error: 'Invalid URL format',
            }
        }

        const http = yield* SafeHttp
        const primaryUrl = `${origin}${options.primaryPath}`
        const startedAt = performance.now()

        const primary = yield* requestOrReason(http, primaryUrl, options.policy)
        const primaryLatency = Math.round(performance.now() - startedAt)

        if (primary.ok) {
            return {
                url,
                reachable: true,
                probeUrl: primaryUrl,
                latencyMs: primaryLatency,
                identity: decodeIdentity(primary.response),
            } satisfies PeerProbeResult
        }

        if (options.fallbackPath === undefined) {
            return {
                url,
                reachable: false,
                probeUrl: primaryUrl,
                latencyMs: primaryLatency,
                error: primary.reason,
            } satisfies PeerProbeResult
        }

        const fallbackUrl = `${origin}${options.fallbackPath}`
        const fallback = yield* requestOrReason(
            http,
            fallbackUrl,
            options.policy
        )
        const latencyMs = Math.round(performance.now() - startedAt)

        return fallback.ok
            ? { url, reachable: true, probeUrl: fallbackUrl, latencyMs }
            : {
                  url,
                  reachable: false,
                  probeUrl: primaryUrl,
                  latencyMs,
                  error: `${primary.reason} (${options.primaryPath}), ${fallback.reason} (${options.fallbackPath})`,
              }
    })
