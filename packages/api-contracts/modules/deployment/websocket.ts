import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentStatusSchema } from './getStatus';

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

// Subscribe to deployment events
export const deploymentSubscribeInput = z.object({
  deploymentId: z.string().optional(),
  projectId: z.string().optional(),
  serviceId: z.string().optional(),
});

export const deploymentSubscribeOutput = z.void();

export const deploymentSubscribeContract = oc
  .input(deploymentSubscribeInput)
  .output(deploymentSubscribeOutput);

// Unsubscribe from deployment events
export const deploymentUnsubscribeInput = z.object({
  deploymentId: z.string().optional(),
  projectId: z.string().optional(),
  serviceId: z.string().optional(),
});

export const deploymentUnsubscribeOutput = z.void();

export const deploymentUnsubscribeContract = oc
  .input(deploymentUnsubscribeInput)
  .output(deploymentUnsubscribeOutput);

// Deployment status updates (server-to-client)
export const deploymentStatusUpdateInput = z.void();
export const deploymentStatusUpdateOutput = deploymentStatusEventSchema;

export const deploymentStatusUpdateContract = oc
  .input(deploymentStatusUpdateInput)
  .output(deploymentStatusUpdateOutput);

// Deployment log stream (server-to-client)
export const deploymentLogStreamInput = z.void();
export const deploymentLogStreamOutput = deploymentLogEventSchema;

export const deploymentLogStreamContract = oc
  .input(deploymentLogStreamInput)
  .output(deploymentLogStreamOutput);