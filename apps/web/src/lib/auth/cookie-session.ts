/**
 * Cookie-based Session Retrieval
 *
 * This module reads the Better Auth session on the server by asking the API (`/api/auth/get-session`) with the caller's
 * cookie. It does NOT decrypt the cookie locally: that needed the platform secret, which the API generates on first boot
 * and keeps in its own `node_config` (SEC-100), so the web app has no copy and must not have one.
 *
 * Note: This module uses unstable_rethrow() to properly handle Next.js internal errors.
 * With PPR enabled, cookies() throws a special error that Next.js uses to determine
 * which parts of a page can be statically generated. If we catch that error in a try/catch,
 * the build fails. By calling unstable_rethrow(error) as the first line in our catch block,
 * we re-throw any Next.js internal errors (like PPR bailouts) so they propagate correctly,
 * while still catching and handling application-level errors.
 */
import 'server-only'

import { getSessionCookie } from 'better-auth/cookies'
import { cookies } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'

import { AppLogger } from '@deployer/logger'

import type { Session } from '@/lib/auth'

import { validateEnvSafe } from '#/env'

// Validate environment variables
const env = validateEnvSafe(process.env).data

const cookieLogger = new AppLogger('web').scope('CookieSession')

/**
 * Check if a session cookie exists.
 * This is a fast check that doesn't decrypt the cookie.
 *
 * @returns true if the session cookie exists
 */
export async function hasSessionCookie(): Promise<boolean> {
    return (await getRawSessionCookie()) !== null
}

/**
 * Get the raw session cookie value (without decryption).
 * This is primarily useful for forwarding cookies to API calls.
 *
 * @returns The session cookie value or null
 */
export async function getRawSessionCookie(): Promise<string | null> {
    try {
        return getSessionCookie(
            new Headers({
                cookie: (await cookies()).toString(),
            })
        )
    } catch (error) {
        // Re-throw internal Next.js errors (PPR bailout, redirects, etc.)
        unstable_rethrow(error)
        cookieLogger.log.error('getRawSessionCookie: ERROR', { error })
        return null
    }
}

/**
 * The session for the request's cookie, as the API answers it, or null when there is none or the API refuses it.
 *
 * An unreachable API answers null: it must never look like an authenticated user.
 */
export async function getSessionFromCookie(): Promise<Session | null> {
    if (!env?.NEXT_PUBLIC_API_URL) {
        cookieLogger.log.warn(
            'getSessionFromCookie: NEXT_PUBLIC_API_URL not configured'
        )
        return null
    }

    try {
        const cookie = (await cookies()).toString()
        if (getSessionCookie(new Headers({ cookie })) === null) return null

        const response = await fetch(
            `${env.NEXT_PUBLIC_API_URL}/api/auth/get-session`,
            { headers: { cookie }, cache: 'no-store' }
        )
        if (!response.ok) return null
        const body = (await response.json()) as Session | null
        return body !== null && typeof body === 'object' && 'user' in body
            ? body
            : null
    } catch (error) {
        // Re-throw internal Next.js errors (PPR bailout, redirects, etc.)
        unstable_rethrow(error)
        cookieLogger.log.error('getSessionFromCookie: ERROR', { error })
        return null
    }
}
