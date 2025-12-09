import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * Deployment Health Monitoring Contract
 * 
 * Provides comprehensive health monitoring for deployed containers including:
 * - Real-time health status with resource metrics
 * - Container restart capabilities
 * - Detailed health history and logs
 */

// Input schemas
const deploymentIdSchema = z.object({
    deploymentId: z.string().uuid('Deployment ID must be a valid UUID'),
});

// Output schemas
const containerHealthSchema = z.object({
    containerId: z.string(),
    containerName: z.string(),
    health: z.object({
        isHealthy: z.boolean(),
        status: z.string(),
        uptime: z.number(),
        restartCount: z.number(),
        lastStarted: z.date().nullable(),
        healthChecks: z.object({
            status: z.string(),
            failingStreak: z.number(),
            log: z.array(z.object({
                start: z.string(),
                end: z.string(),
                exitCode: z.number(),
                output: z.string(),
            })),
        }).optional(),
        resources: z.object({
            cpuUsage: z.number().optional(),
            memoryUsage: z.number().optional(),
            memoryLimit: z.number().optional(),
        }),
    }),
});

const deploymentHealthSchema = z.object({
    deploymentId: z.string(),
    status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
    containers: z.array(containerHealthSchema),
    httpHealthCheck: z.object({
        isHealthy: z.boolean(),
        httpStatus: z.number().optional(),
        responseTime: z.number().optional(),
        error: z.string().optional(),
    }).optional(),
    lastChecked: z.date(),
});

const deploymentStatusSchema = z.object({
    deployment: z.object({
        id: z.string(),
        serviceId: z.string(),
        status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
        environment: z.enum(['production', 'staging', 'preview', 'development']),
        createdAt: z.date(),
        updatedAt: z.date(),
    }),
    health: deploymentHealthSchema,
    recentLogs: z.array(z.object({
        id: z.string(),
        level: z.string(),
        message: z.string(),
        timestamp: z.date(),
        metadata: z.any().optional(),
    })),
});

const restartResultSchema = z.object({
    success: z.boolean(),
    restartedContainers: z.array(z.string()),
    errors: z.array(z.object({
        containerId: z.string(),
        error: z.string(),
    })),
});

// Contract definitions
export const deploymentHealthMonitorContract = oc
    .route({
        method: 'GET',
        path: '/health/:deploymentId',
        summary: 'Get comprehensive deployment health status',
    })
    .input(deploymentIdSchema)
    .output(deploymentHealthSchema);

export const deploymentDetailedStatusContract = oc
    .route({
        method: 'GET',
        path: '/status/detailed/:deploymentId',
        summary: 'Get comprehensive deployment status with health metrics',
    })
    .input(deploymentIdSchema)
    .output(deploymentStatusSchema.nullable());

export const deploymentRestartUnhealthyContract = oc
    .route({
        method: 'POST',
        path: '/restart-unhealthy/:deploymentId',
        summary: 'Restart unhealthy containers in a deployment',
    })
    .input(deploymentIdSchema)
    .output(restartResultSchema);

// Export types for controller usage
export type DeploymentHealthMonitorInput = z.infer<typeof deploymentIdSchema>;
export type DeploymentHealthMonitorOutput = z.infer<typeof deploymentHealthSchema>;
export type DeploymentDetailedStatusOutput = z.infer<typeof deploymentStatusSchema>;
export type DeploymentRestartUnhealthyOutput = z.infer<typeof restartResultSchema>;