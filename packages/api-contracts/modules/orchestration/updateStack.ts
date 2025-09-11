import { oc } from "@orpc/contract";
import { z } from "zod";
import { UpdateStackRequestSchema, SuccessResponseSchema } from "./schemas";
export const updateStackContract = oc
    .route({
    method: "PUT",
    path: "/stacks/{stackId}",
    summary: "Update an existing stack",
    description: "Update the configuration of an existing Docker Swarm stack",
})
    .input(z.object({
    stackId: z.string(),
}).merge(UpdateStackRequestSchema))
    .output(SuccessResponseSchema);
