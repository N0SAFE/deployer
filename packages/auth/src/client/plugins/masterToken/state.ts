// Non-React state and helpers for the devtools auth toggle.
//
// This module used to ALSO write the master credential (`DEV_AUTH_KEY`, read
// via `NEXT_PUBLIC_DEV_AUTH_KEY`) into a `dev-auth-key` cookie so the server
// could read it. That is gone: the token is now a scoped API key minted through
// the session and kept in `sessionStorage` by the devtools hook
// (`apps/web/src/components/devtools/use-devtools-api-key.ts`). Here we only
// track whether the toggle is on — the server never needs to read this cookie,
// because the key travels in the Authorization header.
export const MASTER_TOKEN_COOKIE_NAME = 'master-token-enabled'

/**
 * Credential provider for the devtools flow, registered by the app.
 *
 * The auth package cannot import the app (dependency direction), and it must not
 * know how the key is stored. The app installs a reader; this module only calls
 * it. Same pattern as `setMeshSecretProvider` in the API.
 */
let _devtoolsApiKeyProvider: (() => string | null) | null = null

/**
 * Register the function that returns the current devtools API key.
 *
 * Called once by the app at startup (see the devtools module). Until it is
 * registered, no Authorization header is attached — a safe default.
 */
export function setDevtoolsApiKeyProvider(provider: () => string | null): void {
    _devtoolsApiKeyProvider = provider
}

/**
 * Read the current devtools API key, or null when unavailable.
 *
 * Returns null when the toggle is off, no provider is registered, or the key has
 * expired — so callers can treat null as "send no Authorization header".
 */
export function getDevtoolsApiKey(): string | null {
    if (typeof window === 'undefined') return null
    if (!getMasterTokenEnabled()) return null
    return _devtoolsApiKeyProvider?.() ?? null
}

export function getMasterTokenEnabled(): boolean {
    if (typeof window === 'undefined') return false

    const cookies = document.cookie.split(';')
    const masterTokenCookie = cookies.find((cookie) =>
        cookie.trim().startsWith(`${MASTER_TOKEN_COOKIE_NAME}=`)
    )

    return masterTokenCookie?.split('=')[1]?.trim() === 'true'
}

export function setMasterTokenEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return

    const expirationDate = new Date()
    expirationDate.setDate(expirationDate.getDate() + 1)

    // Use SameSite=None with Secure in production (HTTPS), SameSite=Lax in development
    const isProduction = process.env.NODE_ENV === 'production'
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'
    const useSecure = isProduction || isHttps
    const cookieAttributes = useSecure
        ? `path=/; SameSite=None; Secure`
        : `path=/; SameSite=Lax`

    document.cookie = `${MASTER_TOKEN_COOKIE_NAME}=${String(enabled)}; expires=${expirationDate.toUTCString()}; ${cookieAttributes}`

    try {
        localStorage.setItem(
            'master-token',
            JSON.stringify({ value: enabled, t: Date.now() })
        )
    } catch {
        // ignore
    }
}

export function clearMasterToken(): void {
    if (typeof window === 'undefined') return

    document.cookie = `${MASTER_TOKEN_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`

    try {
        localStorage.setItem(
            'master-token',
            JSON.stringify({ value: false, t: Date.now() })
        )
    } catch {
        // ignore
    }

    try {
        window.dispatchEvent(
            new CustomEvent('master-token-changed', {
                detail: { value: false },
            })
        )
    } catch {
        // ignore
    }
}

export type MasterTokenSubscriber = (value: boolean) => void

export const MasterTokenManager = {
    state: typeof window === 'undefined' ? false : getMasterTokenEnabled(),
    subscribers: new Set<MasterTokenSubscriber>(),
    
    onStateChange(fn: MasterTokenSubscriber) {
        MasterTokenManager.subscribers.add(fn)
        return () => MasterTokenManager.subscribers.delete(fn)
    },

    change(value: boolean) {
        try {
            setMasterTokenEnabled(value)
        } catch {
            // ignore
        }
        MasterTokenManager.state = value
        for (const fn of Array.from(MasterTokenManager.subscribers)) {
            try {
                fn(value)
            } catch {
                // ignore
            }
        }
    }
}
