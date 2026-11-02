import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

/** The scopes a role can be declared for. Mirrors `authz`'s `ScopeKind`. */
export const roleScopeSchema = z.enum(["platform", "project", "environment", "service", "node"]);

/**
 * One role, as the `roles` table stores it.
 *
 * `permissions` are catalog strings (`"service:deploy"`): the vocabulary is code, a role is data.
 */
export const roleSchema = z.object({
	id: z.string(),
	name: z.string(),
	scope: roleScopeSchema,
	rank: z.number().int(),
	label: z.string(),
	description: z.string().nullable(),
	color: z.string().nullable(),
	isSystem: z.boolean(),
	permissions: z.array(z.string()),
});

export type Role = z.infer<typeof roleSchema>;

/**
 * The roles this deployment knows.
 *
 * `role:read` guards it. The list is what the role picker and the permission matrix read, so it is not public: the
 * permissions a role grants describe what an attacker gains by stealing an account with it.
 */
export const roleListContract = oc
	.meta(openapi({ method: "GET", path: "/roles", tags: ["Roles"] }))
	.input(z.object({ query: z.object({ scope: roleScopeSchema.optional() }) }))
	.output(z.object({ data: z.array(roleSchema) }));

/** The role namespace the BFF delegates to `identity`. */
export const roleContract = oc.router({
	list: roleListContract,
});

export type RoleContract = typeof roleContract;
