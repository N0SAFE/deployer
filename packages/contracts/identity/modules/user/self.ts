import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

import { userSchema } from "@deployer/contracts-entities";

/** One session the caller holds, as they may see it: no token, no secrets. */
export const selfSessionSchema = z.object({
	id: z.string(),
	createdAt: z.coerce.date(),
	expiresAt: z.coerce.date(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	/** Set when the session is an impersonation; the caller may see that it exists. */
	impersonatedBy: z.string().nullable(),
});

/** One API key the caller holds: metadata only. The key material and its hash never leave the database. */
export const selfApiKeySchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	createdAt: z.coerce.date(),
	expiresAt: z.coerce.date().nullable(),
	lastUsedAt: z.coerce.date().nullable(),
	enabled: z.boolean(),
});

/**
 * Everything the platform holds about the caller, in one document (`AUTH-032`).
 *
 * Deliberately not a capability: it is the caller's OWN data, scoped by the session, so requiring an admin permission
 * would mean only admins could exercise a right every account has. The credential material is absent by construction —
 * there is no field for a password hash, a session token or an API key.
 */
export const selfExportContract = oc
	.meta(openapi({ method: "GET", path: "/me/export", tags: ["User"] }))
	.input(z.object({}))
	.output(
		z.object({
			exportedAt: z.coerce.date(),
			user: userSchema,
			sessions: z.array(selfSessionSchema),
			apiKeys: z.array(selfApiKeySchema),
		}),
	);
