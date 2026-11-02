/**
 * Server-side Better Auth plugins
 * 
 * This module exports all server plugins and their wrapper functions.
 * Use the `use*` functions for plugins that require access control configuration.
 */

import { apiKey } from "@better-auth/api-key";
import { admin } from "better-auth/plugins";

import { isPlatformAdministrator, refuseRoleGrant } from "../../authz/hierarchy";
import {
  platformAc,
  platformRoles,
  platformSchemas,
} from "../../adapters/better-auth/config";

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
/**
 * The key in a request's headers, or `null`.
 *
 * Two spellings are accepted because two clients already exist: the plugin's own `x-api-key`, and
 * `Authorization: Bearer dk_…`, which is what this platform's ORPC link, CLI and devtools send. Without the second
 * one, a minted key authenticated nowhere — the audit's "keys are unusable" finding.
 */
export function apiKeyFromHeaders(headers: { get(name: string): string | null } | undefined): string | null {
  if (headers === undefined) return null

  const direct = headers.get('x-api-key')
  if (direct !== null && direct.length > 0) return direct

  const authorization = headers.get('authorization')
  if (authorization === null) return null

  const [scheme, ...rest] = authorization.trim().split(/\s+/u)
  if (scheme?.toLowerCase() !== 'bearer') return null

  const token = rest.join(' ')
  return token.startsWith(API_KEY_PREFIX) ? token : null
}

/** The prefix `apiKey({ defaultPrefix })` puts in front of every issued key. */
export const API_KEY_PREFIX = 'dk'

export function useApiKey(): ReturnType<typeof apiKey> {
  return apiKey({
    // A key resolves to a session, so every existing guard keeps working.
    enableSessionForAPIKeys: true,
    // Keys carry context (purpose / label), which is what distinguishes a
    // short-lived devtools key from one bound to a deployment.
    enableMetadata: true,
    // Keys are prefixed so they are recognisable in logs and secret scanners.
    defaultPrefix: API_KEY_PREFIX,
    rateLimit: {
      enabled: true,
      timeWindow: 60 * 60 * 1000, // 1 hour
      maxRequests: 1000,
    },
    // Read the key from whichever header the caller used; the plugin's default reads `x-api-key` only.
    customAPIKeyGetter: (ctx) => apiKeyFromHeaders(ctx.headers),
  });
}

export type ApiKeyPlugin = ReturnType<typeof useApiKey>;

// ============================================================================
// Invite Plugin
// ============================================================================

/**
 * Type-safe helper to configure the invite plugin with your role system
 * Uses the generated role schema for validation
 * 
 * @example
 * ```typescript
 * import { useInvite } from './index'
 * 
 * betterAuth({
 *   plugins: [
 *     useAdmin({ defaultRole: 'guest' }),
 *     useInvite({
 *       inviteDurationDays: options?.inviteDurationDays ?? 7,
 *     })
 *   ]
 * })
 * ```
 */
/**
 * Whether `actorRole` may invite someone who would hold `invitedRole`.
 *
 * Administrators only, and never a role at or above the inviter's own: an invitation is a grant, so it obeys the same
 * hierarchy as `admin/set-role` — otherwise inviting is the way around it.
 */
export function mayInvite(actorRole: string | null | undefined, invitedRole: string): boolean {
  if (!isPlatformAdministrator(actorRole)) return false
  return refuseRoleGrant({ actorRole, grantedRole: invitedRole }) === null
}

export function useInvite(
  options?: Omit<InvitePluginOptions, "roleSchema" | "canCreateInvite" | "canInviteRole">
) {
  return invitePlugin({
    inviteDurationDays: options?.inviteDurationDays ?? 7,
    
    // Type assertion is safe here - platformSchemas.roleNames will always be compatible
    // with the RoleSchemaType that invitePlugin expects
    roleSchema: platformSchemas.roleNames,

    // ── WHO MAY INVITE, AND WHAT THEY MAY HAND OUT ────────────────────────
    // Both hooks used to be dropped, so `canCreateInvite` stayed undefined and
    // ANY session could mint an invite — including one for `superAdmin`, with the
    // token returned in the response. The hierarchy that governs the admin
    // endpoints governs invitations now: administrators only, and never a role at
    // or above the inviter's own.
    canCreateInvite: (user) => isPlatformAdministrator((user as { role?: string | null }).role),
    canInviteRole: (user, role) => mayInvite((user as { role?: string | null }).role, role),
  });
}

export type InvitePlugin = ReturnType<typeof useInvite>;