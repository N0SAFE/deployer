import { oc } from '@orpc/contract';
import { z } from 'zod';
export const deploymentGetLogsInput = z.object({
    deploymentId: z.string(),
    limit: z.coerce.number().min(1).max(1000).default(100),
    offset: z.coerce.number().min(0).default(0),
});
export const deploymentGetLogsOutput = z.object({
    logs: z.array(z.object({
        id: z.string(),
        timestamp: z.date(),
        level: z.enum(['info', 'warn', 'error', 'debug']),
        message: z.string(),
        service: z.string().optional(),
        stage: z.string().optional(),
    })),
    total: z.number(),
    hasMore: z.boolean(),
});
export const deploymentGetLogsContract = oc
    .route({
    method: "GET",
    path: "/logs",
    summary: "Get deployment logs",
})
    .input(deploymentGetLogsInput)
    .output(deploymentGetLogsOutput);
