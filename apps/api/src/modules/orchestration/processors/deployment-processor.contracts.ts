/**
 * Deployment Processor Job Contracts
 * 
 * Type-safe job contracts for the deployment processor using Zod validation.
 * Used with BaseProcessorService for type-safe Bull queue processing.
 */

import { z } from 'zod/v4';
import {
  jobContractBuilder,
  JobPriority,
  BackoffStrategy,
  type JobContracts,
} from '@/core/modules/jobs/job-contract.builder';

// ============================================================================
// Shared Schemas
// ============================================================================

/** Base result schema used by most jobs */
const baseResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

/** Alert schema for notification jobs */
const alertSchema = z.object({
  stackId: z.string(),
  alertType: z.string(),
  severity: z.string(),
  message: z.string(),
  currentValue: z.number().optional(),
  threshold: z.number().optional(),
});

/** Source configuration schema for deployments */
const sourceConfigSchema = z.object({
  type: z.enum(['github', 'gitlab', 'git', 'upload']),
  repositoryUrl: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  filePath: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  customData: z.record(z.string(), z.unknown()).optional(),
  image: z.string().optional(),
  imagePullPolicy: z.enum(['IfNotPresent', 'Always', 'Never']).optional(),
  registryAuth: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    serveraddress: z.string().optional(),
    identity: z.string().optional(),
    registrytoken: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Job-Specific Data Schemas
// ============================================================================

/** Build job data */
const buildDataSchema = z.object({
  stackName: z.string(),
  buildArgs: z.record(z.string(), z.string()).optional(),
});

/** Standard deployment job data (has deploymentId) */
const standardDeployDataSchema = z.object({
  deploymentId: z.string(),
  projectId: z.string(),
  serviceId: z.string(),
  sourceConfig: sourceConfigSchema,
});

/** Orchestration deploy job data (has stackId, no deploymentId) */
const orchestrationDeployDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
  composeConfig: z.record(z.string(), z.unknown()),
  resourceQuotas: z.record(z.string(), z.unknown()).nullable().optional(),
  domainMappings: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Combined deploy data schema - union of standard and orchestration */
const deployDataSchema = z.union([
  standardDeployDataSchema,
  orchestrationDeployDataSchema,
]);

/** Update job data */
const updateDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
  updates: z.record(z.string(), z.unknown()),
});

/** Remove job data */
const removeDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
});

/** Scale job data */
const scaleDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
  serviceScales: z.record(z.string(), z.number()),
});

/** Update Traefik config job data */
const updateTraefikConfigDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
  domainMappings: z.record(z.string(), z.unknown()),
});

/** Renew certificate job data */
const renewCertificateDataSchema = z.object({
  domain: z.string(),
});

/** Cleanup job data */
const cleanupDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
  cleanupType: z.enum(['volumes', 'images', 'all']).optional(),
});

/** Health check job data */
const healthCheckDataSchema = z.object({
  stackId: z.string(),
  stackName: z.string(),
});

/** Orchestration deploy upload job data */
const orchestrationDeployUploadDataSchema = z.object({
  uploadId: z.string(),
  serviceId: z.string(),
  extractPath: z.string(),
  projectId: z.string(),
  domain: z.string().optional(),
});

/** Alert notification job data */
const alertNotificationDataSchema = z.object({
  alert: alertSchema,
});

/** Rollback job data */
const rollbackDataSchema = z.object({
  deploymentId: z.string(),
  targetDeploymentId: z.string(),
});

/** Deploy upload job data */
const deployUploadDataSchema = z.object({
  uploadId: z.string(),
  serviceId: z.string(),
  deploymentId: z.string(),
  extractPath: z.string(),
  environment: z.string().optional(),
});

// ============================================================================
// Job-Specific Result Schemas
// ============================================================================

/** Deployment result schema */
const deploymentResultSchema = z.object({
  success: z.boolean(),
  deploymentId: z.string(),
  containerId: z.string().optional(),
  imageTag: z.string().optional(),
  domainUrl: z.string().optional(),
  error: z.string().optional(),
  message: z.string(),
});

/** Deploy result schema (can be from standard or orchestration) */
const deployResultSchema = z.union([
  deploymentResultSchema,
  baseResultSchema.extend({
    domain: z.string().nullable().optional(),
    stackId: z.string().optional(),
    stackName: z.string().optional(),
  }),
]);

/** Health check result schema */
const healthCheckResultSchema = baseResultSchema.extend({
  healthResult: z.record(z.string(), z.unknown()).optional(),
});

/** Orchestration deploy upload result schema */
const orchestrationDeployUploadResultSchema = baseResultSchema.extend({
  stackId: z.string().optional(),
  stackName: z.string().optional(),
  type: z.string().optional(),
  domain: z.string().nullable().optional(),
});

// ============================================================================
// Job Contracts Definition
// ============================================================================

/**
 * Deployment processor job contracts
 * 
 * Each contract defines:
 * - data: Input schema validated before job processing
 * - result: Output schema validated after job processing
 * - priority: Job priority in queue (optional)
 * - retry: Retry configuration (optional)
 * - timeout: Job timeout in ms (optional)
 */
