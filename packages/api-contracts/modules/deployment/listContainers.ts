import { oc } from '@orpc/contract';
import { z } from 'zod';
import { environmentSchema } from '../../common/deployment-config';

/**
 * Container Listing and Management Contract
 * 
 * Provides endpoints to list and manage all containers across deployments:
 * - List all containers with filtering options
 * - Container status and metadata
 * - Bulk container operations
 */

// Input schemas
const listContainersSchema = z.object({
    status: z.enum(['all', 'running', 'stopped', 'failed']).optional(),
    service: z.string().uuid().optional(),
    project: z.string().uuid().optional(),
    environment: environmentSchema.optional(),
    limit: z.number().min(1).max(100).default(50).optional(),
    offset: z.number().min(0).default(0).optional(),
});

const containerActionSchema = z.object({
    containerId: z.string(),
    action: z.enum(['start', 'stop', 'restart', 'remove']),
});

// Output schemas
const containerInfoSchema = z.object({
    containerId: z.string(),
    containerName: z.string(),
    deploymentId: z.string().uuid(),
    serviceId: z.string().uuid(),
    serviceName: z.string(),
    projectId: z.string().uuid(),
    projectName: z.string(),
    environment: environmentSchema,
    status: z.enum(['running', 'stopped', 'failed', 'starting', 'stopping']),
    health: z.object({
        isHealthy: z.boolean(),
        status: z.string(),
        uptime: z.number(),
        restartCount: z.number(),
        lastStarted: z.date().nullable(),
        resources: z.object({
            cpuUsage: z.number().optional(),
            memoryUsage: z.number().optional(),
            memoryLimit: z.number().optional(),
        }),
    }),
    metadata: z.object({
        imageTag: z.string().optional(),
        ports: z.record(z.string(), z.string()).optional(),
        createdAt: z.date(),
        triggeredBy: z.string().optional(),
        triggerType: z.enum(['webhook', 'manual', 'api', 'github', 'gitlab']).optional(),
        triggerSource: z.string().optional(),
    }),
});

const listContainersOutputSchema = z.object({
    containers: z.array(containerInfoSchema),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
        hasMore: z.boolean(),
    }),
    summary: z.object({
        totalContainers: z.number(),
        runningContainers: z.number(),
        stoppedContainers: z.number(),
        failedContainers: z.number(),
        healthyContainers: z.number(),
    }),
});

const containerActionResultSchema = z.object({
    containerId: z.string(),
    action: z.string(),
    success: z.boolean(),
    message: z.string().optional(),
    timestamp: z.date(),
});

// Contract definitions
export const deploymentListContainersContract = oc
    .route({
        method: 'GET',
        path: '/containers',
        summary: 'List all containers across deployments with filtering options',
    })
    .input(listContainersSchema)
    .output(listContainersOutputSchema);

export const deploymentContainerActionContract = oc
    .route({
        method: 'POST',
        path: '/containers/action',
        summary: 'Perform action on a specific container',
    })
    .input(containerActionSchema)
    .output(containerActionResultSchema);

// Export types for controller usage
export type ListContainersInput = z.infer<typeof listContainersSchema>;
export type ListContainersOutput = z.infer<typeof listContainersOutputSchema>;
export type ContainerInfo = z.infer<typeof containerInfoSchema>;
export type ContainerActionInput = z.infer<typeof containerActionSchema>;
export type ContainerActionResult = z.infer<typeof containerActionResultSchema>;