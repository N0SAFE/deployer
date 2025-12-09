import { oc } from '@orpc/contract';
import { z } from 'zod';
import { updateProjectSchema, projectSchema } from './schemas';
export const projectUpdateInput = z.object({
    id: z.string().uuid(),
}).merge(updateProjectSchema);
export const projectUpdateOutput = projectSchema;
export const projectUpdateContract = oc
    .route({
    method: "PUT",
    path: "/:id",
    summary: "Update project",
})
    .input(projectUpdateInput)
    .output(projectUpdateOutput);
