import type { Permission } from "@deployer/auth/authz";

/**
 * Which actions may be done by PROXY — one person asks, another consents (`SEC-069`, `SEC-072`).
 *
 * This is the policy table the guard reads. It is data on purpose: adding a second protected action is one entry, not an
 * `if` in a service, and an action that is not listed is NOT approvable — asking for one is refused rather than left to
 * rot in a queue nobody can legally satisfy.
 *
 * `requiredApprovals` is per action, not per installation: a two-person rule is expressed where the risk is, and solo
 * installs degrade it (`DEC-AUTH-16`) by leaving the entry out until a second administrator exists.
 */
export interface ApprovalPolicy {
	/** The capability the requester lacks and wants exercised. */
	readonly permission: Permission;
	/** Distinct people who must say yes. 1 = a second pair of eyes; 2 = two besides the requester. */
	readonly requiredApprovals: number;
	/** The longest an approval stays valid. A request may ask for less; it may not ask for more. */
	readonly ttlSec: number;
}

/**
 * The protected actions.
 *
 * Deliberately short: an approval is friction, and friction on everything is friction on nothing. Each entry is a
 * DESTRUCTIVE action whose damage is not undone by a retry.
 */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = [
	// Deleting an account destroys its data and cannot be reversed.
	{ permission: "user:delete", requiredApprovals: 1, ttlSec: 3_600 },
];

const BY_PERMISSION = new Map<string, ApprovalPolicy>(
	APPROVAL_POLICIES.map((policy) => [policy.permission, policy]),
);

/** The policy for an action, or `null` when it cannot be approved at all. */
export function approvalPolicyFor(permission: string): ApprovalPolicy | null {
	return BY_PERMISSION.get(permission) ?? null;
}
