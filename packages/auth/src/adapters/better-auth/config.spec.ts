import { defaultStatements } from "better-auth/plugins/admin/access";
import { describe, expect, it } from "vitest";

import { platformStatement } from "../../authz/platform";

import { platformAc, platformRoles } from "./config";

/**
 * The adapter must not lose anything Better Auth's admin plugin checks.
 *
 * `authz/platform.ts` declares the admin plugin's action names as vocabulary instead of importing
 * `adminDefaultStatements` (that would drag Better Auth into `authz`). This is the assertion that keeps the copy
 * honest: every action the plugin checks is still in the statement, so a Better Auth upgrade that adds one fails here
 * instead of silently denying it at runtime.
 */
describe("better-auth adapter", () => {
	it("covers every action the admin plugin checks", () => {
		for (const [resource, actions] of Object.entries(defaultStatements)) {
			const declared = platformStatement[resource as keyof typeof platformStatement];
			expect(declared, `resource "${resource}" is missing from the statement`).toBeDefined();
			expect([...declared]).toEqual(expect.arrayContaining([...actions]));
		}
	});

	it("converts every platform role into a Better Auth Role", () => {
		for (const [name, role] of Object.entries(platformRoles)) {
			expect(role, name).toMatchObject({ authorize: expect.any(Function) });
			expect(role.statements, name).toBeDefined();
		}
	});

	it("builds the access control from the same statement", () => {
		expect(platformAc.statements).toEqual(platformStatement);
	});
});
