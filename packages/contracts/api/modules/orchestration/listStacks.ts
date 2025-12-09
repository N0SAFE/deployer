import { oc } from "@orpc/contract";
import { z } from "zod";
import { StackStatusSchema, SuccessWithDataResponseSchema } from "./schemas";
export const listStacksContract = oc
    .route({
    method: "GET",
    path: "/stacks",
    summary: "List all stacks for a project",
    description: "Retrieve all Docker Swarm stacks for the specified project",
})
    .input(z.object({
    projectId: z.string(),
}))
    .output(SuccessWithDataResponseSchema(z.array(StackStatusSchema)));
