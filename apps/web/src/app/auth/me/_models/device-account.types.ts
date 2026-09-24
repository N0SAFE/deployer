/**
 * Multi-session types.
 *
 * No Zod schema here on purpose: the shape is already owned by Better Auth's
 * `Session`/`User`, and re-declaring it as a schema would create a second
 * source of truth for the same data.
 */

import type { Session, User } from 'better-auth'

/**
 * One account currently open in this browser, as returned by
 * `authClient.multiSession.listDeviceSessions()`.
 *
 * Composed from Better Auth's own types rather than derived with
 * `ReturnType<typeof authClient.multiSession.listDeviceSessions>`: that
 * endpoint method is generic, and `ReturnType` on it collapses to `any` under
 * tsc — which silently erased every field check on the accounts list. The same
 * approach is used for `listSessions()` in `page.tsx`.
 *
 * `session.token` is the identifier every multi-session endpoint accepts, and
 * the value `useSession()` exposes for the active account.
 */
export interface DeviceAccount {
    session: Session
    user: User
}
