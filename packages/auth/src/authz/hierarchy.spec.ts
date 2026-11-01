import { describe, expect, it } from "vitest";

import { platformRoleRank, refuseAdminAction, refuseRoleGrant } from "./hierarchy";

/**
 * The hierarchy matrix, stated as a table so a missing cell is visible.
 *
 * These are the two decisions the platform makes about an account and a role. Every admin surface (Better Auth's
 * `/admin/*`, the identity service's user rules) reads them, so a regression here is a privilege escalation there.
 */
describe("platformRoleRank", () => {
	it.each([
		["superAdmin", 3],
		["admin", 2],
		["operator", 1],
		["viewer", 0],
		["user", -1],
		["member", -1],
		["", -1],
		[null, -1],
		[undefined, -1],
		["root", -1],
	])("ranks %s as %i", (role, rank) => {
		expect(platformRoleRank(role as string | null | undefined)).toBe(rank);
	});
});

describe("refuseAdminAction", () => {
	it.each([
		// actor, target, allowed
		["superAdmin", "superAdmin", true],
		["superAdmin", "admin", true],
		["superAdmin", "user", true],
		["superAdmin", null, true],
		["admin", "operator", true],
		["admin", "viewer", true],
		["admin", "user", true],
		["admin", null, true],
		["admin", "admin", false],
		["admin", "superAdmin", false],
		["operator", "viewer", false],
		["viewer", "user", false],
		["user", "user", false],
		[null, "user", false],
	])("actor %s acting on %s is %s", (actorRole, targetRole, allowed) => {
		const refusal = refuseAdminAction({ actorRole, targetRole });

		if (allowed) expect(refusal).toBeNull();
		else expect(refusal).not.toBeNull();
	});

	it("names the reason, and says peership is not permission", () => {
		expect(refuseAdminAction({ actorRole: "admin", targetRole: "admin" })).toMatchObject({
			reason: "outranked",
			actorRole: "admin",
			targetRole: "admin",
		});
		expect(refuseAdminAction({ actorRole: "admin", targetRole: "admin" })?.message).toMatch(
			/may not act on an account whose role is admin/,
		);
	});

	it("refuses a plain account as the actor regardless of the target", () => {
		expect(refuseAdminAction({ actorRole: "user", targetRole: "viewer" })).toMatchObject({
			reason: "not-an-administrator",
		});
	});
});

describe("refuseRoleGrant", () => {
	it.each([
		// actor, granted, allowed
		["superAdmin", "superAdmin", true],
		["superAdmin", "admin", true],
		["superAdmin", "user", true],
		["admin", "operator", true],
		["admin", "viewer", true],
		["admin", null, true],
		["admin", "admin", false],
		["admin", "superAdmin", false],
		["operator", "viewer", false],
		["viewer", "viewer", false],
		["user", "viewer", false],
		[null, "superAdmin", false],
	])("actor %s granting %s is %s", (actorRole, grantedRole, allowed) => {
		const refusal = refuseRoleGrant({ actorRole, grantedRole });

		if (allowed) expect(refusal).toBeNull();
		else expect(refusal).not.toBeNull();
	});

	it("forbids an admin from minting another admin or a superAdmin", () => {
		expect(refuseRoleGrant({ actorRole: "admin", grantedRole: "admin" })?.reason).toBe("not-grantable");
		expect(refuseRoleGrant({ actorRole: "admin", grantedRole: "superAdmin" })?.message).toBe(
			"only a superAdmin may grant the superAdmin role",
		);
	});

	it("treats an unset role as a no-op rather than a grant", () => {
		expect(refuseRoleGrant({ actorRole: "admin", grantedRole: null })).toBeNull();
	});
});
