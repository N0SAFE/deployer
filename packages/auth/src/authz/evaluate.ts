import type { CapabilitySet, Condition, Decision, Facts, Scope } from "./types";
import type { Permission } from "./catalog";

/**
 * The decision, and it is PURE.
 *
 * Order: an explicit condition that does not hold is a deny; otherwise the permission must be in the resolved set. There
 * is deliberately **no role check and no bypass here** — `superAdmin` is simply a role whose capability set contains
 * everything, so an operator can see exactly what it holds, and a bug in a role cannot grant "everything" implicitly.
 * The deny-first ordering lives in the resolver (a deny grant removes a permission); this function stays total and
 * trivially testable.
 */
export function decide(input: {
	readonly permission: Permission;
	readonly scope: Scope;
	readonly capabilities: CapabilitySet;
	readonly facts: Facts;
	readonly condition?: Condition;
}): Decision {
	const { permission, scope, capabilities, facts, condition } = input;

	if (!capabilities.permissions.includes(permission)) {
		return {
			allowed: false,
			reason: capabilities.sources.length === 0 ? "no grant in this scope" : "not granted in this scope",
			permission,
			scope,
		};
	}

	const failed = conditionFailure(condition, facts);
	if (failed !== null) {
		return { allowed: false, reason: failed, permission, scope };
	}

	return {
		allowed: true,
		reason: `granted by ${capabilities.sources.join(", ") || "a direct permission"}`,
		permission,
		scope,
	};
}

/** Whether a capability set allows a permission, with no I/O — the function the web calls on its own session. */
export function can(capabilities: CapabilitySet | readonly Permission[], permission: Permission): boolean {
	const permissions = Array.isArray(capabilities) ? capabilities : (capabilities as CapabilitySet).permissions;
	return (permissions as readonly Permission[]).includes(permission);
}

/** The reason a condition refuses the call, or null when it holds. Exported for the explain output. */
export function conditionFailure(condition: Condition | undefined, facts: Facts): string | null {
	if (condition === undefined) return null;

	if ("ownerOnly" in condition && condition.ownerOnly) {
		if (facts.ownerId === undefined || facts.ownerId === null || facts.ownerId !== facts.actorId) {
			return "owner only";
		}
	}

	if ("notEnvironment" in condition && condition.notEnvironment !== undefined) {
		const kind = facts.environmentKind ?? null;
		if (kind !== null && condition.notEnvironment.includes(kind)) {
			return `not allowed in ${kind}`;
		}
	}

	return null;
}
