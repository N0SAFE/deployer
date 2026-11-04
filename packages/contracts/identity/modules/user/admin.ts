import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { userSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

const userOps = standard.zod(userSchema, "user");

/**
 * Change a user's platform role.
 *
 * The body accepts any role NAME (`roles` are rows, so a deployment can add one); the service refuses a name the
 * catalogue does not hold, and it ends the target's sessions: a session carries the role, so it cannot outlive a change.
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
	.meta(access({ permission: "user:set-role" })).build();

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
	.meta(access({ permission: "user:ban" })).build();

/** End every credential (sessions and API keys) a user holds. */
export const userRevokeSessionsContract = userOps
	.create()
	.path("/{id}/revoke-sessions")
	.input((b) => b.params(z.object({ id: userSchema.shape.id })))
	.output(z.object({ revoked: z.literal(true) }))
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "session:delete" })).build();

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
	.meta(access({ permission: "user:set-password" })).build();

/** One session of a user, as an operator sees it: no token — that is credential material. */
export const userSessionSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	expiresAt: z.coerce.date(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	impersonatedBy: z.string().nullable(),
});

/** Every session a user holds, newest first (`session:list`). */
export const userSessionsListContract = userOps
	.read({ idFieldName: "id", idSchema: userSchema.shape.id })
	.path("/{id}/sessions")
	.input((b) => b.params(z.object({ id: userSchema.shape.id })))
	.output(z.object({ data: z.array(userSessionSchema) }))
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "session:list" })).build();

/** End ONE session (`session:revoke`), with a passkey proof — it may be the session an intruder is using. */
export const userSessionRevokeContract = userOps
	.delete()
	.path("/{id}/sessions/{sessionId}")
	.input((b) =>
		b.params(z.object({ id: userSchema.shape.id, sessionId: z.string().min(1) })),
	)
	.output(z.object({ revoked: z.literal(true) }))
	.tags("User")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "session:revoke" })).build();
