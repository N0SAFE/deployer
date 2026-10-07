'use client'

import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/lib/auth'
import {
    getMasterTokenEnabled,
    setDevtoolsApiKeyProvider,
} from '@repo/auth/client'

/**
 * Dev-only API key for the TanStack DevTools "act as user" panel.
 *
 * Replaces the previous approach, which read `NEXT_PUBLIC_DEV_AUTH_KEY` — the
 * API's master token, i.e. a platform-wide super-admin bearer credential —
 * directly in the browser. Being `NEXT_PUBLIC_*`, Next.js inlined it into the
 * client bundle at build time.
 *
 * This hook instead mints a **scoped, expiring API key** through the session
 * the developer already has. The key is the credential the devtools send; the
 * platform secret never leaves the server.
 *
 * Lifecycle: minted on demand, cached in `sessionStorage` (per-tab, cleared on
 * close) and revocable from the panel. `sessionStorage` rather than
 * `localStorage` so the credential does not outlive the dev session.
 */

const STORAGE_KEY = 'devtools-api-key'

/** Keys minted here are short-lived; the panel is a debugging aid, not a client. */
const KEY_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

interface UseDevtoolsApiKeyResult {
    /** The raw key to send as `Authorization: Bearer <key>`, or null when absent. */
    key: string | null
    isLoading: boolean
    error: string | null
    mintKey: () => Promise<void>
    revokeKey: () => Promise<void>
}

function readStoredKey(): string | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY)
        if (!raw) return null

        const parsed: unknown = JSON.parse(raw)
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            !('key' in parsed) ||
            !('expiresAt' in parsed)
        ) {
            return null
        }

        const { key, expiresAt } = parsed as { key: unknown; expiresAt: unknown }
        if (typeof key !== 'string' || typeof expiresAt !== 'number') return null
        if (Date.now() >= expiresAt) {
            window.sessionStorage.removeItem(STORAGE_KEY)
            return null
        }

        return key
    } catch {
        return null
    }
}

function storeKey(key: string, keyId: string): void {
    if (typeof window === 'undefined') return
    try {
        window.sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ key, keyId, expiresAt: Date.now() + KEY_TTL_MS }),
        )
    } catch {
        // Storage may be unavailable (private mode / quota). The key still
        // works for this page's lifetime; only persistence is lost.
    }
}

function readStoredKeyId(): string | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || !('keyId' in parsed)) return null
        const { keyId } = parsed as { keyId: unknown }
        return typeof keyId === 'string' ? keyId : null
    } catch {
        return null
    }
}

function clearStoredKey(): void {
    if (typeof window === 'undefined') return
    try {
        window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
        // ignore
    }
}

/**
 * Read the devtools API key for use outside React (the ORPC link plugin).
 *
 * Returns null unless the devtools toggle is on AND a key is present and
 * unexpired. Kept here rather than in the plugin so the hook and the plugin
 * cannot drift on storage format, key name, or expiry semantics.
 */
export function readDevtoolsApiKey(): string | null {
    if (typeof window === 'undefined') return null
    if (!getMasterTokenEnabled()) return null
    return readStoredKey()
}

// The auth package cannot import this module (dependency direction), so it
// reads the key through a provider it exposes. Registering at module scope
// means the ORPC link plugin and Better Auth's own fetch plugin both get the
// key without a second storage implementation.
setDevtoolsApiKeyProvider(readDevtoolsApiKey)

export function useDevtoolsApiKey(enabled: boolean): UseDevtoolsApiKeyResult {
    const [key, setKey] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Hydrate from sessionStorage on mount. Deliberately not auto-minting:
    // minting is an explicit user action so the panel never silently creates
    // credentials in the background.
    useEffect(() => {
        if (!enabled) {
            setKey(null)
            return
        }
        setKey(readStoredKey())
    }, [enabled])

    const mintKey = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const result = await authClient.apiKey.create({
                name: 'devtools',
                expiresIn: KEY_TTL_MS / 1000,
                metadata: { purpose: 'tanstack-devtools' },
            })

            if (result.error) {
                setError(result.error.message ?? 'Failed to mint API key')
                return
            }

            const created = result.data
            if (!created?.key) {
                setError('API key response contained no key')
                return
            }

            storeKey(created.key, created.id)
            setKey(created.key)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to mint API key')
        } finally {
            setIsLoading(false)
        }
    }, [])

    const revokeKey = useCallback(async () => {
        const keyId = readStoredKeyId()
        clearStoredKey()
        setKey(null)

        if (!keyId) return

        try {
            await authClient.apiKey.delete({ keyId })
        } catch {
            // Revocation is best-effort: the local key is already discarded, and
            // it expires on its own. Surfacing a failure here would be noise.
        }
    }, [])

    return { key, isLoading, error, mintKey, revokeKey }
}

export default useDevtoolsApiKey
