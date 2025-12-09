import { oc } from "@orpc/contract";
import { z } from "zod";
import { JobStatusSchema, SuccessWithDataResponseSchema } from "./schemas";
const ListJobsInputSchema = z.object({
    queue: z.string().optional(),
    status: z.enum(['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']).optional(),
    type: z.enum(['deployment', 'scaling', 'ssl-renewal', 'health-check', 'resource-monitoring']).optional(),
    projectId: z.string().optional(),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
    sortBy: z.enum(['createdAt', 'startedAt', 'completedAt', 'priority', 'status']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
const ListJobsOutputSchema = SuccessWithDataResponseSchema(z.object({
    jobs: z.array(JobStatusSchema),
    total: z.number(),
    hasMore: z.boolean(),
}));
export const listJobsContract = oc.route({
    method: "GET",
    path: "/jobs",
    summary: "List jobs with filtering and pagination",
    description: "Retrieve a paginated list of jobs with optional filtering by queue, status, type, and project",
    tags: ["Jobs"],
}).input(ListJobsInputSchema).output(ListJobsOutputSchema);
export type ListJobsInput = z.infer<typeof ListJobsInputSchema>;
export type ListJobsOutput = z.infer<typeof ListJobsOutputSchema>;
