/**
 * React utilities for Better Auth.
 * 
 * This module provides React-specific utilities organized by concern:
 * - session: Session management (useSession, getSession, prefetch)
 * 
 * For isomorphic imports, use the specific submodules:
 * - '@deployer/auth/react/session' - Shared types and constants
 * - '@deployer/auth/react/session/client' - Client-side hooks
 * - '@deployer/auth/react/session/server' - Server-side utilities
 */

// Re-export session types and constants (isomorphic)
export {
    DEFAULT_SESSION_QUERY_KEY,
    type SessionResult,
    type CreateUseSessionOptions,
    type CreateGetSessionOptions,
    type PrefetchSessionOptions,
} from './session/index'

