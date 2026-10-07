/**
 * Client-side Better Auth plugins
 * 
 * This module exports all client plugins and their wrapper functions.
 * Use the `use*Client` functions for plugins that require access control configuration.
 */

import { adminClient } from "better-auth/client/plugins";
import type { BetterAuthClientPlugin } from "better-auth/client";
import {
  platformAc,
  platformRoles,
} from "@repo/auth/permissions/index";
import type { invitePlugin } from "@repo/auth/server/plugins/invite";

// ============================================================================
// Re-export existing plugins
// ============================================================================

export { default as masterTokenClient } from "@repo/auth/client/plugins/masterToken/index";
export { loginAsClientPlugin } from "@repo/auth/client/plugins/loginAs/index";

// Re-export guards.
//
// These are explicit named re-exports rather than `export *` on purpose: this
// module is built by `pkg-build`, which marks the package's own name external
// (`@repo/auth`, `@repo/auth/*`). `bun build` keeps a lone `export *` from a
// file that contains nothing else, but DROPS wildcard re-exports in a module
// that also declares other exports — silently, with no warning. That is exactly
// this file: the wildcard arms vanished from the emitted `dist/**/plugins/index
// .mjs` while the named ones survived, so `hasMasterTokenPlugin` and the
// masterToken state helpers were missing at runtime and the web build failed
// with "Export hasMasterTokenPlugin doesn't exist in target module".
//
// Keep these lists in sync with the source modules they mirror.
export { hasMasterTokenPlugin } from "@repo/auth/client/plugins/masterToken/guard";
export type { MasterTokenActions } from "@repo/auth/client/plugins/masterToken/guard";

// Re-export plugin utilities.
export {
  MASTER_TOKEN_COOKIE_NAME,
  MasterTokenManager,
  clearMasterToken,
  getDevtoolsApiKey,
  getMasterTokenEnabled,
  setDevtoolsApiKeyProvider,
  setMasterTokenEnabled,
} from "@repo/auth/client/plugins/masterToken/state";
export type { MasterTokenSubscriber } from "@repo/auth/client/plugins/masterToken/state";

// Export components
export { MasterTokenProvider, useMasterToken } from "@repo/auth/client/plugins/masterToken/components/provider";

// ============================================================================
// Admin Client Plugin
// ============================================================================

/**
 * Client plugin wrapper for the admin plugin
 * 
 * Pre-configures adminClient with the project's access control and roles.
 * This ensures the client has the same AC configuration as the server.
 * 
 * Provides type-safe methods for:
 * - Creating/updating/deleting users
 * - Managing user roles and bans
 * - Impersonating users
 * - Checking permissions
 * 
 * @example
 * ```typescript
 * import { useAdminClient } from '@repo/auth/client/plugins/index'
 * 
 * const authClient = createAuthClient({
 *   plugins: [useAdminClient()]
 * })
 * 
 * // Check permissions
 * const canCreate = await authClient.admin.hasPermission({
 *   permissions: { project: ['create'] }
 * })
 * 
 * // Set user role
 * await authClient.admin.setRole({
 *   userId: 'user-id',
 *   role: 'admin'
 * })
 * ```
 */
export function useAdminClient() {
  return adminClient({
    ac: platformAc,
    roles: platformRoles,
  });
}

export type AdminClientPlugin = ReturnType<typeof useAdminClient>;

// ============================================================================
// Invite Client Plugin
// ============================================================================

/**
 * Client plugin for the invitation system
 * 
 * Provides type-safe methods for:
 * - Creating invitations with email and role
 * - Checking invitation token validity
 * - Validating invitation and creating user account
 * 
 * @example
 * ```typescript
 * import { useInviteClient } from '@repo/auth/client/plugins/index'
 * 
 * const authClient = createAuthClient({
 *   plugins: [useInviteClient()]
 * })
 * 
 * // Create an invite
 * const { data, error } = await authClient.invite.create({
 *   email: 'user@example.com',
 *   role: 'user'
 * })
 * 
 * // Check an invite
 * const check = await authClient.invite.check({ token: 'abc123...' })
 * 
 * // Validate and create user
 * await authClient.invite.validate({ 
 *   token: 'abc123...', 
 *   password: 'password123',
 *   name: 'John Doe'
 * })
 * ```
 */
export function useInviteClient() {
  return {
    id: "invite",
    $InferServerPlugin: {} as ReturnType<typeof invitePlugin>,
  } satisfies BetterAuthClientPlugin;
}

export type InviteClientPlugin = ReturnType<typeof useInviteClient>;
