/**
 * Session management utilities for React.
 *
 * This module provides isomorphic session management:
 * - Import from './client' for client-side hooks (useSession)
 * - Import from './server' for server-side utilities (getSession, prefetch)
 * - Import from './shared' or this index for types and constants
 *
 * @example
 * ```ts
 * // Client-side usage
 * import { createUseSession } from './client'
 *
 * // Server-side usage
 * import { createGetSession, createPrefetchSession } from './server'
 *
 * // Shared types (isomorphic)
 * import { DEFAULT_SESSION_QUERY_KEY, type SessionResult } from './index'
 * ```
 */

// Re-export shared types and constants (isomorphic)
export {
    DEFAULT_SESSION_QUERY_KEY,
    type SessionResult,
    type CreateUseSessionOptions,
    type CreateGetSessionOptions,
    type PrefetchSessionOptions,
} from './shared'
