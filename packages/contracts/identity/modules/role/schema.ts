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
