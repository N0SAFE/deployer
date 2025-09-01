import { oc } from "@orpc/contract";
import { z } from "zod";
import { SuccessResponseSchema } from "./schemas";

const CancelJobInputSchema = z.object({
  jobId: z.string(),
  reason: z.string().optional(),
});

const CancelJobOutputSchema = SuccessResponseSchema.extend({
  data: z.object({
    jobId: z.string(),
    cancelled: z.boolean(),
    reason: z.string().optional(),
  }),
});

export const cancelJobContract = oc.route({
  method: "DELETE",
  path: "/jobs/:jobId",
  summary: "Cancel a job",
  description: "Cancel a waiting or active job before it completes",
  tags: ["Jobs"],
}).input(CancelJobInputSchema).output(CancelJobOutputSchema);

export type CancelJobInput = z.infer<typeof CancelJobInputSchema>;
export type CancelJobOutput = z.infer<typeof CancelJobOutputSchema>;