export const deploymentContracts = {
  'build': jobContractBuilder()
    .data(buildDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.NORMAL)
    .timeout(600000) // 10 minutes
    .build(),

  'deploy': jobContractBuilder()
    .data(deployDataSchema)
    .result(deployResultSchema)
    .priority(JobPriority.HIGH)
    .timeout(900000) // 15 minutes
    .retry({ attempts: 2, backoff: BackoffStrategy.EXPONENTIAL, delay: 5000 })
    .build(),

  'update': jobContractBuilder()
    .data(updateDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.NORMAL)
    .timeout(600000)
    .build(),

  'remove': jobContractBuilder()
    .data(removeDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.NORMAL)
    .timeout(300000) // 5 minutes
    .build(),

  'scale': jobContractBuilder()
    .data(scaleDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.HIGH)
    .timeout(300000)
    .build(),

  'update-traefik-config': jobContractBuilder()
    .data(updateTraefikConfigDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.NORMAL)
    .timeout(120000) // 2 minutes
    .build(),

  'renew-certificate': jobContractBuilder()
    .data(renewCertificateDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.NORMAL)
    .timeout(300000)
    .build(),

  'cleanup': jobContractBuilder()
    .data(cleanupDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.LOW)
    .timeout(600000)
    .build(),

  'health-check': jobContractBuilder()
    .data(healthCheckDataSchema)
    .result(healthCheckResultSchema)
    .priority(JobPriority.HIGH)
    .timeout(60000) // 1 minute
    .build(),

  'orchestration-deploy-upload': jobContractBuilder()
    .data(orchestrationDeployUploadDataSchema)
    .result(orchestrationDeployUploadResultSchema)
    .priority(JobPriority.HIGH)
    .timeout(900000)
    .build(),

  'send-alert-notification': jobContractBuilder()
    .data(alertNotificationDataSchema)
    .result(baseResultSchema)
    .priority(JobPriority.HIGH)
    .timeout(60000)
    .build(),

  'rollback': jobContractBuilder()
    .data(rollbackDataSchema)
    .result(deploymentResultSchema)
    .priority(JobPriority.CRITICAL)
    .timeout(600000)
    .retry({ attempts: 1 })
    .build(),

  'deploy-upload': jobContractBuilder()
    .data(deployUploadDataSchema)
    .result(deploymentResultSchema)
    .priority(JobPriority.HIGH)
    .timeout(900000)
    .retry({ attempts: 2, backoff: BackoffStrategy.EXPONENTIAL, delay: 5000 })
    .build(),
} satisfies JobContracts;

// ============================================================================
// Type Exports
// ============================================================================

/** Type of all deployment contracts */
export type DeploymentContracts = typeof deploymentContracts;

/** Inferred types from schemas */
export type BuildJobData = z.infer<typeof buildDataSchema>;
export type BuildJobResult = z.infer<typeof baseResultSchema>;

export type DeployJobData = z.infer<typeof deployDataSchema>;
export type StandardDeployJobData = z.infer<typeof standardDeployDataSchema>;
export type OrchestrationDeployJobData = z.infer<typeof orchestrationDeployDataSchema>;
export type DeployJobResult = z.infer<typeof deployResultSchema>;

export type UpdateJobData = z.infer<typeof updateDataSchema>;
export type RemoveJobData = z.infer<typeof removeDataSchema>;
export type ScaleJobData = z.infer<typeof scaleDataSchema>;
export type TraefikConfigUpdateJobData = z.infer<typeof updateTraefikConfigDataSchema>;
export type CertificateRenewalJobData = z.infer<typeof renewCertificateDataSchema>;
export type CleanupJobData = z.infer<typeof cleanupDataSchema>;
export type HealthCheckJobData = z.infer<typeof healthCheckDataSchema>;
export type HealthCheckJobResult = z.infer<typeof healthCheckResultSchema>;
export type OrchestrationDeployUploadJobData = z.infer<typeof orchestrationDeployUploadDataSchema>;
export type OrchestrationDeployUploadJobResult = z.infer<typeof orchestrationDeployUploadResultSchema>;
export type AlertNotificationJobData = z.infer<typeof alertNotificationDataSchema>;
export type RollbackJobData = z.infer<typeof rollbackDataSchema>;
export type DeployUploadJobData = z.infer<typeof deployUploadDataSchema>;
export type DeploymentJobResult = z.infer<typeof deploymentResultSchema>;

// Re-export schemas for use in handlers
export {
  buildDataSchema,
  deployDataSchema,
  standardDeployDataSchema,
  orchestrationDeployDataSchema,
  updateDataSchema,
  removeDataSchema,
  scaleDataSchema,
  updateTraefikConfigDataSchema,
  renewCertificateDataSchema,
  cleanupDataSchema,
  healthCheckDataSchema,
  orchestrationDeployUploadDataSchema,
  alertNotificationDataSchema,
  rollbackDataSchema,
  deployUploadDataSchema,
  baseResultSchema,
  deploymentResultSchema,
  sourceConfigSchema,
};
