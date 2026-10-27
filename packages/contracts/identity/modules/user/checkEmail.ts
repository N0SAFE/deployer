import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { userSchema } from "@deployer/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create email check contract using builder
export const userCheckEmailContract = userOps.check("email").errors((e) => [...standardDomainErrorContracts(e)]).build();
