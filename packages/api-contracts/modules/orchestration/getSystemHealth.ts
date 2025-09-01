import { oc } from "@orpc/contract";
import { z } from "zod";
import { SystemHealthOverviewSchema, SuccessWithDataResponseSchema } from "./schemas";

const GetSystemHealthInputSchema = z.object({
  includeMetrics: z.boolean().default(false),
  includeAlerts: z.boolean().default(true),
});

const GetSystemHealthOutputSchema = SuccessWithDataResponseSchema(SystemHealthOverviewSchema);

export const getSystemHealthContract = oc.route({
  method: "GET",
  path: "/health/system",
  summary: "Get system-wide health overview",
  description: "Retrieve comprehensive system health status including services, resources, and alerts",
  tags: ["Health"],
}).input(GetSystemHealthInputSchema).output(GetSystemHealthOutputSchema);

export type GetSystemHealthInput = z.infer<typeof GetSystemHealthInputSchema>;
export type GetSystemHealthOutput = z.infer<typeof GetSystemHealthOutputSchema>;