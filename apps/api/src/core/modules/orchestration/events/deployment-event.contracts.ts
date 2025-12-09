import { z } from 'zod/v4';
import {
  contractBuilder,
  ProcessingStrategy,
} from '@/core/modules/events';

/**
 * Deployment phase enum values
 */
export const deploymentPhases = [
  'queued',
  'pulling_source',
  'building',
  'copying_files',
  'deploying',
  'registering_domain',
  'health_check',
  'active',
  'failed',
  'cancelled',
] as const;

/**
 * Deployment event input schema
 * Filter subscriptions by deploymentId, projectId, serviceId
 */
const deploymentEventInputSchema = z.object({
  deploymentId: z.string().describe('Unique deployment identifier'),
  projectId: z.string().optional().describe('Project ID for filtering'),
  serviceId: z.string().optional().describe('Service ID for filtering'),
});

/**
 * Deployment progress event output schema
 * Emitted during deployment processing to track progress
 */
const deploymentProgressOutputSchema = z.object({
  /** Current deployment phase */
  phase: z.enum(deploymentPhases).describe('Current deployment phase'),
  /** Progress percentage (0-100) */
  progress: z.number().min(0).max(100).describe('Progress percentage'),
  /** Human-readable status message */
  status: z.string().describe('Current status message'),
  /** Optional detailed message or log line */
  message: z.string().optional().describe('Detailed message'),
  /** Phase-specific metadata */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional phase metadata'),
  /** ISO timestamp */
  timestamp: z.string().describe('Event timestamp'),
});

/**
 * Deploy job event contract
 * Emits progress events during deployment
 */
const deployProgressContract = contractBuilder()
  .input(deploymentEventInputSchema)
  .output(deploymentProgressOutputSchema)
  .strategy(ProcessingStrategy.PARALLEL)
  .build();

/**
 * Deployment status change event output schema
 * Emitted when deployment status changes
 */
const deploymentStatusOutputSchema = z.object({
  /** Previous status */
  previousStatus: z.string().optional().describe('Previous deployment status'),
  /** New status */
  status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']).describe('New deployment status'),
  /** Status change reason */
  reason: z.string().optional().describe('Reason for status change'),
  /** Error details if failed */
  error: z.string().optional().describe('Error message if failed'),
  /** ISO timestamp */
  timestamp: z.string().describe('Event timestamp'),
});

/**
 * Deployment status change event contract
 */
const deploymentStatusContract = contractBuilder()
  .input(deploymentEventInputSchema)
  .output(deploymentStatusOutputSchema)
  .strategy(ProcessingStrategy.PARALLEL)
  .build();

/**
 * Deployment log event output schema
 * Emitted for each log line during deployment
 */
const deploymentLogOutputSchema = z.object({
  /** Log level */
  level: z.enum(['debug', 'info', 'warn', 'error']).describe('Log level'),
  /** Log message */
  message: z.string().describe('Log message'),
  /** Deployment phase when log was generated */
  phase: z.enum(deploymentPhases).optional().describe('Current phase'),
  /** Optional step within phase */
  step: z.string().optional().describe('Current step'),
  /** ISO timestamp */
  timestamp: z.string().describe('Event timestamp'),
});

/**
 * Deployment log event contract
 */
const deploymentLogContract = contractBuilder()
  .input(deploymentEventInputSchema)
  .output(deploymentLogOutputSchema)
  .strategy(ProcessingStrategy.PARALLEL)
  .build();

/**
 * Deployment event contracts
 */
export const deploymentEventContracts = {
  /** Progress updates during deployment */
  deployProgress: deployProgressContract,
  /** Status change notifications */
  deploymentStatus: deploymentStatusContract,
  /** Log streaming */
  deploymentLog: deploymentLogContract,
} as const;

/**
 * Type alias for deployment event contracts
 */
export type DeploymentEventContracts = typeof deploymentEventContracts;

/**
 * Type exports for external usage
 */
export type DeploymentEventInput = z.infer<typeof deploymentEventInputSchema>;
export type DeploymentProgressOutput = z.infer<typeof deploymentProgressOutputSchema>;
export type DeploymentStatusOutput = z.infer<typeof deploymentStatusOutputSchema>;
export type DeploymentLogOutput = z.infer<typeof deploymentLogOutputSchema>;
export type DeploymentPhase = typeof deploymentPhases[number];
