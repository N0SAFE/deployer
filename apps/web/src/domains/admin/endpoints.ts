/**
 * Admin Domain - Endpoints
 * 
 * Centralized endpoint definitions using:
 * - ORPC contracts (from API) - used directly
 * - Custom contracts (Better Auth Admin) - created with custom() helper
 * 
 * All endpoints share the same ORPC-like API:
 * - .call(input) - Direct execution
 * - .queryOptions(input) - TanStack Query options
 * - .mutationOptions() - TanStack Mutation options
 * - .queryKey(input) - Cache key for invalidation
 */

import type { PlatformRole } from '@deployer/auth'

import { authClient } from '@/lib/auth'
import { orpc } from '@/lib/orpc'

import { STALE_TIME } from '../shared/config'
import { custom } from '../shared/helpers'

import {
  listUsersSchema,
  banUserSchema,
  unbanUserSchema,
  setRoleSchema,
  createUserSchema,
  updateUserSchema,
  removeUserSchema,
  impersonateSchema,
  setPasswordSchema,
  revokeUserSessionSchema,
  userSessionsSchema,
} from './schemas'

// ============================================================================
// ORPC CONTRACTS (from API)
// ============================================================================

/**
 * ORPC API contracts (if any admin endpoints are exposed via ORPC)
 * Currently empty - all admin operations go through Better Auth SDK
 */
const orpcContracts = {} as const

// ============================================================================
// CUSTOM CONTRACTS (Better Auth Admin)
// ============================================================================

/**
 * Better Auth Admin plugin wrapped in custom contracts
 * Uses custom() helper to create ORPC-like contracts
 */
const customContracts = {
  /**
   * List users with pagination and sorting
   */
  listUsers: custom({
    input: listUsersSchema,
    keys: (i) => ['admin', 'listUsers', i],
    // The identity service owns the list (server pagination), so the admin surface is the same procedure the users page
    // reads — no Better Auth admin route in between.
    handler: async (input) => {
      const page = await orpc.user.list.call({
        query: {
          limit: input.query.limit ?? 20,
          offset: input.query.offset ?? 0,
          sortBy: input.query.sortBy,
          sortDirection: input.query.sortDirection,
        },
      })
      return { users: page.data, total: page.meta.total, limit: page.meta.limit, offset: page.meta.offset }
    },
    staleTime: STALE_TIME.DEFAULT,
  }),

  /**
   * Check if user has specific permissions
   */
  /**
   * Ban a user
   */
  banUser: custom({
    input: banUserSchema,
    keys: (i) => ['admin', 'banUser', i],
    handler: async (input) => orpc.user.setBanned.call({ params: { id: input.userId }, body: { banned: true } }),
  }),

  /**
   * Unban a user
   */
  unbanUser: custom({
    input: unbanUserSchema,
    keys: (i) => ['admin', 'unbanUser', i],
    handler: async (input) => orpc.user.setBanned.call({ params: { id: input.userId }, body: { banned: false } }),
  }),

  /**
   * Set user role
   */
  setRole: custom({
    input: setRoleSchema,
    keys: (i) => ['admin', 'setRole', i],
    handler: async (input) => {
      const role = Array.isArray(input.role) ? input.role[0] : input.role
      if (role === undefined) throw new Error('a role is required')
      // `input.role` was validated against `platformSchemas.roleNames` (the same union); the schema widens it to string.
      return orpc.user.setRole.call({ params: { id: input.userId }, body: { role: role as PlatformRole } })
    },
  }),

  /**
   * Create a new user
   */
  createUser: custom({
    input: createUserSchema,
    keys: (i) => ['admin', 'createUser', i],
    handler: async (input) => {
      const role = Array.isArray(input.role) ? input.role[0] : input.role
      return orpc.user.create.call({
        name: input.name,
        email: input.email,
        password: input.password,
        ...(role === undefined ? {} : { role: role as PlatformRole }),
      })
    },
  }),

  /**
   * Update user data
   */
  updateUser: custom({
    input: updateUserSchema,
    keys: (i) => ['admin', 'updateUser', i],
    // The identity update takes the patch as its body; the page passes a free-form record.
    handler: async (input) =>
      orpc.user.update.call({ ...input.data, id: input.userId }),
  }),

  /**
   * Act as another user (read-only, one hour, after a passkey step-up).
   *
   * Better Auth's plugin endpoint, not a BFF procedure: it must replace the session cookie on the API origin.
   */
  impersonate: custom({
    input: impersonateSchema,
    keys: (i) => ['admin', 'impersonate', i],
    handler: async (input) => {
      const result = await authClient.impersonate({ userId: input.userId, reason: input.reason })
      if (result.error) throw new Error(result.error.message ?? 'Impersonation refused')
      return result.data
    },
  }),

  /**
   * Set a temporary password (`AUTH-015`). Ends the target's sessions: a password change must not leave one alive.
   */
  setPassword: custom({
    input: setPasswordSchema,
    keys: (i) => ['admin', 'setPassword', i],
    handler: async (input) =>
      orpc.user.setPassword.call({ params: { id: input.userId }, body: { password: input.password } }),
  }),

  /** Every session an account holds (`session:list`). */
  listSessions: custom({
    input: userSessionsSchema,
    keys: (i) => ['admin', 'listSessions', i],
    handler: async (input) => orpc.user.listSessions.call({ params: { id: input.userId } }),
  }),

  /** End ONE session (`session:revoke`), with a passkey proof. */
  revokeSession: custom({
    input: revokeUserSessionSchema,
    keys: (i) => ['admin', 'revokeSession', i],
    handler: async (input) =>
      orpc.user.revokeSession.call({ params: { id: input.userId, sessionId: input.sessionId } }),
  }),

  /**
   * Remove a user
   */
  removeUser: custom({
    input: removeUserSchema,
    keys: (i) => ['admin', 'removeUser', i],
    handler: async (input) => orpc.user.delete.call({ params: { id: input.userId } }),
  }),
} as const

// ============================================================================
// UNIFIED ENDPOINTS EXPORT
// ============================================================================

/**
 * All admin endpoints in one place
 * Mix of ORPC contracts and custom contracts with unified API
 */
export const adminEndpoints = {
  ...orpcContracts,
  ...customContracts,
} as const

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AdminEndpoints = typeof adminEndpoints
