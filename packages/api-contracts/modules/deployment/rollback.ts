import { oc } from '@orpc/contract';
import { z } from 'zod';
export const deploymentRollbackInput = z.object({
    deploymentId: z.string().uuid(),
    targetDeploymentId: z.string().uuid(),
    reason: z.string().optional(),
    force: z.boolean().default(false)
});
export const deploymentRollbackOutput = z.object({
    rollbackJobId: z.string(),
    rollbackDeploymentId: z.string().uuid(),
    message: z.string(),
    estimatedDuration: z.number().optional(),
    affectedServices: z.array(z.string()).optional()
});
export const deploymentRollbackContract = oc
    .route({
    method: "POST",
    path: "/rollback",
    summary: "Rollback deployment",
})
    .input(deploymentRollbackInput)
    .output(deploymentRollbackOutput);
