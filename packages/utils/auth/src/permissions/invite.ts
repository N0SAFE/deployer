import { invitePlugin } from "../server/plugins/invite";
import type { InvitePluginOptions } from "../server/plugins/invite";
import { schemas } from "./config";

/**
 * Type-safe helper to configure the invite plugin with your role system
 * Uses the generated role schema for validation
 * 
 * @example
 * ```typescript
 * import { useInvite } from '@repo/auth/permissions/invite'
 * 
 * betterAuth({
 *   plugins: [
 *     useAdmin({ defaultRole: 'sarah' }),
 *     useInvite({
 *       inviteDurationDays: 7,
 *     })
 *   ]
 * })
 * ```
 */
export function useInvite(
  options?: Omit<InvitePluginOptions, "roleSchema">
) {
  return invitePlugin({
    inviteDurationDays: 7,
    ...options,
    // Type assertion is safe here - schemas.roleNames will always be compatible
    // with the RoleSchemaType that invitePlugin expects
    roleSchema: schemas.roleNames,
  } as InvitePluginOptions);
}
