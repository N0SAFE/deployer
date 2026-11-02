/**
 * Platform-role RULES — pure, no React and no auth client.
 *
 * Split from `platform-role.ts` so the policy can be tested without pulling in
 * the session client: importing the hooks drags `@/lib/auth` in, which builds a
 * Better Auth client at module load and cannot run in a unit test.
 *
 * The hierarchy itself lives in `@deployer/auth/authz`, shared with the API (the Better Auth admin hooks and the
 * identity service). A UI that ranked roles on its own could disagree with the server about who is an administrator —
 * which is exactly how `viewer` once satisfied `minimumRole: 'admin'`, because the list is declared highest-first
 * and the check compared array indexes.
 */

import { isPlatformAdministrator, platformRoleRank } from '@deployer/auth/authz'
import { PLATFORM_ROLES, type PlatformRole } from '@deployer/auth/permissions'

/**
 * Is `value` a role the platform defines?
 *
 * Takes `unknown` because the session's `role` is an untyped string on the wire — the value arrives from the server,
 * so it must be validated rather than cast.
 */
export function isPlatformRole(value: unknown): value is PlatformRole {
	return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value)
}

/** Does `role` meet or exceed `minimum`? Unknown roles never do. */
export function isPlatformRoleAtLeast(role: unknown, minimum: PlatformRole): boolean {
	return platformRoleRank(typeof role === 'string' ? role : null) >= platformRoleRank(minimum)
}

/** Does `role` administer the platform? */
export function isPlatformAdminRole(role: unknown): boolean {
	return isPlatformAdministrator(typeof role === 'string' ? role : null)
}

/** Every role, highest privilege first — for a picker that must not hardcode them. */
export const platformRolesByPrivilege: readonly PlatformRole[] = [...PLATFORM_ROLES].sort(
	(a, b) => platformRoleRank(b) - platformRoleRank(a),
)
