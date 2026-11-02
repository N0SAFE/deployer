import { userSchema } from "@deployer/contracts-entities";
import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

/**
 * Change a user's platform role.
 *
 * The role is the CATALOG's union (`PLATFORM_ROLES` via `userSchema.role`), not a free string, and the service ends the
 * target's sessions: a session carries the role, so it cannot outlive a role change.
 */
export const userSetRoleContract = oc
	.meta(openapi({ method: "POST", path: "/{id}/role", tags: ["User"] }))
	.input(
		z.object({
			params: z.object({ id: userSchema.shape.id }),
			body: z.object({ role: userSchema.shape.role.unwrap() }),
		}),
	)
	.output(userSchema);

/** Ban or unban a user. Banning ends their credentials. */
export const userSetBannedContract = oc
	.meta(openapi({ method: "POST", path: "/{id}/ban", tags: ["User"] }))
	.input(
		z.object({
			params: z.object({ id: userSchema.shape.id }),
			body: z.object({ banned: z.boolean() }),
		}),
	)
	.output(userSchema);

/** End every credential (sessions and API keys) a user holds. */
export const userRevokeSessionsContract = oc
	.meta(openapi({ method: "POST", path: "/{id}/revoke-sessions", tags: ["User"] }))
	.input(z.object({ params: z.object({ id: userSchema.shape.id }) }))
	.output(z.object({ revoked: z.literal(true) }));
