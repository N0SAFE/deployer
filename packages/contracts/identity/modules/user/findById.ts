import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { userSchema } from "@deployer/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Create read contract using builder
export const userFindByIdContract = userOps
  .read()
  .output(b => b.entitySchema.nullable())
  .errors((e) => [
    // 404 for unknown user id.
    ...standardDomainErrorContracts(e),
  ])
  .build()
  
// type i = typeof userFindByIdContract['~orpc']["inputSchema"];
// type o = typeof userFindByIdContract['~orpc']["outputSchema"];