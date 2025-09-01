import { oc } from "@orpc/contract";
import { z } from "zod";
import { ServiceHealthSchema, SuccessWithDataResponseSchema } from "./schemas";

const GetServiceHealthInputSchema = z.object({
  projectId: z.string().optional(),
  stackId: z.string().optional(),
  serviceId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

const GetServiceHealthOutputSchema = SuccessWithDataResponseSchema(z.object({
  services: z.array(ServiceHealthSchema),
  total: z.number(),
  hasMore: z.boolean(),
}));

export const getServiceHealthContract = oc.route({
  method: "GET",
  path: "/health/services",
  summary: "Get service health status",
  description: "Retrieve health status for all services with optional filtering",
  tags: ["Health"],
}).input(GetServiceHealthInputSchema).output(GetServiceHealthOutputSchema);

export type GetServiceHealthInput = z.infer<typeof GetServiceHealthInputSchema>;
export type GetServiceHealthOutput = z.infer<typeof GetServiceHealthOutputSchema>;