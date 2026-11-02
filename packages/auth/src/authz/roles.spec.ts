import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES_TABLE, capabilitiesOfRole } from "./catalog";
import { permissionsInRoles, rankInRoles, roleTable } from "./roles";

/**
 * Roles as data.
 *
 * The vocabulary stays in code (a typo in a permission is a compile error); a ROLE is configuration — a name, a scope,
 * a rank and the permissions it hands out. These tests pin the three behaviours that make the split safe: a role only
 * grants in its own scope, an unknown role grants nothing and ranks below everyone, and two definitions of one name are
 * a loud error rather than a silent winner.
 */
describe("roleTable", () => {
	it("refuses a role defined twice instead of letting one win", () => {
		expect(() =>
			roleTable([
				{ name: "viewer", scope: "platform", rank: 0, permissions: [] },
				{ name: "viewer", scope: "platform", rank: 1, permissions: [] },
			]),
		).toThrow(/role "viewer" is defined twice/);
	});

	it("marks the built-in roles as system roles and leaves a custom one editable", () => {
		expect(SYSTEM_ROLES_TABLE.superAdmin?.system).toBe(true);

		const custom = roleTable([{ name: "release-manager", scope: "project", rank: 1, permissions: ["service:deploy"] }]);
		expect(custom["release-manager"]?.system).toBe(false);
	});
});

describe("permissionsInRoles", () => {
	it("grants the permissions the role declares in its own scope", () => {
		expect(permissionsInRoles(SYSTEM_ROLES_TABLE, "superAdmin", "platform")).toContain("settings:manage");
	});

	it("grants nothing outside the role's scope, so a project owner cannot reconfigure the platform", () => {
		expect(permissionsInRoles(SYSTEM_ROLES_TABLE, "owner", "platform")).toEqual([]);
		expect(permissionsInRoles(SYSTEM_ROLES_TABLE, "superAdmin", "project")).toEqual([]);
	});

	it("grants nothing to a role the table does not know", () => {
		expect(permissionsInRoles(SYSTEM_ROLES_TABLE, "root", "platform")).toEqual([]);
		expect(permissionsInRoles(SYSTEM_ROLES_TABLE, null, "platform")).toEqual([]);
	});

	it("agrees with the catalog's own capabilities for a platform role", () => {
		// The table is the seed; the catalog is where the permissions come from. A drift here is a broken role.
		expect(permissionsInRoles(SYSTEM_ROLES_TABLE, "admin", "platform")).toEqual(capabilitiesOfRole("admin"));
	});
});

describe("rankInRoles", () => {
	it("ranks a declared role by its definition", () => {
		expect(rankInRoles(SYSTEM_ROLES_TABLE, "superAdmin")).toBe(3);
		expect(rankInRoles(SYSTEM_ROLES_TABLE, "viewer")).toBe(0);
		expect(rankInRoles(SYSTEM_ROLES_TABLE, "user")).toBe(-1);
	});

	it("ranks an unknown role below every declared one, so a rename can never grant administration", () => {
		expect(rankInRoles(SYSTEM_ROLES_TABLE, "root")).toBe(-1);
		expect(rankInRoles(SYSTEM_ROLES_TABLE, undefined)).toBe(-1);
	});
});
