import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

/**
 * Delete the CALLER'S account (`AUTH-032`).
 *
 * Scoped to the session, so there is no id to point at someone else, and it requires a fresh passkey proof: deleting an
 * account ends it, and the request must come from the person behind it rather than from a walked-away tab. The service
 * refuses when the caller is the last platform super admin — a lockout is not a deletion.
 *
 * The user row cascades to its sessions, accounts and keys, so a later sign-in cannot resurrect any of them.
 */
export const selfDeleteContract = oc
	.meta(openapi({ method: "POST", path: "/me/delete", tags: ["User"] }))
	.input(z.object({}))
	.output(z.object({ deleted: z.literal(true) }));
