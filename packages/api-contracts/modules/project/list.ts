import { oc } from '@orpc/contract';
import { z } from 'zod';
import { projectWithStatsSchema } from './schemas';
export const projectListInput = z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
    search: z.string().optional(),
    sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).optional();
export const projectListOutput = z.object({
    projects: z.array(projectWithStatsSchema),
    total: z.number(),
    hasMore: z.boolean(),
});
export const projectListContract = oc
    .route({
    method: "GET",
    path: "/",
    summary: "List user's projects",
})
    .input(projectListInput)
    .output(projectListOutput);
