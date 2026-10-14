import type { SharedRuntimeRequestOverride } from './types'

/**
 * The request the app sees when there is no real one.
 *
 * `overrideProvider(REQUEST)` replaces Nest's per-request provider with a single
 * value for the whole test module, so there is no live Express request to read.
 * The defaults below describe the synthetic bootstrap request; per-request state
 * is layered on top through `withRequestHeaders` so a middleware that reads a
 * header (e.g. `x-app-instance-token`) sees what the caller actually sent instead
 * of always missing it.
 */
export const defaultRequestOverride = {
    headers: {
        host: '127.0.0.1',
        'x-forwarded-proto': 'http',
    },
    method: 'GET',
    url: '/__e2e_runtime_bootstrap__',
} satisfies SharedRuntimeRequestOverride

export const sharedRequestOverride: SharedRuntimeRequestOverride = {
    headers: {
        ...defaultRequestOverride.headers,
    },
    method: defaultRequestOverride.method,
    url: defaultRequestOverride.url,
}

/**
 * Run `fn` with `request` reflecting the given headers.
 *
 * The REQUEST provider is a single object shared by every call in the module, so
the headers have to be set around the call and restored afterwards — the e2e
 * request helper is the only place that knows what the caller sent.
 */
export async function withRequestHeaders<T>(
    headers: Record<string, string | string[]>,
    fn: () => Promise<T>,
): Promise<T> {
    const previous = { ...sharedRequestOverride.headers }
    sharedRequestOverride.headers = {
        ...previous,
        ...Object.fromEntries(
            Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
        ),
    }
    try {
        return await fn()
    } finally {
        sharedRequestOverride.headers = previous
    }
}

export function setSharedRuntimeRequestOverride(
    patch: Partial<SharedRuntimeRequestOverride>,
): void {
    if (patch.headers) {
        sharedRequestOverride.headers = {
            ...sharedRequestOverride.headers,
            ...patch.headers,
        }
    }

    if (typeof patch.method === 'string' && patch.method.length > 0) {
        sharedRequestOverride.method = patch.method
    }

    if (typeof patch.url === 'string' && patch.url.length > 0) {
        sharedRequestOverride.url = patch.url
    }
}

export function setSharedRuntimeAuthHeaders(
    headers: Record<string, string | string[]>,
): void {
    setSharedRuntimeRequestOverride({ headers })
}

export function resetSharedRuntimeRequestOverride(): void {
    sharedRequestOverride.headers = {
        ...defaultRequestOverride.headers,
    }
    sharedRequestOverride.method = defaultRequestOverride.method
    sharedRequestOverride.url = defaultRequestOverride.url
}
