import { describe, expect, it } from "vitest";

import { createAuthzBuilder, type PermissionOf } from "./builder";

/**
 * The builder is the single declaration point: these tests pin what it derives, and the `@ts-expect-error` lines are the
 * compile-time half — a typo in an action, a bundle or a role name must not reach a runtime deny.
 */
const model = createAuthzBuilder()
	.resources(({ actions }) => ({
		service: actions({
			read: { risk: "read", description: "See a service." },
			deploy: { risk: "write", description: "Deploy it." },
			delete: { risk: "destructive", description: "Delete it." },
		}),
		user: actions({
			list: { risk: "read", description: "List users." },
			"set-role": { risk: "admin", description: "Change a role." },
		}),
	}))
	.bundles(({ permissions }) => ({
		read: permissions({ service: ["read"], user: ["list"] }),
		admin: permissions({ service: ["deploy", "delete"], user: ["set-role"] }),
	}))
	.roles(() => ({
		viewer: { scope: "platform", rank: 0, label: "Viewer", bundles: ["read"] },
		operator: { scope: "platform", rank: 1, label: "Operator", bundles: ["read", "admin"] },
		superAdmin: { scope: "platform", rank: 2, label: "Owner", bundles: "all" },
		owner: { scope: "project", rank: 0, label: "Owner", bundles: "all" },
	}))
	.build();

type Permission = PermissionOf<typeof model.resources>;
type Role = (typeof model.roleNames)[number];

describe("AuthzBuilder", () => {
	it("derives the statement from the declared resources", () => {
		expect(model.statement).toEqual({
			service: ["read", "deploy", "delete"],
			user: ["list", "set-role"],
		});
	});

	it("derives the permission union and its metadata", () => {
		expect(Object.keys(model.permissions)).toEqual([
			"service:read",
			"service:deploy",
			"service:delete",
			"user:list",
			"user:set-role",
		]);
		expect(model.permissions["service:delete"]).toEqual({ risk: "destructive", description: "Delete it." });

		// The union is exact: a permission that was never declared does not type-check.
		const permission: Permission = "service:deploy";
		// @ts-expect-error — not a declared permission
		const typo: Permission = "service:deply";
		expect([permission, typo]).toBeDefined();
	});

	it("derives each role's grants from its bundles", () => {
		expect(model.rolePermissions.viewer).toEqual({ service: ["read"], user: ["list"] });
		expect(model.rolePermissions.operator).toEqual({
			service: ["read", "deploy", "delete"],
			user: ["list", "set-role"],
		});
		// `all` is every permission, stated rather than implied.
		expect(model.capabilitiesOfRole("superAdmin")).toHaveLength(5);
	});

	it("keeps ranks and scopes as literals", () => {
		expect(model.ranks).toEqual({ viewer: 0, operator: 1, superAdmin: 2, owner: 0 });
		expect(model.platformRoles).toEqual(["viewer", "operator", "superAdmin"]);
		expect(model.projectRoles).toEqual(["owner"]);

		const role: Role = "operator";
		// @ts-expect-error — not a declared role
		const unknownRole: Role = "admin";
		expect([role, unknownRole]).toBeDefined();
	});

	it("builds zod schemas that reject undeclared names", () => {
		expect(model.schemas.permissions.safeParse("user:list").success).toBe(true);
		expect(model.schemas.permissions.safeParse("user:ban").success).toBe(false);
		expect(model.schemas.roleNames.safeParse("viewer").success).toBe(true);
		expect(model.schemas.roleNames.safeParse("admin").success).toBe(false);
	});

	it("answers role grants without materializing the set", () => {
		expect(model.roleGrants("viewer", "service:read")).toBe(true);
		expect(model.roleGrants("viewer", "service:delete")).toBe(false);
		expect(model.rolesConfig.hasPermission("operator", "service", "delete")).toBe(true);
		expect(model.rolesConfig.hasPermission("viewer", "service", "delete")).toBe(false);
	});

	it("names a role table row per role, with its bundle seed", () => {
		expect(model.roleTable.viewer).toMatchObject({ scope: "platform", rank: 0, system: true });
		expect(model.systemRoles.operator).toEqual({ scope: "platform", bundles: ["read", "admin"] });
	});

	it("fails the build when a bundle names an unknown permission", () => {
		expect(() =>
			createAuthzBuilder()
				.resources(({ actions }) => ({ service: actions(["read"] as const) }))
				// `deploy` is not an action of `service`
				// @ts-expect-error — the builder validates bundles at build time too
				.bundles(({ permissions }) => ({ bad: permissions({ service: ["deploy"] }) }))
				.build(),
		).toThrow(/unknown permission/);
	});

	it("fails the build when a role names an unknown bundle", () => {
		expect(() =>
			createAuthzBuilder()
				.resources(({ actions }) => ({ service: actions(["read"] as const) }))
				.bundles(({ permissions }) => ({ read: permissions({ service: ["read"] }) }))
				// @ts-expect-error — `nope` is not a declared bundle
				.roles(() => ({ viewer: { scope: "platform", rank: 0, label: "Viewer", bundles: ["nope"] } }))
				.build(),
		).toThrow(/unknown bundle/);
	});
});
