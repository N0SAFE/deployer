/**
 * Platform-role RULES — pure, no React and no auth client.
 *
 * Split from `platform-role.ts` so the policy can be tested without pulling in
 * the session client: importing the hooks drags `@/lib/auth` in, which builds a
 * Better Auth client at module load and cannot run in a unit test.
 */

import { PLATFORM_ROLES, type PlatformRole } from '@deployer/auth/permissions'

const PLATFORM_RANK: Readonly<Record<PlatformRole, number>> = {
	viewer: 0,
	operator: 1,
	admin: 2,
	superAdmin: 3,
}

/** Roles that administer the platform. */
const PLATFORM_ADMIN_ROLES: readonly PlatformRole[] = ['admin', 'superAdmin']

/**
 * Is `value` a role the platform defines?
 *
 * Takes `unknown` because the session's `role` is an untyped string on the wire
 * — the value arrives from the server, so it must be validated rather than cast.
 */
export function isPlatformRole(value: unknown): value is PlatformRole {
	return typeof value === 'string' && value in PLATFORM_RANK
}

/** Rank of a role, or `-1` for anything unrecognised (an unknown role is least privileged). */
function rankOf(role: unknown): number {
	return isPlatformRole(role) ? PLATFORM_RANK[role] : -1
}

/** Does `role` meet or exceed `minimum`? Unknown roles never do. */
export function isPlatformRoleAtLeast(role: unknown, minimum: PlatformRole): boolean {
	return rankOf(role) >= rankOf(minimum)
}

/** Does `role` administer the platform? */
export function isPlatformAdminRole(role: unknown): boolean {
	return isPlatformRole(role) && PLATFORM_ADMIN_ROLES.includes(role)
}

/** Every role, highest privilege first — for a picker that must not hardcode them. */
export const platformRolesByPrivilege: readonly PlatformRole[] = [...PLATFORM_ROLES].sort(
	(a, b) => rankOf(b) - rankOf(a),
)
