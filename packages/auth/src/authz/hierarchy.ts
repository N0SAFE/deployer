/**
 * The platform role hierarchy: who may act on whom, and who may grant what.
 *
 * One rule set, three consumers — the Better Auth admin endpoints (`adminHierarchyPlugin`), the identity service's
 * `userRules`, and (later) the grants path — because a hierarchy that exists twice drifts the first time one copy is
 * fixed. Pure and dependency-free on purpose: the web app imports the same vocabulary as the API.
 *
 * The rule is rank, not capability: `admin` holds `user:set-role`, which says it may assign roles, not that it may
 * assign its own or a superior one. Anything that needs to *administer* a user therefore combines:
 *
 *   1. `refuseAdminAction({ actorRole, targetRole })` — may this actor touch this account at all;
 *   2. `refuseRoleGrant({ actorRole, grantedRole })` — may this actor hand out this role.
 *
 * Both answer `null` when allowed and a refusal otherwise. Each boundary turns a refusal into its own error type
 * (`ctx.error("FORBIDDEN")` in Better Auth, `ForbiddenError` in the identity domain), so this file stays free of
 * transport and of Effect.
 */

import { SYSTEM_ROLES_TABLE } from "./catalog";
import { rankInRoles, type RoleTable } from "./roles";

/**
 * Platform roles, highest first. The DB default (`user`) and an empty column are not platform roles: they rank below
 * every entry here, which is what makes a freshly created account untouchable by another plain account.
 */
export const PLATFORM_ROLE_ORDER = ["superAdmin", "admin", "operator", "viewer"] as const;

export type PlatformRoleName = (typeof PLATFORM_ROLE_ORDER)[number];



/** The one role that may act on everyone and grant anything. */
const ROOT_ROLE: PlatformRoleName = "superAdmin";

/** Roles that may administer other accounts at all. */
const ADMINISTRATOR_ROLES: ReadonlySet<string> = new Set<string>([ROOT_ROLE, "admin"]);

/**
 * Position of a stored role, read from the role table.
 *
 * One source: the same table a `roles` row will supply, so a custom role inherits its rank from its definition rather
 * than from a constant here. Unknown (the `user` default, a removed role, nothing) ranks below every declared role.
 */
export function platformRoleRank(role: string | null | undefined, table: RoleTable = SYSTEM_ROLES_TABLE): number {
	return rankInRoles(table, role);
}

/** Whether a role may administer other accounts. */
export function isPlatformAdministrator(role: string | null | undefined): boolean {
	return ADMINISTRATOR_ROLES.has(role ?? "");
}

/** Why a hierarchy check refused. `message` is safe to show a client. */
export type HierarchyRefusal =
	| {
			readonly reason: "not-an-administrator";
			readonly message: string;
			readonly actorRole: string | null;
	  }
	| {
			readonly reason: "outranked";
			readonly message: string;
			readonly actorRole: string | null;
			readonly targetRole: string | null;
	  }
	| {
			readonly reason: "not-grantable";
			readonly message: string;
			readonly actorRole: string | null;
			readonly grantedRole: string | null;
	  };

/**
 * May `actorRole` act on an account whose role is `targetRole`?
 *
 * Only an administrator may act at all, the root role may act on anyone, and everyone else must strictly outrank the
 * target. A peer or a superior is untouchable — that is what stops an `admin` from banning another `admin` (or a
 * `superAdmin`), and what keeps privilege from being escalated by demoting whoever is above you.
 */
export function refuseAdminAction(input: {
	readonly actorRole?: string | null;
	readonly targetRole?: string | null;
}): HierarchyRefusal | null {
	const actorRole = input.actorRole ?? null;
	const targetRole = input.targetRole ?? null;

	if (!isPlatformAdministrator(actorRole)) {
		return {
			reason: "not-an-administrator",
			message: "this operation requires platform administration",
			actorRole,
		};
	}

	if (actorRole === ROOT_ROLE) return null;

	if (platformRoleRank(targetRole) < platformRoleRank(actorRole)) return null;

	return {
		reason: "outranked",
		message: `a ${String(actorRole)} may not act on an account whose role is ${targetRole ?? "unset"}`,
		actorRole,
		targetRole,
	};
}

/**
 * May `actorRole` grant `grantedRole`?
 *
 * Capability buys administration, not self-promotion: an administrator may only hand out roles strictly below its own,
 * and only the root role may grant the root role. `admin` therefore cannot mint another `admin` or a `superAdmin` — the
 * escalation the platform had before this rule existed.
 */
export function refuseRoleGrant(input: {
	readonly actorRole?: string | null;
	readonly grantedRole?: string | null;
}): HierarchyRefusal | null {
	const actorRole = input.actorRole ?? null;
	const grantedRole = input.grantedRole ?? null;

	if (!isPlatformAdministrator(actorRole)) {
		return {
			reason: "not-an-administrator",
			message: "this operation requires platform administration",
			actorRole,
		};
	}

	if (grantedRole === ROOT_ROLE) {
		return actorRole === ROOT_ROLE
			? null
			: {
					reason: "not-grantable",
					message: `only a ${ROOT_ROLE} may grant the ${ROOT_ROLE} role`,
					actorRole,
					grantedRole,
				};
	}

	if (actorRole === ROOT_ROLE) return null;

	if (grantedRole === null) return null;

	if (platformRoleRank(grantedRole) < platformRoleRank(actorRole)) return null;

	return {
		reason: "not-grantable",
		message: `a ${String(actorRole)} may not grant the ${grantedRole} role`,
		actorRole,
		grantedRole,
	};
}
