import { oc } from "@orpc/contract";
import { z } from "zod";
import { JobHistoryEntrySchema, SuccessWithDataResponseSchema } from "./schemas";

const GetJobHistoryInputSchema = z.object({
  jobId: z.string(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

const GetJobHistoryOutputSchema = SuccessWithDataResponseSchema(z.object({
  history: z.array(JobHistoryEntrySchema),
  total: z.number(),
  hasMore: z.boolean(),
}));

export const getJobHistoryContract = oc.route({
  method: "GET",
  path: "/jobs/:jobId/history",
  summary: "Get job execution history",
  description: "Retrieve the execution history and timeline for a specific job",
  tags: ["Jobs"],
}).input(GetJobHistoryInputSchema).output(GetJobHistoryOutputSchema);

export type GetJobHistoryInput = z.infer<typeof GetJobHistoryInputSchema>;
export type GetJobHistoryOutput = z.infer<typeof GetJobHistoryOutputSchema>;