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

export const environmentSchema = z.enum(['production', 'staging', 'preview', 'development']);

export const sourceTypeSchema = z.enum(['github', 'gitlab', 'git', 'upload', 'custom']);

// Source configuration schema that matches database
export const sourceConfigSchema = z.object({
  // GitHub/GitLab
  repositoryUrl: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  pullRequestNumber: z.number().optional(),
  // File upload
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  // Custom
  customData: z.record(z.string(), z.any()).optional(),
});

// WebSocket event schemas
export const deploymentStatusEventSchema = z.object({
  deploymentId: z.string(),
  status: deploymentStatusSchema,
  stage: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  logs: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const deploymentLogEventSchema = z.object({
  deploymentId: z.string(),
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  service: z.string().optional(),
  stage: z.string().optional(),
});

// HTTP API contracts
export const deploymentContract = oc.router({
  // Get deployment status
  getStatus: oc
    .route({
      method: "GET",
      path: "/status/:deploymentId",
      summary: "Get deployment status",
    })
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .output(
      z.object({
        deploymentId: z.string(),
        status: deploymentStatusSchema,
        stage: z.string().optional(),
        progress: z.number().min(0).max(100).optional(),
        startedAt: z.date(),
        completedAt: z.date().optional(),
      })
    ),

  // Trigger new deployment
  trigger: oc
    .route({
      method: "POST",
      path: "/trigger",
      summary: "Trigger new deployment",
    })
    .input(
      z.object({
        serviceId: z.string(),
        environment: environmentSchema,
        sourceType: sourceTypeSchema,
        sourceConfig: sourceConfigSchema,
        environmentVariables: z.record(z.string(), z.string()).optional(),
      })
    )
    .output(
      z.object({
        deploymentId: z.string(),
        jobId: z.string(),
        status: z.string(),
        message: z.string(),
      })
    ),

  // Cancel deployment
  cancel: oc
    .route({
      method: "POST",
      path: "/cancel",
      summary: "Cancel deployment",
    })
    .input(
      z.object({
        deploymentId: z.string(),
        reason: z.string().optional(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    ),

  // Rollback deployment
  rollback: oc
    .route({
      method: "POST",
      path: "/rollback",
      summary: "Rollback deployment",
    })
    .input(
      z.object({
        deploymentId: z.string(),
        targetDeploymentId: z.string(),
      })
    )
    .output(
      z.object({
        rollbackJobId: z.string(),
        message: z.string(),
      })
    ),

  // Get deployment logs
  getLogs: oc
    .route({
      method: "GET",
      path: "/logs",
      summary: "Get deployment logs",
    })
    .input(
      z.object({
        deploymentId: z.string(),
        limit: z.number().min(1).max(1000).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .output(
      z.object({
        logs: z.array(
          z.object({
            id: z.string(),
            timestamp: z.date(),
            level: z.enum(['info', 'warn', 'error', 'debug']),
            message: z.string(),
            service: z.string().optional(),
            stage: z.string().optional(),
          })
        ),
        total: z.number(),
        hasMore: z.boolean(),
      })
    ),

  // List deployments for a service
  list: oc
    .route({
      method: "GET",
      path: "/list",
      summary: "List deployments for a service",
    })
    .input(
      z.object({
        serviceId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: deploymentStatusSchema.optional(),
      })
    )
    .output(
      z.object({
        deployments: z.array(
          z.object({
            id: z.string(),
            serviceId: z.string(),
            status: deploymentStatusSchema,
            environment: environmentSchema,
            triggeredBy: z.string().nullable(),
            createdAt: z.date(),
            updatedAt: z.date(),
            metadata: z.record(z.string(), z.any()).optional(),
          })
        ),
        total: z.number(),
        hasMore: z.boolean(),
      })
    ),
});

// WebSocket contracts for real-time events
export const deploymentWebSocketContract = oc.router({
  // Subscribe to deployment events
  subscribe: oc
    .input(
      z.object({
        deploymentId: z.string().optional(),
        projectId: z.string().optional(),
        serviceId: z.string().optional(),
      })
    )
    .output(z.void()),

  // Unsubscribe from deployment events
  unsubscribe: oc
    .input(
      z.object({
        deploymentId: z.string().optional(),
        projectId: z.string().optional(),
        serviceId: z.string().optional(),
      })
    )
    .output(z.void()),

  // Deployment status updates (server-to-client)
  statusUpdate: oc
    .input(z.void())
    .output(deploymentStatusEventSchema),

  // Deployment log stream (server-to-client)
  logStream: oc
    .input(z.void())
    .output(deploymentLogEventSchema),
});

export type DeploymentContract = typeof deploymentContract;
export type DeploymentWebSocketContract = typeof deploymentWebSocketContract;