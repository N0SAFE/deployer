import type { SharedRuntimeRequestOverride } from './types'

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
