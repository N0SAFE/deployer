import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  deploymentStatusSchema,
  environmentSchema,
  sourceTypeSchema,
  deploymentSummarySchema
} from '../../common/deployment-config';
export const deploymentListInput = z.object({
    serviceId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    environment: environmentSchema.optional(),
    status: deploymentStatusSchema.optional(),
    sourceType: sourceTypeSchema.optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
    sortBy: z.enum(['createdAt', 'updatedAt', 'status']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
});
export const deploymentListOutput = z.object({
    deployments: z.array(deploymentSummarySchema),
    total: z.number(),
    hasMore: z.boolean(),
    filters: z.object({
        environment: environmentSchema.optional(),
        status: deploymentStatusSchema.optional(),
        sourceType: sourceTypeSchema.optional()
    })
});
export const deploymentListContract = oc
    .route({
    method: "GET",
    path: "/list",
    summary: "List deployments for a service",
})
    .input(deploymentListInput)
    .output(deploymentListOutput);
