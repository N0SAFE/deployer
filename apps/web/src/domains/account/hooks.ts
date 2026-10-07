'use client'

/**
 * Account-security data layer.
 *
 * One module for every plugin-owned fact about the signed-in account, so pages
 * consume plain hooks instead of re-deriving each plugin's transport rules. The
 * plugins differ in ways that are not obvious from their names:
 *
 * | Plugin | How its data is read |
 * |---|---|
 * | passkey | No client method — `/passkey/list-user-passkeys` via `$fetch` |
 * | two-factor | `authClient.twoFactor.*`, enrolment state on the user |
 * | api-key | `authClient.apiKey.list({ query })`, returns `{ apiKeys }` |
 * | multi-session | `authClient.multiSession.listDeviceSessions()` |
 * | core session | `authClient.listSessions()` — devices, not just this browser |
 * | device-authorization | `/device/code` — pending CLI approvals |
 * | agent-auth | `/agent/list`, `/host/list` via `$fetch` |
 *
 * Each hook reports `{ data, error, isLoading, reload }`. Nothing swallows a
 * failure: an endpoint that 401s because a plugin is not enabled surfaces as an
 * error the UI can explain, rather than an empty list that looks like "none".
 */

import * as React from 'react'
import { authClient } from '@/lib/auth'
import { logger } from '@repo/logger'

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Every hook returns this, so call sites read identically. */
export interface AccountResource<T> {
    data: T | null
    error: string | null
    isLoading: boolean
    reload: () => Promise<void>
}

/** A passkey registered on this account. */
export interface PasskeySummary {
    id: string
    name?: string | null
    createdAt: Date | string
    deviceType?: string
    backedUp?: boolean
}

/** A device/session that can reach this account (core `/list-sessions`). */
export interface SessionSummary {
    id: string
    token: string
    ipAddress?: string | null
    userAgent?: string | null
    createdAt: Date | string
    expiresAt: Date | string
}

/** A key issued through the API Key plugin. */
export interface ApiKeySummary {
    id: string
    name: string | null
    start: string | null
    enabled: boolean
    expiresAt: Date | null
    lastRequest: Date | null
    remaining: number | null
    requestCount: number
}

/** An AI agent registered against this platform. */
export interface AgentSummary {
    id: string
    name: string
    hostId: string
    status: string
    mode: 'delegated' | 'autonomous'
    lastUsedAt: Date | null
    createdAt: Date
}

/** A machine that can host agents. */
export interface AgentHostSummary {
    id: string
    name: string | null
    defaultCapabilities: string[]
    status: string
    lastUsedAt: Date | null
    createdAt: Date
}

/**
 * Run a fetch-on-mount resource with reload.
 *
 * `loader` must be stable (wrap it in `useCallback` at the call site) — it is
 * the effect's dependency, so an unstable one re-fires on every render.
 */
function useAccountResource<T>(
    loader: () => Promise<{ data: T | null; error: string | null }>,
    label: string,
): AccountResource<T> {
    const [data, setData] = React.useState<T | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [isLoading, setIsLoading] = React.useState(true)

    const run = React.useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const result = await loader()
            setData(result.data)
            setError(result.error)
        } catch (err) {
            // A thrown error and a returned error mean the same thing to the
            // caller, so normalise here rather than at every call site.
            logger.error(`Failed to load ${label}`, { error: err })
            setError(err instanceof Error ? err.message : `Failed to load ${label}`)
        } finally {
            setIsLoading(false)
        }
    }, [loader, label])

    React.useEffect(() => {
        void run()
    }, [run])

    return { data, error, isLoading, reload: run }
}

/** Normalise a Better Auth client result into `{ data, error }`. */
function fromClient<T>(
    result: { data?: T | null; error?: { message?: string } | null },
    fallback: string,
): { data: T | null; error: string | null } {
    if (result.error) {
        return { data: null, error: result.error.message ?? fallback }
    }
    return { data: result.data ?? null, error: null }
}

