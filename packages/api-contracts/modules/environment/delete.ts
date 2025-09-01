import { oc } from '@orpc/contract';
import { z } from 'zod';

export const environmentDeleteInput = z.object({
  id: z.string().uuid(),
});

export const environmentDeleteOutput = z.object({
  success: z.boolean(),
  data: z.null(),
});

export const environmentDeleteContract = oc
  .route({
    method: "DELETE",
    path: "/:id",
    summary: "Delete an environment",
  })
  .input(environmentDeleteInput)
  .output(environmentDeleteOutput);