import { oc } from "@orpc/contract";
import { z } from "zod";
import { ResourceAllocationSchema, SuccessWithDataResponseSchema } from "./schemas";

export const getResourceAllocationContract = oc
  .route({
    method: "GET",
    path: "/resources/{projectId}/{environment}",
    summary: "Get resource allocation for a project environment",
    description: "Retrieve the resource allocation, quotas, and usage for a project environment",
  })
  .input(z.object({
    projectId: z.string(),
    environment: z.string(),
  }))
  .output(SuccessWithDataResponseSchema(ResourceAllocationSchema.nullable()));