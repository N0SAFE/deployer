import { existsSync } from 'node:fs'
import http from 'node:http'

import { Effect } from 'effect'

import { resolveDockerHostIp } from '@deployer/docker'

/** What dialing the ingress's local entrypoint showed. An observation, never an error. */
export type EntrypointObservation = {
    readonly reachable: boolean
    readonly host: string
    readonly port: number
    readonly statusCode: number | null
    readonly latencyMs: number | null
}

export const ENTRYPOINT_PROBE_TIMEOUT_MS = 3_000

/** Whether this process runs inside a container (`HOSTNAME` is the container id, or `/.dockerenv` exists). */
export const runsInsideContainer = (hostname: string | undefined): boolean =>
    (hostname !== undefined && /^[0-9a-f]{12,64}$/.test(hostname)) ||
    existsSync('/.dockerenv')

/**
 * Candidate hosts for the entrypoint probe, best first: this node's ingress task by name on the overlay,
 * then the host's addresses (bare-metal dev).
 */
export const entrypointCandidates = (
    serviceName: string,
    insideContainer: boolean
): string[] => {
    const candidates: string[] = []
    if (insideContainer) candidates.push(serviceName)
    candidates.push('host.docker.internal')
    const gateway = resolveDockerHostIp()
    if (gateway !== '127.0.0.1' && gateway !== '0.0.0.0')
        candidates.push(gateway)
    candidates.push('127.0.0.1')
    return [...new Set(candidates)]
}

/** One GET against `host:port`. Interrupting it destroys the request; a request that outlasts the timeout is "unreachable". */
const get = (
    host: string,
    port: number,
    timeoutMs: number
): Effect.Effect<number | null> =>
    Effect.callback<number | null>((resume) => {
        let settled = false
        const finish = (status: number | null): void => {
            if (settled) return
            settled = true
            resume(Effect.succeed(status))
        }
        const request = http.get(
            { host, port, path: '/', timeout: timeoutMs },
            (response) => {
                response.resume()
                finish(response.statusCode ?? 0)
            }
        )
        request.on('timeout', () => {
            request.destroy()
            finish(null)
        })
        request.on('error', () => {
            finish(null)
        })
        return Effect.sync(() => {
            request.destroy()
        })
    })

/** Tries each candidate in turn and reports the first that answers; otherwise all of them, unreachable. */
export const probeEntrypoint = (
    candidates: readonly string[],
    port: number,
    timeoutMs: number = ENTRYPOINT_PROBE_TIMEOUT_MS
): Effect.Effect<EntrypointObservation> =>
    Effect.gen(function* () {
        for (const host of candidates) {
            const startedAt = Date.now()
            const status = yield* get(host, port, timeoutMs)
            if (status !== null)
                return {
                    reachable: true,
                    host,
                    port,
                    statusCode: status === 0 ? null : status,
                    latencyMs: Date.now() - startedAt,
                }
        }
        return {
            reachable: false,
            host: candidates.join(' / '),
            port,
            statusCode: null,
            latencyMs: null,
        }
    })
