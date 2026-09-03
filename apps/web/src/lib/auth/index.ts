import { hasMasterTokenPlugin } from '@repo/auth/client'
import { createSessionAwareAuthClient, DEFAULT_SESSION_QUERY_KEY } from '@repo/auth/react/session'
import { authClient as originalAuthClient } from './options'

// =============================================================================
// SESSION TYPE - Inferred from the original auth client
// =============================================================================

/**
 * Session type inferred from Better Auth client.
 * This avoids circular dependencies by using the original client's $Infer.
 */
export type Session = typeof originalAuthClient.$Infer.Session

// =============================================================================
// SESSION-AWARE AUTH CLIENT
// =============================================================================

// Session query key - must match the key used in SessionPage hydration
export const SESSION_QUERY_KEY = DEFAULT_SESSION_QUERY_KEY

// Create session-aware auth client that integrates with React Query cache
// The enhanced useSession hook will:
// 1. Subscribe to React Query cache via useSyncExternalStore (picks up HydrationBoundary data)
// 2. Fall back to Better Auth's useSession (client-side fetch)
export const authClient: typeof originalAuthClient = createSessionAwareAuthClient(originalAuthClient, {
    sessionQueryKey: SESSION_QUERY_KEY,
})

// Re-export common auth client methods and types
export const signIn: typeof authClient.signIn = authClient.signIn
export const signUp: typeof authClient.signUp = authClient.signUp
export const getSession: typeof authClient.getSession = authClient.getSession
export const useSession: typeof authClient.useSession = authClient.useSession
export const $store: typeof authClient.$store = authClient.$store
export const $fetch: typeof authClient.$fetch = authClient.$fetch
export const $ERROR_CODES: typeof authClient.$ERROR_CODES = authClient.$ERROR_CODES
export const $Infer: typeof authClient.$Infer = authClient.$Infer

// Create the masterTokenSignOut by wrapping the original signOut with the plugin's factory
// The plugin provides $masterTokenSignOut as a factory that takes the original signOut
// and returns a wrapped version that handles dev auth mode
export const signOut = hasMasterTokenPlugin(authClient)
    ? authClient.$masterTokenSignOut(authClient.signOut)
    : authClient.signOut

/**
 * Typed email/password sign-in via the Better Auth client.
 *
 * Single source for the sign-in call — the setup flow used to duplicate a raw
 * `fetch("/api/auth/sign-in/email", ...)` with an unchecked `(body as
 * Record<string, unknown>).message as string` assertion. Better Auth returns
 * `{ data, error }` (it does not throw), so we normalize the failure into a
 * thrown Error with the server message.
 */
export async function signInWithEmail(input: { email: string; password: string }) {
    const result = await authClient.signIn.email(input)
    if (result.error) {
        throw new Error(result.error.message ?? "Sign in failed")
    }
    return result.data
}

// Auth pages configuration for Better Auth
export const pages = {
    signIn: '/auth/signin',
    signOut: '/auth/logout',
    error: '/auth/error',
} as const
