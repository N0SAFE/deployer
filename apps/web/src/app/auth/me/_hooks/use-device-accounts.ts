'use client'

/**
 * Accounts open in this browser (Better Auth multi-session).
 *
 * Owns the whole interaction: read the retained accounts, promote one to
 * active, drop one. Two rules drive the shape of this hook:
 *
 * 1. `setActive` rewrites the primary session cookie **and** the cookie cache
 *    server-side, so a full reload is the correct way to re-read identity —
 *    nothing user-scoped may be patched in place.
 * 2. Removing the *non-active* account is local: no identity change, so the
 *    list is simply re-read.
 */

import * as React from 'react'
import { logger } from '@repo/logger'
import { authClient, useSession } from '@/lib/auth'
import type { DeviceAccount } from '../_models/device-account.types'

/** Outcome of one read of the browser's retained accounts. */
type AccountsRead =
    { ok: true; accounts: DeviceAccount[] } | { ok: false; message: string }

/** Shown whenever the browser's retained accounts cannot be read. */
const LOAD_FAILED_MESSAGE = "Couldn't load the accounts open in this browser."

interface UseDeviceAccountsResult {
    /** Every account whose session is retained in this browser. */
    accounts: DeviceAccount[]
    /** True while the account list is being (re)read. */
    isLoading: boolean
    /** Human-readable failure from the last operation, or null. */
    error: string | null
    /** Token of the account with an in-flight mutation, or null when idle. */
    pendingToken: string | null
    /** Token of the account this browser is currently using. */
    activeSessionToken: string | undefined
    /** Promote a retained account to active. Reloads the page on success. */
    switchAccount: (sessionToken: string) => Promise<void>
    /** Drop a retained account. Reloads only when it was the active one. */
    removeAccount: (sessionToken: string) => Promise<void>
    /** Re-read the account list, showing the loading state. */
    reload: () => Promise<void>
}

/**
 * Read the retained accounts and report the outcome instead of writing state:
 * the initial read runs from an effect, where a synchronous `setState` would
 * cascade renders, so callers decide when to apply the result.
 */
async function readAccounts(): Promise<AccountsRead> {
    try {
        const result = await authClient.multiSession.listDeviceSessions()
        if (result.error) {
            // `message` is optional on the error contract, so a failure that
            // arrives without text still has to say something to the person
            // reading it.
            return {
                ok: false,
                message: result.error.message ?? LOAD_FAILED_MESSAGE,
            }
        }
        // `data` is non-null once `error` is ruled out — no fallback needed.
        return { ok: true, accounts: result.data }
    } catch (caught) {
        logger.error('Failed to list the accounts open in this browser', {
            error: caught,
        })
        return { ok: false, message: LOAD_FAILED_MESSAGE }
    }
}

export function useDeviceAccounts(): UseDeviceAccountsResult {
    const { data: session } = useSession()
    const activeSessionToken = session?.session.token

    const [accounts, setAccounts] = React.useState<DeviceAccount[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [pendingToken, setPendingToken] = React.useState<string | null>(null)

    const applyRead = React.useCallback((read: AccountsRead) => {
        if (read.ok) {
            setAccounts(read.accounts)
            return
        }
        setError(read.message)
    }, [])

    const reload = React.useCallback(async () => {
        setIsLoading(true)
        setError(null)

        try {
            applyRead(await readAccounts())
        } finally {
            setIsLoading(false)
        }
    }, [applyRead])

    React.useEffect(() => {
        // State is applied from the promise callbacks, never synchronously in
        // the effect body, and `isCancelled` keeps the settle handlers from
        // writing state after unmount.
        let isCancelled = false

        void readAccounts()
            .then((read) => {
                if (!isCancelled) {
                    applyRead(read)
                }
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsLoading(false)
                }
            })

        return () => {
            isCancelled = true
        }
    }, [applyRead])

    const switchAccount = React.useCallback(async (sessionToken: string) => {
        setPendingToken(sessionToken)
        setError(null)

        const result = await authClient.multiSession.setActive({ sessionToken })
        if (result.error) {
            logger.error('Failed to switch the active account', {
                error: result.error,
            })
            setError(result.error.message ?? "Couldn't switch to that account.")
            setPendingToken(null)
            return
        }

        // The server swapped the primary session cookie. Everything on this
        // page belongs to the previous identity now, so re-read it from
        // scratch instead of rendering the new user over the old user's data.
        window.location.reload()
    }, [])

    const removeAccount = React.useCallback(
        async (sessionToken: string) => {
            setPendingToken(sessionToken)
            setError(null)

            const result = await authClient.multiSession.revoke({
                sessionToken,
            })
            if (result.error) {
                logger.error('Failed to sign out of a browser account', {
                    error: result.error,
                })
                setError(
                    result.error.message ?? "Couldn't sign out of that account."
                )
                setPendingToken(null)
                return
            }

            setPendingToken(null)

            if (sessionToken === activeSessionToken) {
                // Removing the account in use promotes another retained account
                // or signs this browser out entirely — either way the identity
                // changed, so reload rather than re-read.
                window.location.reload()
                return
            }

            await reload()
        },
        [activeSessionToken, reload]
    )

    return {
        accounts,
        isLoading,
        error,
        pendingToken,
        activeSessionToken,
        switchAccount,
        removeAccount,
        reload,
    }
}
