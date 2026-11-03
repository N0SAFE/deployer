import { oc } from "@orpc/contract";
import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { roleCreateContract, roleDeleteContract, roleUpdateContract } from "./crud";
import { roleSchema, roleScopeSchema } from "./schema";

const roleOps = standard.zod(roleSchema, "role");

/**
 * The roles this deployment knows.
 *
 * `role:read` guards it. The list is what the role picker and the permission matrix read, so it is not public: the
 * permissions a role grants describe what an attacker gains by stealing an account with it.
 */
export const roleListContract = roleOps
	.list()
	.path("/roles")
	.input((b) => b.query(z.object({ scope: roleScopeSchema.optional() })))
	.output(z.object({ data: z.array(roleSchema) }))
	.tags("Roles")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** The role namespace the BFF delegates to `identity`. */
export const roleContract = oc.router({
	list: roleListContract,
	create: roleCreateContract,
	update: roleUpdateContract,
	delete: roleDeleteContract,
});

export * from "./schema";
export * from "./crud";
