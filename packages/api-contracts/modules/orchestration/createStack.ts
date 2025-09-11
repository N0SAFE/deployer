import { oc } from "@orpc/contract";
import { z } from "zod";
import { CreateStackRequestSchema, SuccessResponseSchema } from "./schemas";
export const createStackContract = oc
    .route({
    method: "POST",
    path: "/stacks",
    summary: "Create a new Docker Swarm stack",
    description: "Create and deploy a new Docker Swarm stack with the provided configuration",
})
    .input(CreateStackRequestSchema)
    .output(SuccessResponseSchema.extend({
    stackId: z.string(),
}));
