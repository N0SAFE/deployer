import z from "zod/v4";

import { userSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

const userOps = standard.zod(userSchema, "user");

/**
 * Change a user's platform role.
 *
 * The role is the CATALOG's union (`PLATFORM_ROLES` via `userSchema.role`), not a free string, and the service ends the
 * target's sessions: a session carries the role, so it cannot outlive a role change.
 */
export const userSetRoleContract = userOps
	.create()
	.path("/{id}/role")
	.input((b) =>
		b.params(z.object({ id: userSchema.shape.id })).body(z.object({ role: userSchema.shape.role.unwrap() })),
	)
	.output(userSchema)
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Ban or unban a user. Banning ends their credentials. */
export const userSetBannedContract = userOps
	.create()
	.path("/{id}/ban")
	.input((b) =>
		b.params(z.object({ id: userSchema.shape.id })).body(z.object({ banned: z.boolean() })),
	)
	.output(userSchema)
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** End every credential (sessions and API keys) a user holds. */
export const userRevokeSessionsContract = userOps
	.create()
	.path("/{id}/revoke-sessions")
	.input((b) => b.params(z.object({ id: userSchema.shape.id })))
	.output(z.object({ revoked: z.literal(true) }))
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * Set a temporary password for another account (`AUTH-015`).
 *
 * The path for a deployment with no mail transport: an administrator hands the person a password out of band. It ends
 * every session the target holds — a password change that leaves a live session is not a change.
 */
export const userSetPasswordContract = userOps
	.create()
	.path("/{id}/password")
	.input((b) =>
		b.params(z.object({ id: userSchema.shape.id })).body(z.object({ password: z.string().min(8).max(128) })),
	)
	.output(z.object({ updated: z.literal(true) }))
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();
