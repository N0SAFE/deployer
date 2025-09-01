import { oc } from '@orpc/contract';
import { z } from 'zod';

export const projectDeleteInput = z.object({
  id: z.string().uuid(),
});

export const projectDeleteOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const projectDeleteContract = oc
  .route({
    method: "DELETE",
    path: "/:id",
    summary: "Delete project",
  })
  .input(projectDeleteInput)
  .output(projectDeleteOutput);