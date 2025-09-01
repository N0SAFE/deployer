import { oc } from "@orpc/contract";
import { z } from "zod";
import { StackStatusSchema, SuccessWithDataResponseSchema } from "./schemas";

export const getStackContract = oc
  .route({
    method: "GET",
    path: "/stacks/{stackId}",
    summary: "Get stack status and details",
    description: "Retrieve the current status and details of a Docker Swarm stack",
  })
  .input(z.object({
    stackId: z.string(),
  }))
  .output(SuccessWithDataResponseSchema(StackStatusSchema));