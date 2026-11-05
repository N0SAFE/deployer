import { Context, Effect } from 'effect'

/** The two header shapes a request actually arrives as: a Web `Headers`, or Node's plain record. */
export type HeaderSource =
    | { get(name: string): string | null }
    | Readonly<Record<string, string | readonly string[] | undefined>>

/**
 * The HTTP request a handler is running for.
 *
 * ── WHY THIS IS A SERVICE AND NOT A NEST SCOPE ─────────────────────────────
 * `Scope.REQUEST` makes Nest rebuild the provider graph per request, which also rebuilds everything that injects it —
 * expensive, and fatal to a process-wide Effect runtime. The request is not a dependency with a LIFETIME here; it is a
 * VALUE that differs per call. So it is supplied the same way `CurrentActor` and `Correlation` are: a per-request
 * `Context` layer over the app-wide one, added by the boundary (`serve(context)`), never stored.
 *
 * That also means two overlapping requests cannot see each other's request: each runs on its own immutable `Context`.
 *
 * Named `HttpRequest` rather than `Request` so importing it does not shadow the global `Request` type in a module that
 * also uses fetch types.
 */
export type HttpRequestShape = {
    readonly method: string
    readonly url: string
    readonly headers: HeaderSource
}

export class HttpRequest extends Context.Service<
    HttpRequest,
    HttpRequestShape
>()('http/Request') {}

/**
 * One header from a request, whichever shape its headers arrived in.
 *
 * Returns `undefined` for absent and for empty, so a caller never has to special-case `""`; repeated headers (Node) are
 * joined the way the HTTP spec says, which is what makes an `x-forwarded-for` chain readable.
 */
export function headerOf(
    request: HttpRequestShape | null | undefined,
    name: string
): string | undefined {
    const headers = request?.headers
    if (headers === undefined) return undefined

    if (typeof (headers as { get?: unknown }).get === 'function') {
        const value =
            (headers as { get(name: string): string | null }).get(name) ??
            undefined
        return value === '' ? undefined : value
    }

    const value = (
        headers as Readonly<
            Record<string, string | readonly string[] | undefined>
        >
    )[name]
    const text = typeof value === 'string' ? value : value?.join(', ')
    return text === undefined || text === '' ? undefined : text
}

/**
 * The caller's address as the proxies in front of us report it.
 *
 * `x-forwarded-for` is a chain (`client, proxy1, proxy2`); the left-most entry is the client. `x-real-ip` is the fallback
 * a single-proxy setup sends. Neither is trusted for AUTHORIZATION — a client can send both — so this is for the audit
 * trail, which wants "where did this come from" and not "may this caller act".
 */
export function clientAddressOf(
    request: HttpRequestShape | null | undefined
): string | undefined {
    const forwarded = headerOf(request, 'x-forwarded-for')
        ?.split(',')[0]
        ?.trim()
    if (forwarded !== undefined && forwarded !== '') return forwarded
    return headerOf(request, 'x-real-ip')
}

/**
 * The request a non-HTTP caller stands in with: a worker, a seed, a CLI, a spec.
 *
 * REQUIRED, not optional (`AUTH-0xx`): when a service needs the request, it says so in its type and the caller must
 * provide one — the same rule `Scope.REQUEST` enforces in Nest, expressed in `R`. A caller with no HTTP request supplies
 * this value, so the audit trail records "no address" rather than the code pretending the request might not exist.
 */
export const systemRequest: HttpRequestShape = {
    method: 'SYSTEM',
    url: '',
    headers: {},
}

/**
 * The current request, as a REQUIREMENT.
 *
 * `yield* HttpRequest` wherever it is needed: inside a request the boundary provides the real one (`createOrpcModule` →
 * `Context.add`, and `serve()` provides it again for code it wraps); outside one the caller provides `systemRequest`. A
 * service that reads the request therefore has it in its `R`, which is what makes "this needs a request" visible instead
 * of a null check.
 */
export const currentRequest: Effect.Effect<
    HttpRequestShape,
    never,
    HttpRequest
> = Effect.service(HttpRequest)
