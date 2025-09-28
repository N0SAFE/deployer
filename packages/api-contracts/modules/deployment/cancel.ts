import { oc } from '@orpc/contract';
import { z } from 'zod';
export const deploymentCancelInput = z.object({
    deploymentId: z.string().uuid(),
    reason: z.string().optional(),
    force: z.boolean().default(false)
});
export const deploymentCancelOutput = z.object({
    success: z.boolean(),
    message: z.string(),
    deploymentId: z.string().uuid(),
    cancelledAt: z.date(),
    cleanupRequired: z.boolean().optional()
});
export const deploymentCancelContract = oc
    .route({
    method: "POST",
    path: "/cancel",
    summary: "Cancel deployment",
})
    .input(deploymentCancelInput)
    .output(deploymentCancelOutput);
