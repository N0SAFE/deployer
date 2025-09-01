import { oc } from '@orpc/contract';
import { z } from 'zod';

export const deploymentRollbackInput = z.object({
  deploymentId: z.string(),
  targetDeploymentId: z.string(),
});

export const deploymentRollbackOutput = z.object({
  rollbackJobId: z.string(),
  message: z.string(),
});

export const deploymentRollbackContract = oc
  .route({
    method: "POST",
    path: "/rollback",
    summary: "Rollback deployment",
  })
  .input(deploymentRollbackInput)
  .output(deploymentRollbackOutput);