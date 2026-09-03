import * as z from "zod";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

const serviceDependencyRemoveOutputSchema = z.object({
  success: z.boolean(),
});

const serviceDependencyRemoveOps = standard.zod(serviceDependencyRemoveOutputSchema, "serviceDependencyRemove");

export const serviceRemoveDependencyContract = serviceDependencyRemoveOps
  .delete({ idFieldName: "dependencyId", idSchema: z.uuid() })
  .summary("Remove service dependency")
  // path-template params form (schema-only `.input(params(schema))` does not
  // wire URL substitution in the OpenAPI client).
  .input((b) => b.params((p) => p`/${p("id", z.uuid())}/dependencies/${p("dependencyId", z.uuid())}`))
  .output(serviceDependencyRemoveOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
