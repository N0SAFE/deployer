import z from "zod/v4";

import { userSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create create contract using builder
// `entitySchema` is the raw Zod schema, so `pick` takes a shape object (`{ key: true }`), not an array of names.
export const userCreateContract = userOps
	.create()
	.input((b) =>
		b.entitySchema.pick({ name: true, email: true }).extend({
			image: userSchema.shape.image.optional(),
			/** A credential password. The service hashes it with Better Auth's crypto, so sign-in keeps working. */
			password: z.string().min(8).optional(),
			/** The platform role to grant on creation (typed by the catalog through `userSchema`). */
			role: userSchema.shape.role,
		}),
	)
	.errors((e) => [
		// Email already registered (409) or invalid payload (400).
		...standardDomainErrorContracts(e),
	])
	.build();
