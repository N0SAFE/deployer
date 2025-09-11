import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentStatusSchema } from './getStatus';
import { environmentSchema } from './trigger';
export const deploymentListInput = z.object({
    serviceId: z.string().uuid().optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
    status: deploymentStatusSchema.optional(),
});
export const deploymentListOutput = z.object({
    deployments: z.array(z.object({
        id: z.string(),
        serviceId: z.string(),
        status: deploymentStatusSchema,
        environment: environmentSchema,
        triggeredBy: z.string().nullable(),
        createdAt: z.date(),
        updatedAt: z.date(),
        metadata: z.record(z.string(), z.any()).optional(),
    })),
    total: z.number(),
    hasMore: z.boolean(),
});
export const deploymentListContract = oc
    .route({
    method: "GET",
    path: "/list",
    summary: "List deployments for a service",
})
    .input(deploymentListInput)
    .output(deploymentListOutput);
