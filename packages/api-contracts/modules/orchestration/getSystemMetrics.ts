import { oc } from "@orpc/contract";
import { z } from "zod";
import { SystemMetricsSchema, SuccessWithDataResponseSchema } from "./schemas";

const GetSystemMetricsInputSchema = z.object({
  timeRange: z.enum(['1h', '6h', '24h', '7d', '30d']).default('1h'),
  resolution: z.enum(['1m', '5m', '15m', '1h', '1d']).optional(),
  includeProjection: z.boolean().default(false),
});

const GetSystemMetricsOutputSchema = SuccessWithDataResponseSchema(z.object({
  metrics: z.array(SystemMetricsSchema),
  aggregated: z.object({
    avgCpuUsage: z.number(),
    avgMemoryUsage: z.number(),
    avgDiskUsage: z.number(),
    avgNetworkThroughput: z.number(),
    peakCpuUsage: z.number(),
    peakMemoryUsage: z.number(),
    totalUptime: z.number(),
    reliabilityScore: z.number(),
  }),
  trends: z.object({
    cpuTrend: z.enum(['increasing', 'decreasing', 'stable']),
    memoryTrend: z.enum(['increasing', 'decreasing', 'stable']),
    diskTrend: z.enum(['increasing', 'decreasing', 'stable']),
    serviceTrend: z.enum(['improving', 'degrading', 'stable']),
  }).optional(),
}));

export const getSystemMetricsContract = oc.route({
  method: "GET",
  path: "/health/metrics",
  summary: "Get system metrics and trends",
  description: "Retrieve historical system metrics with trend analysis and projections",
  tags: ["Health"],
}).input(GetSystemMetricsInputSchema).output(GetSystemMetricsOutputSchema);

export type GetSystemMetricsInput = z.infer<typeof GetSystemMetricsInputSchema>;
export type GetSystemMetricsOutput = z.infer<typeof GetSystemMetricsOutputSchema>;