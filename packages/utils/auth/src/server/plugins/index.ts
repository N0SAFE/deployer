/**
 * Server-side Better Auth plugins
 * 
 * This module exports all server plugins and their wrapper functions.
 * Use the `use*` functions for plugins that require access control configuration.
 */

import { admin } from "better-auth/plugins";
import {
  platformAc,
  platformRoles,
  platformSchemas,
} from "../../permissions/config";
import { invitePlugin, type InvitePluginOptions } from "./invite";

// ============================================================================
// Re-export existing plugins
// ============================================================================

export * from './loginAs'
export * from './masterTokenAuth'
export * from './invite'
export * from './pushNotifications'

// ============================================================================
// Admin Plugin
// ============================================================================

/**
 * Server plugin wrapper for the admin plugin
 * 
 * Pre-configures admin with the project's access control and roles.
 * This ensures the server has consistent AC configuration.
 * 
 * Provides:
 * - User management (create, update, delete)
 * - Role management
 * - Ban management
 * - Impersonation
 * 
 * @example
 * ```typescript
 * import { useAdmin } from '@repo/auth/server/plugins'
 * 
 * betterAuth({
 *   plugins: [
 *     useAdmin({ defaultRole: 'user' })
 *   ]
 * })
 * ```
 */
export function useAdmin(
  options: Omit<Parameters<typeof admin>[0], "ac" | "roles"> = {}
) {
  return admin({
    ac: platformAc,
    roles: platformRoles,
    ...options,
  });
}

export type AdminPlugin = ReturnType<typeof useAdmin>;

// ============================================================================
// Invite Plugin
// ============================================================================

// Infer the actual role names type from the platformSchemas
type ConfiguredRoleNames = typeof platformSchemas.roleNames extends { _output: infer T } ? T extends string ? T : string : string;

/**
 * Type-safe helper to configure the invite plugin with your role system
 * Uses the generated role schema for validation
 * 
 * @example
 * ```typescript
 * import { useInvite } from '@repo/auth/server/plugins'
 * 
 * betterAuth({
 *   plugins: [
 *     useAdmin({ defaultRole: 'guest' }),
 *     useInvite({
 *       inviteDurationDays: 7,
 *     })
 *   ]
 * })
 * ```
 */
export function useInvite(
  options?: Omit<InvitePluginOptions<ConfiguredRoleNames>, "roleSchema">
) {
  return invitePlugin({
    inviteDurationDays: 7,
    ...options,
    // Type assertion is safe here - platformSchemas.roleNames will always be compatible
    // with the RoleSchemaType that invitePlugin expects
    roleSchema: platformSchemas.roleNames,
  });
}

export type InvitePlugin = ReturnType<typeof useInvite>;