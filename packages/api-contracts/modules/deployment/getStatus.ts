import { oc } from '@orpc/contract';
import { z } from 'zod';
// Deployment status types
export const deploymentStatusSchema = z.enum([
    'pending',
    'queued',
    'building',
    'deploying',
    'success',
    'failed',
    'cancelled'
]);
export const deploymentGetStatusInput = z.object({
    deploymentId: z.string(),
});
export const deploymentGetStatusOutput = z.object({
    deploymentId: z.string(),
    status: deploymentStatusSchema,
    stage: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    startedAt: z.date(),
    completedAt: z.date().optional(),
});
export const deploymentGetStatusContract = oc
    .route({
    method: "GET",
    path: "/status/:deploymentId",
    summary: "Get deployment status",
})
    .input(deploymentGetStatusInput)
    .output(deploymentGetStatusOutput);
