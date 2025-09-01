import { oc } from "@orpc/contract";
import { z } from "zod";
import { SystemResourceSummarySchema, SuccessWithDataResponseSchema } from "./schemas";

export const getSystemResourceSummaryContract = oc
  .route({
    method: "GET",
    path: "/resources/system/summary",
    summary: "Get system-wide resource summary",
    description: "Retrieve a summary of system-wide resource allocation and usage across all projects",
  })
  .input(z.void())
  .output(SuccessWithDataResponseSchema(SystemResourceSummarySchema));