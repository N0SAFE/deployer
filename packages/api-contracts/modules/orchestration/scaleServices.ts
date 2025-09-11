import { oc } from "@orpc/contract";
import { z } from "zod";
import { ScaleServicesRequestSchema, SuccessResponseSchema } from "./schemas";
export const scaleServicesContract = oc
    .route({
    method: "POST",
    path: "/stacks/{stackId}/scale",
    summary: "Scale services in a stack",
    description: "Scale individual services within a Docker Swarm stack",
})
    .input(z.object({
    stackId: z.string(),
    services: ScaleServicesRequestSchema,
}))
    .output(SuccessResponseSchema);
