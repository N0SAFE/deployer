import { standard } from "@repo/orpc-utils";
import { userSchema } from "@repo/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create email check contract using builder
export const userCheckEmailContract = userOps.check("email").build();
