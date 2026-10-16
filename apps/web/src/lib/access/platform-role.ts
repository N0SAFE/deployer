'use client'

import type { PlatformRole } from '@deployer/auth/permissions'
import { useSession } from '@/lib/auth'

import {
	isPlatformAdminRole,
	isPlatformRole,
	isPlatformRoleAtLeast,
} from './platform-role.rules'

/**
 * Platform-role HOOKS — the React side of the policy in `platform-role.rules.ts`.
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * `session?.user.role === 'admin' || session?.user.role === 'superAdmin'` was
 * written out at five call sites (two hooks, the sidebar, the command palette,
 * and the settings nav). Two of those hooks — `useCanManageNetwork` and
 * `useIsPlatformAdmin` — were byte-identical, differing only in their doc
 * comment. That is the same shape of duplication that produced the
 * `admin`/`developer` bug on the service side: a policy restated per call site,
 * where one copy drifts and the others silently disagree.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It is NOT the authorization boundary. The API enforces the real rule on every
 * call (`requireAuth()`, `requirePlatformRole()`); this only decides whether to
 * render a control. Hiding a button is UX, not security, and treating the two as
 * the same thing is how a permission ends up enforced only in the browser.
 *
 * The rules live in the sibling `.rules.ts`, with no React or auth imports, so
 * they can be unit-tested — importing this file builds a Better Auth client at
 * module load, which a unit test cannot do.
 */

/** The session's platform role, or `null` when there is no session or the value is not a role. */
export function usePlatformRoleValue(): PlatformRole | null {
	const { data: session } = useSession()
	const role = session?.user ? (session.user as { role?: unknown }).role : undefined
	return isPlatformRole(role) ? role : null
}

/** Is the signed-in user a platform administrator? */
export function useIsPlatformAdmin(): boolean {
	return isPlatformAdminRole(usePlatformRoleValue())
}

/**
 * Changing how the stack is reached, or who is in the mesh, is a platform-admin act.
 *
 * Kept as a named hook rather than folded into `useIsPlatformAdmin` at the call
 * sites: the NAME is what documents why a given control is gated, and the two
 * answering the same question today is a coincidence a reader should not have to
 * infer from `=== 'admin' || === 'superAdmin'` at each site.
 */
export function useCanManageNetwork(): boolean {
	return useIsPlatformAdmin()
}

/**
 * Programmatic access to the platform role.
 *
 * `hasRole`/`isAtLeast` take a ROLE rather than a hardcoded name, so a call site
 * cannot introduce a role string the platform does not define.
 */
export function usePlatformRole(): {
	role: PlatformRole | null
	hasRole: (roles: readonly PlatformRole[]) => boolean
	isAtLeast: (minimum: PlatformRole) => boolean
	isAdmin: boolean
} {
	const role = usePlatformRoleValue()
	return {
		role,
		hasRole: (roles) => role !== null && roles.includes(role),
		isAtLeast: (minimum) => role !== null && isPlatformRoleAtLeast(role, minimum),
		isAdmin: isPlatformAdminRole(role),
	}
}

/** Re-exported so a caller needs one import for both the rules and the hooks. */
export {
	isPlatformAdminRole,
	isPlatformRole,
	isPlatformRoleAtLeast,
	platformRolesByPrivilege,
} from './platform-role.rules'
