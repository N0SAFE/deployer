import { oc } from '@orpc/contract';
import { z } from 'zod';
import { createEnvironmentSchema, deploymentEnvironmentSchema } from './schemas';

export const environmentCreateInput = createEnvironmentSchema;

export const environmentCreateOutput = z.object({
  success: z.boolean(),
  data: deploymentEnvironmentSchema,
});

export const environmentCreateContract = oc
  .route({
    method: "POST",
    path: "/",
    summary: "Create a new environment",
  })
  .input(environmentCreateInput)
  .output(environmentCreateOutput);