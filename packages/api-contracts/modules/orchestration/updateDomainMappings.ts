import { oc } from "@orpc/contract";
import { z } from "zod";
import { DomainMappingSchema, SuccessResponseSchema } from "./schemas";

export const updateDomainMappingsContract = oc
  .route({
    method: "PUT",
    path: "/stacks/{stackId}/domains",
    summary: "Update domain mappings for a stack",
    description: "Update the domain mappings and routing configuration for a stack",
  })
  .input(z.object({
    stackId: z.string(),
    mappings: z.array(DomainMappingSchema),
  }))
  .output(SuccessResponseSchema);