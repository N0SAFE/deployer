import { oc } from "@orpc/contract";
import { z } from "zod";
import { HealthHistoryEntrySchema, SuccessWithDataResponseSchema } from "./schemas";

const GetHealthHistoryInputSchema = z.object({
  serviceId: z.string().optional(),
  healthCheckId: z.string().optional(),
  timeRange: z.enum(['1h', '6h', '24h', '7d', '30d']).default('24h'),
  eventTypes: z.array(z.enum(['status_change', 'failure', 'recovery', 'timeout', 'error'])).optional(),
  limit: z.number().min(1).max(200).default(100),
  offset: z.number().min(0).default(0),
});

const GetHealthHistoryOutputSchema = SuccessWithDataResponseSchema(z.object({
  history: z.array(HealthHistoryEntrySchema),
  total: z.number(),
  hasMore: z.boolean(),
  summary: z.object({
    totalEvents: z.number(),
    uptimePercentage: z.number(),
    mttr: z.number(), // Mean Time To Recovery
    mtbf: z.number(), // Mean Time Between Failures
    availabilityScore: z.number(),
  }),
}));

export const getHealthHistoryContract = oc.route({
  method: "GET",
  path: "/health/history",
  summary: "Get health check history",
  description: "Retrieve historical health check events and availability metrics",
  tags: ["Health"],
}).input(GetHealthHistoryInputSchema).output(GetHealthHistoryOutputSchema);

export type GetHealthHistoryInput = z.infer<typeof GetHealthHistoryInputSchema>;
export type GetHealthHistoryOutput = z.infer<typeof GetHealthHistoryOutputSchema>;