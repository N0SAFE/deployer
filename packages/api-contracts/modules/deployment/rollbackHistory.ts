import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * Get list of deployments available for rollback
 * Returns successful deployments within the retention policy
 */
export const deploymentGetRollbackHistoryContract = oc
    .route({
        method: 'GET',
        path: '/rollback-history',
        summary: 'Get deployments available for rollback',
        description: 'Retrieve list of successful deployments that can be used for rollback, ordered by creation date (newest first)',
    })
    .input(
        z.object({
            serviceId: z.string().uuid().describe('Service ID to get rollback history for'),
        })
    )
    .output(
        z.object({
            serviceId: z.string(),
            maxRetention: z.number().describe('Maximum number of deployments retained for rollback'),
            availableDeployments: z.array(
                z.object({
                    id: z.string(),
                    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
                    createdAt: z.date(),
                    updatedAt: z.date(),
                    containerName: z.string().nullable(),
                    containerImage: z.string().nullable(),
                    domainUrl: z.string().nullable(),
                    metadata: z.object({
                        version: z.string().optional(),
                        branch: z.string().optional(),
                        commitSha: z.string().optional(),
                    }).optional(),
                    sourceConfig: z.object({
                        repositoryUrl: z.string().optional(),
                        branch: z.string().optional(),
                        commitSha: z.string().optional(),
                    }).optional(),
                })
            ),
            currentDeploymentId: z.string().nullable().describe('Currently active deployment ID'),
        })
    );

/**
 * Preview cleanup - see what would be deleted without actually deleting
 */
export const deploymentPreviewCleanupContract = oc
    .route({
        method: 'GET',
        path: '/preview-cleanup',
        summary: 'Preview deployment cleanup',
        description: 'See which deployments would be deleted based on retention policy, without actually deleting them',
    })
    .input(
        z.object({
            serviceId: z.string().uuid().describe('Service ID to preview cleanup for'),
        })
    )
    .output(
        z.object({
            serviceId: z.string(),
            willDelete: z.number().describe('Number of deployments that would be deleted'),
            willKeep: z.number().describe('Number of deployments that would be kept'),
            deploymentsToDelete: z.array(
                z.object({
                    id: z.string(),
                    createdAt: z.date(),
                    containerName: z.string().nullable(),
                })
            ),
            deploymentsToKeep: z.array(
                z.object({
                    id: z.string(),
                    createdAt: z.date(),
                    containerName: z.string().nullable(),
                })
            ),
        })
    );

/**
 * Manually trigger cleanup for a service
 */
export const deploymentTriggerCleanupContract = oc
    .route({
        method: 'POST',
        path: '/trigger-cleanup',
        summary: 'Manually trigger deployment cleanup',
        description: 'Manually trigger cleanup of old deployments based on retention policy',
    })
    .input(
        z.object({
            serviceId: z.string().uuid().describe('Service ID to cleanup deployments for'),
        })
    )
    .output(
        z.object({
            success: z.boolean(),
            serviceId: z.string(),
            deletedCount: z.number(),
            deletedDeployments: z.array(z.string()),
            keptCount: z.number(),
            message: z.string(),
        })
    );

/**
 * Update service retention policy
 */
export const deploymentUpdateRetentionPolicyContract = oc
    .route({
        method: 'PATCH',
        path: '/retention-policy',
        summary: 'Update deployment retention policy',
        description: 'Update the number of successful deployments to retain for rollback',
    })
    .input(
        z.object({
            serviceId: z.string().uuid().describe('Service ID to update retention policy for'),
            maxSuccessfulDeployments: z.number().min(1).max(50).optional()
                .describe('Maximum number of successful deployments to keep (1-50)'),
            keepArtifacts: z.boolean().optional()
                .describe('Whether to keep deployment artifacts (Docker images, built files)'),
            autoCleanup: z.boolean().optional()
                .describe('Whether to automatically cleanup old deployments'),
        })
    )
    .output(
        z.object({
            success: z.boolean(),
            serviceId: z.string(),
            retentionPolicy: z.object({
                maxSuccessfulDeployments: z.number(),
                keepArtifacts: z.boolean(),
                autoCleanup: z.boolean(),
            }),
            message: z.string(),
        })
    );
