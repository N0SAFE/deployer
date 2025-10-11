import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentStatusSchema, environmentSchema, sourceTypeSchema } from '../../common/deployment-config';

export const deploymentGetStatusInput = z.object({
    deploymentId: z.string().uuid(),
});

export const deploymentGetStatusOutput = z.object({
    deploymentId: z.string().uuid(),
    serviceId: z.string().uuid(),
    status: deploymentStatusSchema,
    stage: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    
    // Container and deployment information
    containerId: z.string().optional(),
    url: z.string().url().optional(),
    internalUrl: z.string().url().optional(),
    
    // Build information
    buildDuration: z.number().optional(),
    deploymentSize: z.number().optional(),
    
    // Health status
    healthStatus: z.enum(['healthy', 'unhealthy', 'starting']).optional(),
    lastHealthCheck: z.date().optional(),
    
    // Timestamps
    startedAt: z.date(),
    completedAt: z.date().optional(),
    
    // Metadata
    deployedBy: z.string(),
    environment: environmentSchema,
    sourceType: sourceTypeSchema
});

export const deploymentGetStatusContract = oc
    .route({
    method: "GET",
    path: "/status/:deploymentId",
    summary: "Get deployment status",
})
    .input(deploymentGetStatusInput)
    .output(deploymentGetStatusOutput);
