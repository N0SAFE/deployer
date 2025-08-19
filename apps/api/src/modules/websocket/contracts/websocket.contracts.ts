import { oc } from '@orpc/contract';
import { z } from 'zod';

// Regular HTTP endpoints for deployment management
export const deploymentContract = oc
  .route({
    method: 'GET',
    path: '/deployment/{deploymentId}/status',
    summary: 'Get deployment status',
    description: 'Get the current status of a deployment',
  })
  .input(z.object({
    deploymentId: z.string(),
  }))
  .output(z.object({
    deploymentId: z.string(),
    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
    stage: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
    startedAt: z.date().optional(),
    completedAt: z.date().optional(),
  }));

export const triggerDeploymentContract = oc
  .route({
    method: 'POST',
    path: '/deployment/trigger',
    summary: 'Trigger deployment',
    description: 'Start a new deployment for a service',
  })
  .input(z.object({
    serviceId: z.string(),
    environment: z.enum(['production', 'staging', 'preview', 'development']).default('production'),
    sourceConfig: z.object({
      type: z.enum(['github', 'gitlab', 'git', 'upload']),
      repositoryUrl: z.string().optional(),
      branch: z.string().optional(),
      commitSha: z.string().optional(),
      filePath: z.string().optional(),
    }),
    environmentVariables: z.record(z.string(), z.string()).optional(),
  }))
  .output(z.object({
    deploymentId: z.string(),
    jobId: z.string(),
    status: z.string(),
    message: z.string(),
  }));

export const cancelDeploymentContract = oc
  .route({
    method: 'POST',
    path: '/deployment/{deploymentId}/cancel',
    summary: 'Cancel deployment',
    description: 'Cancel an ongoing deployment',
  })
  .input(z.object({
    deploymentId: z.string(),
    reason: z.string().optional(),
  }))
  .output(z.object({
    success: z.boolean(),
    message: z.string(),
  }));

export const rollbackDeploymentContract = oc
  .route({
    method: 'POST',
    path: '/deployment/{deploymentId}/rollback',
    summary: 'Rollback deployment',
    description: 'Rollback to a previous deployment',
  })
  .input(z.object({
    deploymentId: z.string(),
    targetDeploymentId: z.string(),
  }))
  .output(z.object({
    rollbackJobId: z.string(),
    message: z.string(),
  }));