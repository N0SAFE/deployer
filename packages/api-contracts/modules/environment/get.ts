import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentEnvironmentSchema } from './schemas';
export const environmentGetInput = z.object({
    id: z.string().uuid(),
});
export const environmentGetOutput = z.object({
    success: z.boolean(),
    data: deploymentEnvironmentSchema,
});
export const environmentGetContract = oc
    .route({
    method: "GET",
    path: "/:id",
    summary: "Get environment details by ID",
})
    .input(environmentGetInput)
    .output(environmentGetOutput);
