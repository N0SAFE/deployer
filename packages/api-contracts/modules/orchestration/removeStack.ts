import { oc } from "@orpc/contract";
import { z } from "zod";
import { SuccessResponseSchema } from "./schemas";

export const removeStackContract = oc
  .route({
    method: "DELETE",
    path: "/stacks/{stackId}",
    summary: "Remove a stack",
    description: "Remove a Docker Swarm stack and all its services",
  })
  .input(z.object({
    stackId: z.string(),
  }))
  .output(SuccessResponseSchema);