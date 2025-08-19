import { z } from 'zod';

// WebSocket Event Schemas
export const DeploymentEventSchema = z.object({
  type: z.enum([
    'deployment_started',
    'deployment_progress',
    'deployment_completed',
    'deployment_failed',
    'deployment_cancelled',
    'log_message'
  ]),
  deploymentId: z.string(),
  projectId: z.string().optional(),
  serviceId: z.string().optional(),
  timestamp: z.date(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const LogMessageEventSchema = z.object({
  type: z.literal('log_message'),
  deploymentId: z.string(),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.date(),
});

export const DeploymentProgressEventSchema = z.object({
  type: z.literal('deployment_progress'),
  deploymentId: z.string(),
  stage: z.enum(['cloning', 'building', 'deploying', 'health_check']),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  timestamp: z.date(),
});

export const ProjectSubscriptionSchema = z.object({
  projectId: z.string(),
});

export const DeploymentSubscriptionSchema = z.object({
  deploymentId: z.string(),
});

export const ServiceSubscriptionSchema = z.object({
  serviceId: z.string(),
});

export type DeploymentEvent = z.infer<typeof DeploymentEventSchema>;
export type LogMessageEvent = z.infer<typeof LogMessageEventSchema>;
export type DeploymentProgressEvent = z.infer<typeof DeploymentProgressEventSchema>;
export type ProjectSubscription = z.infer<typeof ProjectSubscriptionSchema>;
export type DeploymentSubscription = z.infer<typeof DeploymentSubscriptionSchema>;
export type ServiceSubscription = z.infer<typeof ServiceSubscriptionSchema>;