import { standard } from "@repo/orpc-utils";
import { userSchema } from "@repo/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create create contract using builder
export const userCreateContract = userOps
  .create()
  .input(b => b.entitySchema.pick(["name", "email", "image"]))
  .build();
