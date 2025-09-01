import { z } from 'zod';

/**
 * CI/CD Schemas - Pipeline, Build, and Webhook Management
 * 
 * Contains schemas for advanced CI/CD automation features:
 * - Pipeline configuration and execution
 * - Build automation and artifacts
 * - Webhook integration and delivery tracking
 * 
 * Note: Basic deployment schemas are in the main deployment contract.
 * This focuses on pipeline-driven automation workflows.
 */

// =============================================================================
// PIPELINE SCHEMAS
// =============================================================================

export const PipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  environmentId: z.string(),
  status: z.enum(['idle', 'running', 'success', 'failed', 'cancelled']),
  branch: z.string(),
  commitSha: z.string(),
  commitMessage: z.string().optional(),
  author: z.string().optional(),
  triggeredBy: z.enum(['manual', 'webhook', 'schedule', 'api']),
  triggeredAt: z.date(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  duration: z.number().optional(), // milliseconds
  stages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['pending', 'running', 'success', 'failed', 'cancelled', 'skipped']),
    startedAt: z.date().optional(),
    completedAt: z.date().optional(),
    duration: z.number().optional(),
    logs: z.string().optional(),
    artifacts: z.array(z.string()).optional(),
  })),
  config: z.object({
    buildCommand: z.string().optional(),
    testCommand: z.string().optional(),
    deployCommand: z.string().optional(),
    environment: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
    retryCount: z.number().optional(),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const PipelineConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  projectId: z.string(),
  branch: z.string().default('main'),
  triggers: z.object({
    webhook: z.boolean().default(true),
    manual: z.boolean().default(true),
    schedule: z.string().optional(), // cron expression
  }),
  stages: z.array(z.object({
    name: z.string(),
    script: z.string(),
    environment: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
    retryCount: z.number().default(0),
    continueOnError: z.boolean().default(false),
  })),
  environment: z.record(z.string(), z.string()).optional(),
  notifications: z.object({
    email: z.array(z.string()).optional(),
    slack: z.string().optional(),
    webhook: z.string().optional(),
  }).optional(),
  artifacts: z.object({
    paths: z.array(z.string()).optional(),
    retention: z.number().optional(), // days
  }).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// =============================================================================
// BUILD SCHEMAS
// =============================================================================

export const BuildSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  number: z.number(),
  status: z.enum(['queued', 'running', 'success', 'failed', 'cancelled']),
  branch: z.string(),
  commitSha: z.string(),
  commitMessage: z.string().optional(),
  author: z.string().optional(),
  triggeredBy: z.string(),
  triggeredAt: z.date(),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  duration: z.number().optional(),
  logs: z.string().optional(),
  artifacts: z.array(z.object({
    name: z.string(),
    path: z.string(),
    size: z.number(),
    type: z.string(),
    downloadUrl: z.string().optional(),
  })).optional(),
  testResults: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    coverage: z.number().optional(),
  }).optional(),
  deploymentId: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// =============================================================================
// WEBHOOK SCHEMAS
// =============================================================================

export const WebhookConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  secret: z.string().optional(),
  events: z.array(z.enum([
    'pipeline.started',
    'pipeline.completed',
    'pipeline.failed',
    'build.started',
    'build.completed',
    'build.failed',
    'deployment.started',
    'deployment.completed',
    'deployment.failed',
    'deployment.rolled-back',
  ])),
  isActive: z.boolean().default(true),
  headers: z.record(z.string(), z.string()).optional(),
  retryPolicy: z.object({
    maxRetries: z.number().default(3),
    backoffMultiplier: z.number().default(2),
    initialDelay: z.number().default(1000),
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const WebhookDeliverySchema = z.object({
  id: z.string(),
  webhookConfigId: z.string(),
  event: z.string(),
  payload: z.record(z.string(), z.any()),
  status: z.enum(['pending', 'success', 'failed', 'retrying']),
  responseStatus: z.number().optional(),
  responseBody: z.string().optional(),
  attempts: z.number().default(1),
  maxAttempts: z.number().default(3),
  nextAttemptAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// =============================================================================
// INPUT & UPDATE SCHEMAS
// =============================================================================

export const CreatePipelineConfigInput = PipelineConfigSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const UpdatePipelineConfigInput = CreatePipelineConfigInput.partial();

export const CreateBuildInput = z.object({
  pipelineId: z.string(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  triggeredBy: z.string().default('manual'),
});

export const CreateWebhookConfigInput = WebhookConfigSchema.omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const UpdateWebhookConfigInput = CreateWebhookConfigInput.partial();

// =============================================================================
// QUERY SCHEMAS
// =============================================================================

export const PipelineQuerySchema = z.object({
  projectId: z.string().optional(),
  environmentId: z.string().optional(),
  status: z.string().optional(),
  branch: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

export const BuildQuerySchema = z.object({
  pipelineId: z.string().optional(),
  status: z.string().optional(),
  branch: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

// =============================================================================
// STATISTICS SCHEMAS
// =============================================================================

export const PipelineStatsSchema = z.object({
  totalPipelines: z.number(),
  activePipelines: z.number(),
  successRate: z.number(),
  averageDuration: z.number(),
  runsToday: z.number(),
  runsThisWeek: z.number(),
  runsThisMonth: z.number(),
});

export const BuildStatsSchema = z.object({
  totalBuilds: z.number(),
  successfulBuilds: z.number(),
  failedBuilds: z.number(),
  averageBuildTime: z.number(),
  successRate: z.number(),
  buildsToday: z.number(),
  buildsThisWeek: z.number(),
  buildsThisMonth: z.number(),
});

// =============================================================================
// CI/CD OVERVIEW SCHEMA
// =============================================================================

export const CiCdOverviewSchema = z.object({
  pipelines: PipelineStatsSchema,
  builds: BuildStatsSchema,
  webhooks: z.object({
    totalWebhooks: z.number(),
    activeWebhooks: z.number(),
    totalDeliveries: z.number(),
    successfulDeliveries: z.number(),
    failedDeliveries: z.number(),
    successRate: z.number(),
  }),
  recentActivity: z.array(z.object({
    id: z.string(),
    type: z.enum(['pipeline', 'build', 'webhook']),
    name: z.string(),
    status: z.string(),
    timestamp: z.date(),
  })),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type Build = z.infer<typeof BuildSchema>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
export type CiCdOverview = z.infer<typeof CiCdOverviewSchema>;