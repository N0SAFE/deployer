import { request as httpRequest } from 'node:http'

import { Effect } from 'effect'

/** What asking the ingress about a hostname showed. It is an observation, never an error. */
export type RouteObservation = {
    readonly routed: boolean
    readonly reason: string
}

export type RouteProbeTarget = {
    /** The ingress, addressed on the platform network (a service name). */
    readonly ingressHost: string
    readonly ingressPort: number
    /** The `Host` header a browser would send: what the ingress routes on. */
    readonly hostname: string
    readonly path: string
    readonly timeoutMs: number
}

/**
 * Asks the ingress whether `hostname` is ROUTED, and whether the app behind it answers.
 *
 * WHY THE INGRESS, AND NOT THE PUBLIC URL: the public hostname does not resolve inside the API's own
 * task, so fetching it would report "unreachable" on a perfectly routed node. This reproduces what a
 * browser does against the only address reachable from here: dial the ingress by its service name and
 * send the `Host` header the browser would. `http.request` and not `fetch`, because `Host` is a
 * forbidden header for fetch: it would be dropped and every request judged against the ingress's
 * default router instead of the web one.
 *
 * Never fails. Interrupting it destroys the request; a request that outlasts `timeoutMs` is reported
 * as unanswered. A missing router, a 5xx or an unreachable ingress are all "not routed yet", because
 * the handover that publishes the route can only run once readiness passes: failing on them would
 * deadlock onboarding. They surface as warnings; setup's own check after the port release enforces.
 */
export const probeRoute = (
    target: RouteProbeTarget
): Effect.Effect<RouteObservation> =>
    Effect.callback<RouteObservation>((resume) => {
        const { ingressHost, ingressPort, hostname, path, timeoutMs } = target
        let settled = false
        const finish = (observation: RouteObservation): void => {
            if (settled) return
            settled = true
            resume(Effect.succeed(observation))
        }

        const request = httpRequest(
            {
                hostname: ingressHost,
                port: ingressPort,
                path,
                method: 'GET',
                headers: { host: hostname },
            },
            (response) => {
                const status = response.statusCode ?? 0
                const header = response.headers['content-type']
                const contentType = Array.isArray(header)
                    ? header.join(',')
                    : (header ?? '')
                // Drain and discard: the body is irrelevant, and leaving it unread keeps the socket open.
                response.resume()

                // Traefik's "no router matched" answer is plain text, whereas the web app's own 404s are
                // HTML: the content type tells "the ingress has no rule for this host" from "the app
                // answered 404 for this path".
                if (status === 404 && contentType.includes('text/plain')) {
                    finish({
                        routed: false,
                        reason: `the ingress has no router for ${hostname} yet — the web route has not been published`,
                    })
                    return
                }
                // A 5xx means the route exists and the app answered that it is not serving (503 is the
                // health route's "my API dependency is unreachable").
                if (status >= 500) {
                    finish({
                        routed: false,
                        reason: `the web health route answered ${String(status)} — the app is up but not serving (it reports its own API dependency as unreachable)`,
                    })
                    return
                }
                finish({
                    routed: true,
                    reason: `${hostname} is routed (${String(status)})`,
                })
            }
        )

        request.setTimeout(timeoutMs, () => {
            request.destroy()
            finish({
                routed: false,
                reason: `the ingress at ${ingressHost} did not answer within ${String(timeoutMs)}ms`,
            })
        })
        request.on('error', (error: Error) => {
            finish({
                routed: false,
                reason: `the ingress at ${ingressHost} is not reachable (${error.message})`,
            })
        })
        request.end()

        return Effect.sync(() => {
            request.destroy()
        })
    })
