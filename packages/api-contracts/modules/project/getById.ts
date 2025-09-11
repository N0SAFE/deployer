import { oc } from '@orpc/contract';
import { z } from 'zod';
import { projectWithStatsSchema } from './schemas';
export const projectGetByIdInput = z.object({
    id: z.string().uuid(),
});
export const projectGetByIdOutput = projectWithStatsSchema;
export const projectGetByIdContract = oc
    .route({
    method: "GET",
    path: "/:id",
    summary: "Get project by ID",
})
    .input(projectGetByIdInput)
    .output(projectGetByIdOutput);
