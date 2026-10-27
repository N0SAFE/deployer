import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { userSchema } from "@deployer/contracts-entities";

// Create standard operations builder for users
const userOps = standard.zod(userSchema, "user");

// Count contract using builder.
//
// ── WHY THE FILTER IS NOT TYPED — YET ──────────────────────────────────────
// Passing the list's filtering config here looks like an obvious improvement, and
// it was attempted: the `count()` builder cannot currently consume one without the
// emitted contract degrading. Measured outcomes were `ZodType<never>` (an endpoint
// accepting NO filter) or a filter dropped to `ZodObject<{}>`. The builder keeps its
// untyped filter until that is fixed properly — see the note on
// `StandardOperationsZod.count`. An untyped filter that works beats a typed one
// that does not.
export const userCountContract = userOps.count().errors((e) => [...standardDomainErrorContracts(e)]).build();
