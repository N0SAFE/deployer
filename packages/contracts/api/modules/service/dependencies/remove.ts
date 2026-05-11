import * as z from "zod";
import { standard } from "@repo/orpc-utils";

const serviceDependencyRemoveParamsSchema = z.object({
  id: z.uuid(),
  dependencyId: z.uuid(),
});

const serviceDependencyRemoveOutputSchema = z.object({
  success: z.boolean(),
});

const serviceDependencyRemoveOps = standard.zod(serviceDependencyRemoveOutputSchema, "serviceDependencyRemove");

export const serviceRemoveDependencyContract = serviceDependencyRemoveOps
  .delete({ idFieldName: "dependencyId", idSchema: z.uuid() })
  .summary("Remove service dependency")
  .path("/:id/dependencies/:dependencyId")
  .input((input) => input.params(serviceDependencyRemoveParamsSchema))
  .output(serviceDependencyRemoveOutputSchema)
  .build();
