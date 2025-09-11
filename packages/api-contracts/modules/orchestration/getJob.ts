import { oc } from "@orpc/contract";
import { z } from "zod";
import { JobStatusSchema, SuccessWithDataResponseSchema } from "./schemas";
const GetJobInputSchema = z.object({
    jobId: z.string(),
});
const GetJobOutputSchema = SuccessWithDataResponseSchema(JobStatusSchema);
export const getJobContract = oc.route({
    method: "GET",
    path: "/jobs/:jobId",
    summary: "Get detailed job information",
    description: "Retrieve detailed information about a specific job including logs and progress",
    tags: ["Jobs"],
}).input(GetJobInputSchema).output(GetJobOutputSchema);
export type GetJobInput = z.infer<typeof GetJobInputSchema>;
export type GetJobOutput = z.infer<typeof GetJobOutputSchema>;
