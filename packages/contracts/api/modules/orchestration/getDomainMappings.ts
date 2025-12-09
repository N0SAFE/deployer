import { oc } from "@orpc/contract";
import { z } from "zod";
import { DomainMappingSchema, SuccessWithDataResponseSchema } from "./schemas";
export const getDomainMappingsContract = oc
    .route({
    method: "GET",
    path: "/stacks/{stackId}/domains",
    summary: "Get domain mappings for a stack",
    description: "Retrieve the current domain mappings and routing configuration for a stack",
})
    .input(z.object({
    stackId: z.string(),
}))
    .output(SuccessWithDataResponseSchema(z.array(DomainMappingSchema)));
