import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { userSchema } from "@repo/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create create contract using builder
// `entitySchema` is the raw Zod schema, so `pick` takes a shape object
// (`{ key: true }`), not an array of names.
export const userCreateContract = userOps
  .create()
  .input(b => b.entitySchema.pick({ name: true, email: true, image: true }))
  .errors((e) => [
    // Email already registered (409) or invalid payload (400).
    ...standardDomainErrorContracts(e),
  ])
  .build();
