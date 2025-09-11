import { oc } from '@orpc/contract';
import { z } from 'zod';
export const deploymentCancelInput = z.object({
    deploymentId: z.string(),
    reason: z.string().optional(),
});
export const deploymentCancelOutput = z.object({
    success: z.boolean(),
    message: z.string(),
});
export const deploymentCancelContract = oc
    .route({
    method: "POST",
    path: "/cancel",
    summary: "Cancel deployment",
})
    .input(deploymentCancelInput)
    .output(deploymentCancelOutput);
