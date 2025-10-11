import { oc } from "@orpc/contract";
import { z } from "zod";
import { SuccessResponseSchema } from "./schemas";
const RunHealthCheckInputSchema = z.object({
    serviceId: z.string().optional(),
    healthCheckId: z.string().optional(),
    force: z.boolean().default(false),
});
const RunHealthCheckOutputSchema = SuccessResponseSchema.extend({
    data: z.object({
        triggered: z.array(z.object({
            healthCheckId: z.string(),
            healthCheckName: z.string(),
            serviceId: z.string(),
            serviceName: z.string(),
            scheduled: z.boolean(),
        })),
        skipped: z.array(z.object({
            healthCheckId: z.string(),
            reason: z.string(),
        })),
        totalTriggered: z.number(),
    }),
});
export const runHealthCheckContract = oc.route({
    method: "POST",
    path: "/health/run",
    summary: "Trigger health checks",
    description: "Manually trigger health checks for specific services or all services",
    tags: ["Health"],
}).input(RunHealthCheckInputSchema).output(RunHealthCheckOutputSchema);
export type RunHealthCheckInput = z.infer<typeof RunHealthCheckInputSchema>;
export type RunHealthCheckOutput = z.infer<typeof RunHealthCheckOutputSchema>;
