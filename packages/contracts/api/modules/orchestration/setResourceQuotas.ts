import { oc } from "@orpc/contract";
import { z } from "zod";
import { SetQuotasRequestSchema, SuccessResponseSchema } from "./schemas";
export const setResourceQuotasContract = oc
    .route({
    method: "PUT",
    path: "/resources/{projectId}/{environment}/quotas",
    summary: "Set resource quotas for a project environment",
    description: "Define resource quotas and limits for a specific project environment",
})
    .input(z.object({
    projectId: z.string(),
    environment: z.string(),
}).merge(SetQuotasRequestSchema))
    .output(SuccessResponseSchema);
