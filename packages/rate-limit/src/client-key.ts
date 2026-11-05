/**
 * Reads a request header across transports.
 *
 * The oRPC context `request` is a fetch `Request` under the HTTP gateway but an Express `Request` in the
 * e2e runtime (and possibly other adapters). Their header stores differ, and Express repeats a header as
 * an ARRAY rather than joining it. Handling all three is what stops a token silently reading as absent in
 * one runtime and present in another.
 */
export function readHeader(request: unknown, name: string): string | null {
    const headers = (request as { headers?: unknown } | null | undefined)
        ?.headers
    if (headers instanceof Headers) return headers.get(name)
    if (typeof headers === 'object' && headers !== null) {
        const record = headers as Record<string, unknown>
        const value = record[name] ?? record[name.toLowerCase()]
        if (typeof value === 'string') return value
        if (Array.isArray(value)) {
            const first = value.find(
                (entry): entry is string => typeof entry === 'string'
            )
            return first ?? null
        }
    }
    return null
}

/** The bucket every request that cannot be attributed to a client shares. */
export const UNKNOWN_CLIENT = 'unknown'

/**
 * Who a request counts against: the first `x-forwarded-for` hop. A request without the header cannot be
 * attributed, so all such traffic shares ONE budget (the strict reading, and the one that cannot be
 * bypassed by stripping the header).
 */
export function clientKey(request: unknown): string {
    const forwarded = readHeader(request, 'x-forwarded-for')
    return forwarded?.split(',')[0]?.trim() ?? UNKNOWN_CLIENT
}
