import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { userSchema } from "@repo/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create create contract using builder
export const userCreateContract = userOps
  .create()
  .input(b => b.entitySchema.pick(["name", "email", "image"]))
  .errors((e) => [
    // Email already registered (409) or invalid payload (400).
    ...standardDomainErrorContracts(e),
  ])
  .build();
