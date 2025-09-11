import { oc } from "@orpc/contract";
import { z } from "zod";
import { JobQueueStatsSchema, SuccessWithDataResponseSchema } from "./schemas";
const GetJobQueueStatsInputSchema = z.object({
    queue: z.string().optional(),
});
const GetJobQueueStatsOutputSchema = SuccessWithDataResponseSchema(z.object({
    queues: z.array(JobQueueStatsSchema),
    totalStats: z.object({
        totalJobs: z.number(),
        totalWaiting: z.number(),
        totalActive: z.number(),
        totalCompleted: z.number(),
        totalFailed: z.number(),
        avgThroughput: z.number(),
        avgProcessingTime: z.number(),
    }),
}));
export const getJobQueueStatsContract = oc.route({
    method: "GET",
    path: "/jobs/queue-stats",
    summary: "Get job queue statistics",
    description: "Retrieve comprehensive statistics about job queues including throughput and performance metrics",
    tags: ["Jobs"],
}).input(GetJobQueueStatsInputSchema).output(GetJobQueueStatsOutputSchema);
export type GetJobQueueStatsInput = z.infer<typeof GetJobQueueStatsInputSchema>;
export type GetJobQueueStatsOutput = z.infer<typeof GetJobQueueStatsOutputSchema>;
