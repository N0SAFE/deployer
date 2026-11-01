import { describe, expect, it } from "vitest";

import { adminActionRefusal } from "./adminHierarchy";

/**
 * The decision the admin hook makes, without a request or a database.
 *
 * `adminActionRefusal` is the whole of the rule: which endpoint, who is calling, whose account, and (for the two
 * endpoints that grant) which role. The hook around it only resolves those four facts.
 */
describe("adminActionRefusal", () => {
	it("refuses an admin acting on an account of its own rank", () => {
		expect(adminActionRefusal({ path: "/admin/ban-user", actorRole: "admin", targetRole: "admin" })).toMatchObject({
			reason: "outranked",
		});
	});

	it("lets an admin act on a strictly lower account", () => {
		expect(adminActionRefusal({ path: "/admin/ban-user", actorRole: "admin", targetRole: "operator" })).toBeNull();
	});

	it("refuses a plain account on every admin path", () => {
		expect(adminActionRefusal({ path: "/admin/remove-user", actorRole: "user", targetRole: "viewer" })).toMatchObject(
			{ reason: "not-an-administrator" },
		);
	});

	it("refuses an admin granting its own rank on set-role", () => {
		expect(
			adminActionRefusal({
				path: "/admin/set-role",
				actorRole: "admin",
				targetRole: "viewer",
				grantedRole: "admin",
			}),
		).toMatchObject({ reason: "not-grantable", grantedRole: "admin" });
	});

	it("refuses an admin granting superAdmin, naming the root role", () => {
		const refusal = adminActionRefusal({
			path: "/admin/set-role",
			actorRole: "admin",
			targetRole: "viewer",
			grantedRole: "superAdmin",
		});

		expect(refusal?.message).toBe("only a superAdmin may grant the superAdmin role");
	});

	it("applies the grant rule to update-user, which can also carry a role", () => {
		expect(
			adminActionRefusal({
				path: "/admin/update-user",
				actorRole: "admin",
				targetRole: "viewer",
				grantedRole: "superAdmin",
			}),
		).not.toBeNull();
	});

	it("does not apply the grant rule to endpoints that only name a target", () => {
		expect(
			adminActionRefusal({ path: "/admin/remove-user", actorRole: "admin", targetRole: "viewer", grantedRole: "superAdmin" }),
		).toBeNull();
	});

	it("lets a superAdmin grant any role and act on any account", () => {
		expect(
			adminActionRefusal({
				path: "/admin/set-role",
				actorRole: "superAdmin",
				targetRole: "superAdmin",
				grantedRole: "superAdmin",
			}),
		).toBeNull();
	});

	it("refuses impersonation below the root role's reach like any other action", () => {
		expect(adminActionRefusal({ path: "/admin/impersonate-user", actorRole: "admin", targetRole: "admin" })).not.toBeNull();
	});
});