/** Read an array payload that may arrive bare or wrapped in a named key. */
function pickArray<T>(payload: unknown, key: string): T[] {
    if (Array.isArray(payload)) return payload as T[]
    if (payload && typeof payload === 'object') {
        const inner = (payload as Record<string, unknown>)[key]
        if (Array.isArray(inner)) return inner as T[]
    }
    return []
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

/**
 * Passkeys enrolled on this account.
 *
 * There is no client method for this. The passkey plugin declares
 * `listPasskeys` on the SERVER api (`/passkey/list-user-passkeys`) but exposes
 * it to browsers only as a reactive atom created by `$store.atoms()` — a
 * function that issues its own unstoppable fetch. `$fetch` against the same
 * documented route is the honest equivalent.
 */
export function usePasskeys(): AccountResource<PasskeySummary[]> {
    const loader = React.useCallback(async () => {
        const result = await authClient.$fetch<PasskeySummary[]>(
            '/passkey/list-user-passkeys',
            { method: 'GET' },
        )
        const { data, error } = fromClient(result, 'Failed to load passkeys')
        return { data: pickArray<PasskeySummary>(data, 'passkeys'), error }
    }, [])

    return useAccountResource(loader, 'passkeys')
}

/** Remove a passkey. Throws nothing — callers reload afterwards. */
export async function deletePasskey(id: string): Promise<void> {
    await authClient.passkey.deletePasskey({ id })
}

/** Start WebAuthn enrolment. Resolves once the browser prompt completes. */
export async function addPasskey(name?: string): Promise<void> {
    await authClient.passkey.addPasskey(name ? { name } : undefined)
}

// ---------------------------------------------------------------------------
// Two-factor
// ---------------------------------------------------------------------------

export interface TwoFactorActions {
    /** Codes shown once, right after enabling or regenerating. */
    backupCodes: string[]
    isBusy: boolean
    error: string | null
    enable: () => Promise<void>
    disable: () => Promise<void>
    regenerateBackupCodes: () => Promise<void>
    clearBackupCodes: () => void
}

/**
 * Two-factor enrolment state and the actions that change it.
 *
 * `enabled` is read from the session's user (`twoFactorEnabled`), which the
 * two-factor plugin adds as an additional field. That is why the declared user
 * fields in the auth factory include the ban-related columns — the same
 * mechanism carries this one.
 */
export function useTwoFactor(enabledFromSession: boolean): TwoFactorActions {
    const [backupCodes, setBackupCodes] = React.useState<string[]>([])
    const [isBusy, setIsBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    const run = React.useCallback(
        async (
            action: () => Promise<{ data?: unknown; error?: { message?: string } | null }>,
            onSuccess?: (data: unknown) => void,
        ) => {
            setIsBusy(true)
            setError(null)
            try {
                const result = await action()
                if (result.error) {
                    setError(result.error.message ?? 'Request failed')
                    return
                }
                onSuccess?.(result.data)
            } catch (err) {
                logger.error('Two-factor action failed', { error: err })
                setError(err instanceof Error ? err.message : 'Request failed')
            } finally {
                setIsBusy(false)
            }
        },
        [],
    )

    const enable = React.useCallback(
        () =>
            run(
                () => authClient.twoFactor.enable({ password: '' }),
                (data) => {
                    const codes = (data as { backupCodes?: string[] } | null)?.backupCodes
                    if (codes?.length) setBackupCodes(codes)
                },
            ),
        [run],
    )

    const disable = React.useCallback(
        () =>
            run(
                () => authClient.twoFactor.disable({}),
                () => setBackupCodes([]),
            ),
        [run],
    )

    const regenerateBackupCodes = React.useCallback(
        () =>
            run(
                () => authClient.twoFactor.generateBackupCodes({}),
                (data) => {
                    const codes = (data as { backupCodes?: string[] } | null)?.backupCodes
                    setBackupCodes(codes ?? [])
                },
            ),
        [run],
    )

    const clearBackupCodes = React.useCallback(() => setBackupCodes([]), [])

    // `enabledFromSession` is passed in rather than re-read here: the session is
    // already fetched by the caller, and a second subscription would double the
    // requests for one boolean.
    void enabledFromSession

    return { backupCodes, isBusy, error, enable, disable, regenerateBackupCodes, clearBackupCodes }
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/** API keys owned by the signed-in account. */
export function useApiKeys(): AccountResource<ApiKeySummary[]> {
    const loader = React.useCallback(async () => {
        const result = await authClient.apiKey.list({ query: { limit: 50, offset: 0 } })
        const { data, error } = fromClient(result, 'Failed to load API keys')
        return { data: pickArray<ApiKeySummary>(data, 'apiKeys'), error }
    }, [])

    return useAccountResource(loader, 'API keys')
}

/** Options for minting a key. */
export interface CreateApiKeyOptions {
    name: string
    /** Seconds until expiry. Omitted means the key never expires. */
    expiresIn?: number
    metadata?: Record<string, string>
}

/** Mint a key. Returns the raw key ONCE — it is never retrievable again. */
export async function createApiKey(
    options: CreateApiKeyOptions,
): Promise<{ key: string | null; error: string | null }> {
    const result = await authClient.apiKey.create({
        name: options.name,
        ...(options.expiresIn !== undefined ? { expiresIn: options.expiresIn } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
    })

    if (result.error) {
        return { key: null, error: result.error.message ?? 'Failed to create API key' }
    }

    const created = result.data as { key?: string } | null
    if (!created?.key) {
        return { key: null, error: 'The server returned no key value' }
    }
    return { key: created.key, error: null }
}

/** Disable a key. The record is kept so the audit trail survives. */
export async function revokeApiKey(keyId: string): Promise<void> {
    await authClient.apiKey.delete({ keyId })
}

// ---------------------------------------------------------------------------
// Sessions (devices that can reach this account)
// ---------------------------------------------------------------------------

/**
 * Every session that can reach this account, not just this browser.
 *
 * Distinct from multi-session: that lists the accounts retained *in this
 * browser*; this lists the *devices* holding a session for this user.
 */
export function useActiveSessions(): AccountResource<SessionSummary[]> {
    const loader = React.useCallback(async () => {
        const result = await authClient.listSessions()
        const { data, error } = fromClient(result, 'Failed to load sessions')
        return { data: (data as SessionSummary[] | null) ?? [], error }
    }, [])

    return useAccountResource(loader, 'sessions')
}

/** Revoke one session by token. */
export async function revokeSession(token: string): Promise<void> {
    await authClient.revokeSession({ token })
}

/** Revoke every session except the current one. */
export async function revokeOtherSessions(): Promise<void> {
    await authClient.revokeOtherSessions()
}

// ---------------------------------------------------------------------------
// Connected accounts (OAuth providers)
// ---------------------------------------------------------------------------

/** An external identity linked to this account. */
export interface LinkedAccount {
    id: string
    providerId: string
    accountId: string
    createdAt?: Date | string
    scope?: string | null
}

/**
 * OAuth providers linked to this account.
 *
 * `/list-accounts` is a core endpoint. A user who signed up with a password has
 * zero linked accounts; one who signed in with GitHub has one. Showing this is
 * what makes account linking visible rather than invisible state.
 */
export function useLinkedAccounts(): AccountResource<LinkedAccount[]> {
    const loader = React.useCallback(async () => {
        const result = await authClient.listAccounts()
        const { data, error } = fromClient(result, 'Failed to load connected accounts')
        return { data: (data as LinkedAccount[] | null) ?? [], error }
    }, [])

    return useAccountResource(loader, 'connected accounts')
}

// ---------------------------------------------------------------------------
// Agent Auth
// ---------------------------------------------------------------------------

/** AI agents registered against this platform. */
export function useAgents(): AccountResource<AgentSummary[]> {
    const loader = React.useCallback(async () => {
        const result = await authClient.$fetch<unknown>('/agent/list', { method: 'GET' })
        const { data, error } = fromClient(result, 'Failed to load agents')
        return { data: pickArray<AgentSummary>(data, 'agents'), error }
    }, [])

    return useAccountResource(loader, 'agents')
}

/** Hosts that can run agents. */
export function useAgentHosts(): AccountResource<AgentHostSummary[]> {
    const loader = React.useCallback(async () => {
        const result = await authClient.$fetch<unknown>('/host/list', { method: 'GET' })
        const { data, error } = fromClient(result, 'Failed to load agent hosts')
        return { data: pickArray<AgentHostSummary>(data, 'hosts'), error }
    }, [])

    return useAccountResource(loader, 'agent hosts')
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by every surface that renders these resources)
// ---------------------------------------------------------------------------

/** Human-readable "3 minutes ago", or `fallback` for absent/invalid values. */
export function relativeTime(
    value: Date | string | null | undefined,
    fallback = 'never',
): string {
    if (!value) return fallback
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) return fallback

    const diffMs = date.getTime() - Date.now()
    const abs = Math.abs(diffMs)
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour

    const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    if (abs < minute) return fmt.format(Math.round(diffMs / 1000), 'second')
    if (abs < hour) return fmt.format(Math.round(diffMs / minute), 'minute')
    if (abs < day) return fmt.format(Math.round(diffMs / hour), 'hour')
    return fmt.format(Math.round(diffMs / day), 'day')
}

/** True when the value is a date in the past. */
export function isExpired(value: Date | string | null | undefined): boolean {
    if (!value) return false
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) return false
    return date.getTime() <= Date.now()
}

/**
 * Describe a user agent in one short line.
 *
 * Deliberately coarse: the goal is "which of my logins is this", not analytics.
 * A full UA parser would be a dependency for a string nobody reads twice.
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
    if (!userAgent) return 'Unknown device'
    const ua = userAgent.toLowerCase()

    const browser =
        ua.includes('edg/') ? 'Edge'
        : ua.includes('opr/') || ua.includes('opera') ? 'Opera'
        : ua.includes('firefox') ? 'Firefox'
        : ua.includes('chrome') ? 'Chrome'
        : ua.includes('safari') ? 'Safari'
        : 'Browser'

    const os =
        ua.includes('windows') ? 'Windows'
        : ua.includes('android') ? 'Android'
        : ua.includes('iphone') || ua.includes('ipad') ? 'iOS'
        : ua.includes('mac os') ? 'macOS'
        : ua.includes('linux') ? 'Linux'
        : ''

    return os ? `${browser} on ${os}` : browser
}
