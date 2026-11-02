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

import { authClient } from '@/lib/auth'
import { orpc } from '@/lib/orpc'

import type { PlatformRole } from '@deployer/auth'

import { STALE_TIME } from '../shared/config'
import { custom, mapBetterAuth } from '../shared/helpers'

import {
  listUsersSchema,
  banUserSchema,
  unbanUserSchema,
  setRoleSchema,
  createUserSchema,
  updateUserSchema,
  removeUserSchema,
  hasPermissionSchema,
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
  hasPermission: custom({
    input: hasPermissionSchema,
    keys: (i) => ['admin', 'hasPermission', i],
    handler: authClient.admin.hasPermission,
    map: mapBetterAuth(),
    staleTime: STALE_TIME.SLOW,
  }),

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
    handler: authClient.admin.createUser,
    map: mapBetterAuth(),
  }),

  /**
   * Update user data
   */
  updateUser: custom({
    input: updateUserSchema,
    keys: (i) => ['admin', 'updateUser', i],
    handler: authClient.admin.updateUser,
    map: mapBetterAuth(),
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
