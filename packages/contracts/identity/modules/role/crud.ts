import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { roleSchema } from "./schema";

/** A role name is stored in `user.role`, so it is a stable slug, not a label. */
export const roleNameSchema = z
	.string()
	.min(2)
	.max(32)
	.regex(/^[a-z][a-z0-9_-]*$/, "lowercase letters, digits, - and _, starting with a letter");

const roleBodySchema = z.object({
	name: roleNameSchema,
	/** Custom roles are platform-scoped for now: project roles are an enum in the schema. */
	scope: z.literal("platform"),
	rank: z.coerce.number().int().min(-1).max(10),
	label: z.string().min(2).max(64),
	description: z.string().max(280).nullable().default(null),
	color: z.string().max(32).nullable().default(null),
	/** Catalog permission strings; the service refuses any the actor does not hold itself. */
	permissions: z.array(z.string().min(3)).max(200),
});

const roleOps = standard.zod(roleSchema, "role");

/**
 * Create a custom role (`role:write`).
 *
 * The service caps it twice: the rank must be BELOW the creator's, and every permission must already be the creator's.
 * A role is configuration, but it is privilege configuration — "create a role" must never be a way to grant yourself
 * something.
 */
export const roleCreateContract = roleOps
	.create()
	.path("/roles")
	.input((b) => b.body(roleBodySchema))
	.output(roleSchema)
	.tags("Roles")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "role:write" })).build();

/**
 * Edit a custom role (`role:write`).
 *
 * The name is immutable: it is what `user.role` stores, so renaming would orphan every account holding it. A system role
 * cannot be edited at all — re-seed the code instead.
 */
export const roleUpdateContract = roleOps
	.patch()
	.path("/roles/{id}")
	.input((b) => b.params(z.object({ id: z.uuid() })).body(roleBodySchema.omit({ name: true, scope: true }).partial()))
	.output(roleSchema)
	.tags("Roles")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "role:write" })).build();

/**
 * Delete a custom role (`role:write`).
 *
 * Refused while an account still holds it: deleting a role out from under a user would leave `user.role` naming a role
 * that no longer exists, and the next capability check would silently deny everything.
 */
export const roleDeleteContract = roleOps
	.delete()
	.path("/roles/{id}")
	.input((b) => b.params(z.object({ id: z.uuid() })))
	.output(z.object({ deleted: z.literal(true) }))
	.tags("Roles")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "role:write" })).build();
