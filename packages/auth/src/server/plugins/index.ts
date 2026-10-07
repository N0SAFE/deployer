/**
 * Server-side Better Auth plugins
 * 
 * This module exports all server plugins and their wrapper functions.
 * Use the `use*` functions for plugins that require access control configuration.
 */

import { admin } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
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
export * from './agentAuth'
export * from './securityPlugins'

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
 * import { useAdmin } from '@repo/auth/server/plugins/index'
 * 
 * betterAuth({
 *   plugins: [
 *     useAdmin({ defaultRole: 'user' })
 *   ]
 * })
 * ```
 */
export function useAdmin() {
  return admin({
    ac: platformAc,
    roles: platformRoles,
  });
}

export type AdminPlugin = ReturnType<typeof useAdmin>;

// ============================================================================
// API Key Plugin
// ============================================================================

/**
 * Server plugin wrapper for the API Key plugin.
 *
 * Replaces the hand-rolled `ApiKeyService` (which issued `dk_<hex>` keys that
 * nothing could verify). Two properties make it a drop-in for the dev flows
 * that previously depended on the master token:
 *
 * - `enableSessionForAPIKeys` — a valid key produces a real session through
 *   `getSession()`, so the existing ORPC auth middleware, guards, decorators
 *   and permission checks work with **no changes**. No custom header parsing,
 *   no second auth path.
 * - `enableMetadata` — lets a key carry the context (purpose, environment)
 *   that a scoped dev key needs to be distinguishable from a production key.
 *
 * Use this instead of the master token anywhere a non-browser client needs
 * privileged access: the CLI, scripts, CI, and the devtools "act as user"
 * flow. Keys are scoped, expiring and revocable — `DEV_AUTH_KEY` is none of
 * those, and it reaches the browser bundle as `NEXT_PUBLIC_DEV_AUTH_KEY`.
 *
 * @example
 * ```typescript
 * betterAuth({ plugins: [useApiKey()] })
 * ```
 */
export function useApiKey(): ReturnType<typeof apiKey> {
  return apiKey({
    // A key resolves to a session, so every existing guard keeps working.
    enableSessionForAPIKeys: true,
    // Keys carry context (purpose / label), which is what distinguishes a
    // short-lived devtools key from one bound to a deployment.
    enableMetadata: true,
    // Keys are prefixed so they are recognisable in logs and secret scanners.
    defaultPrefix: 'dk',
    rateLimit: {
      enabled: true,
      timeWindow: 60 * 60 * 1000, // 1 hour
      maxRequests: 1000,
    },
  });
}

export type ApiKeyPlugin = ReturnType<typeof useApiKey>;

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
 * import { useInvite } from '@repo/auth/server/plugins/index'
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
    
    // Type assertion is safe here - platformSchemas.roleNames will always be compatible
    // with the RoleSchemaType that invitePlugin expects
    roleSchema: platformSchemas.roleNames,
  });
}

export type InvitePlugin = ReturnType<typeof useInvite>;