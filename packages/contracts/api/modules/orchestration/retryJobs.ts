import { oc } from "@orpc/contract";
import { z } from "zod";
import { JobRetryRequestSchema, SuccessResponseSchema } from "./schemas";
const RetryJobsInputSchema = JobRetryRequestSchema;
const RetryJobsOutputSchema = SuccessResponseSchema.extend({
    data: z.object({
        retriedJobs: z.array(z.string()),
        failedRetries: z.array(z.object({
            jobId: z.string(),
            error: z.string(),
        })),
    }),
});
export const retryJobsContract = oc.route({
    method: "POST",
    path: "/jobs/retry",
    summary: "Retry failed jobs",
    description: "Retry one or more failed jobs, optionally resetting their attempt counters",
    tags: ["Jobs"],
}).input(RetryJobsInputSchema).output(RetryJobsOutputSchema);
export type RetryJobsInput = z.infer<typeof RetryJobsInputSchema>;
export type RetryJobsOutput = z.infer<typeof RetryJobsOutputSchema>;
