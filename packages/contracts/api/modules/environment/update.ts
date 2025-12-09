import { oc } from '@orpc/contract';
import { z } from 'zod';
import { updateEnvironmentSchema, deploymentEnvironmentSchema } from './schemas';
export const environmentUpdateInput = updateEnvironmentSchema.extend({
    id: z.string().uuid(),
});
export const environmentUpdateOutput = z.object({
    success: z.boolean(),
    data: deploymentEnvironmentSchema,
});
export const environmentUpdateContract = oc
    .route({
    method: "PUT",
    path: "/:id",
    summary: "Update an existing environment",
})
    .input(environmentUpdateInput)
    .output(environmentUpdateOutput);
