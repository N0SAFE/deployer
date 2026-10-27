import { ForbiddenError, ValidationError } from "@deployer/errors";
import { describe, expect, it } from "vitest";

import { userRules } from "./user.rules";
import type { Actor, User } from "./user.types";

const admin: Actor = { userId: "admin-1", role: "admin" };
const root: Actor = { userId: "root-1", role: "superAdmin" };
const member: Actor = { userId: "user-1", role: "user" };

const current = { id: "user-1", name: "Ada", email: "ada@example.com", role: "viewer" } as User;

describe("userRules", () => {
	describe("normaliseEmail", () => {
		it("trims and lowercases", () => {
			expect(userRules.normaliseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
		});
	});

	describe("assertEmailIsUsable", () => {
		it.each(["ada@example.com", "a.b+c@sub.example.org"])("accepts %s", (email) => {
			expect(() => { userRules.assertEmailIsUsable(email); }).not.toThrow();
		});

		it.each(["", "ada", "ada@", "@example.com", "ada@example", "a da@example.com", "a@b@c.com"])(
			"rejects %j",
			(email) => {
				expect(() => { userRules.assertEmailIsUsable(email); }).toThrow(ValidationError);
			},
		);
	});

	describe("assertNameIsUsable", () => {
		it("rejects a blank name", () => {
			expect(() => { userRules.assertNameIsUsable("   "); }).toThrow(ValidationError);
		});

		it("accepts a name with content", () => {
			expect(() => { userRules.assertNameIsUsable(" Ada "); }).not.toThrow();
		});
	});

	describe("assertNoAuditFields", () => {
		it.each(["createdAt", "updatedAt"])("refuses a client-supplied %s", (field) => {
			expect(() => { userRules.assertNoAuditFields({ [field]: "2026-01-01" }); }).toThrow(ValidationError);
		});

		it("allows a body without audit fields", () => {
			expect(() => { userRules.assertNoAuditFields({ name: "Ada" }); }).not.toThrow();
		});
	});

	describe("assertCanAdminister", () => {
		it.each([admin, root])("allows $role", (actor) => {
			expect(() => { userRules.assertCanAdminister(actor); }).not.toThrow();
		});

		it("forbids an ordinary user", () => {
			expect(() => { userRules.assertCanAdminister(member); }).toThrow(ForbiddenError);
		});
	});

	describe("assertSelfOrAdmin", () => {
		it("lets a user act on themselves", () => {
			expect(() => { userRules.assertSelfOrAdmin(member, "user-1"); }).not.toThrow();
		});

		it("lets an admin act on someone else", () => {
			expect(() => { userRules.assertSelfOrAdmin(admin, "user-1"); }).not.toThrow();
		});

		it("forbids a user acting on someone else", () => {
			expect(() => { userRules.assertSelfOrAdmin(member, "user-2"); }).toThrow(ForbiddenError);
		});
	});

	describe("assertNotSelfDestruct", () => {
		it("forbids acting on one's own account, naming the action", () => {
			expect(() => { userRules.assertNotSelfDestruct(admin, "admin-1", "ban"); }).toThrow(/ban their own account/);
		});

		it("allows acting on another account", () => {
			expect(() => { userRules.assertNotSelfDestruct(admin, "user-1", "ban"); }).not.toThrow();
		});
	});

	describe("assertRoleIsAssignable", () => {
		it("accepts no role at all", () => {
			expect(() => { userRules.assertRoleIsAssignable(member, undefined); }).not.toThrow();
		});

		it("forbids a non-administrator from assigning any role", () => {
			expect(() => { userRules.assertRoleIsAssignable(member, "viewer"); }).toThrow(ForbiddenError);
		});

		it("lets an admin assign a non-root role", () => {
			expect(() => { userRules.assertRoleIsAssignable(admin, "viewer"); }).not.toThrow();
		});

		it("forbids an admin from granting superAdmin", () => {
			expect(() => { userRules.assertRoleIsAssignable(admin, "superAdmin"); }).toThrow(/only a superAdmin/);
		});

		it("lets a superAdmin grant superAdmin", () => {
			expect(() => { userRules.assertRoleIsAssignable(root, "superAdmin"); }).not.toThrow();
		});
	});

	describe("toSelfServicePatch", () => {
		it("keeps only the fields a user may change on themselves", () => {
			const patch = userRules.toSelfServicePatch(
				{ name: "Ada L.", email: "new@example.com", role: "admin", banned: false },
				current,
			);

			expect(patch).toEqual({ name: "Ada L.", email: "new@example.com" });
		});

		it("drops an email that is unchanged", () => {
			expect(userRules.toSelfServicePatch({ name: "Ada L.", email: current.email }, current)).toEqual({
				name: "Ada L.",
			});
		});

		it("yields an empty patch when nothing self-service was asked", () => {
			expect(userRules.toSelfServicePatch({ role: "admin" }, current)).toEqual({});
		});
	});
});
