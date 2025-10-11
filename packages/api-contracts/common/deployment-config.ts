import { z } from 'zod';

// Core deployment enums
export const deploymentProviderSchema = z.enum([
  'docker-compose-dev',
  'docker-compose-prod-combined',
  'docker-compose-prod-separated',
  'docker-swarm',
  'render',
  'vercel',
  'railway',
  'fly-io',
  'custom'
]);

export const buildStrategySchema = z.enum([
  'development',
  'build-time',
  'runtime'
]);

export const environmentSchema = z.enum([
  'development',
  'staging',
  'production',
  'preview'
]);

export const sourceTypeSchema = z.enum([
  'github',
  'gitlab',
  'git',
  'upload',
  'docker-image',
  'custom'
]);

export const gitProviderSchema = z.enum([
  'github',
  'gitlab',
  'bitbucket',
  'git'
]);

export const serviceTypeSchema = z.enum([
  'web',
  'api',
  'worker',
  'database',
  'cache',
  'queue',
  'static'
]);

export const deploymentStatusSchema = z.enum([
  'pending',
  'queued',
  'building',
  'deploying',
  'success',
  'failed',
  'cancelled'
]);

// Resource limits schema
export const resourceLimitsSchema = z.object({
  memory: z.string().optional(),
  cpu: z.string().optional(),
  storage: z.string().optional(),
  replicas: z.number().int().positive().optional()
});

// Health check configuration schema
export const healthCheckConfigSchema = z.object({
  enabled: z.boolean(),
  path: z.string(),
  intervalSeconds: z.number().int().positive(),
  timeoutSeconds: z.number().int().positive(),
  startPeriodSeconds: z.number().int().positive(),
  retries: z.number().int().positive()
});

// Source configuration schema
export const sourceConfigSchema = z.object({
  type: sourceTypeSchema,
  
  // Git-based sources
  repositoryUrl: z.string().url().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  gitProvider: gitProviderSchema.optional(),
  accessToken: z.string().optional(),
  
  // Upload sources
  fileName: z.string().optional(),
  fileSize: z.number().int().positive().optional(),
  uploadPath: z.string().optional(),
  
  // Docker image sources
  imageName: z.string().optional(),
  imageTag: z.string().optional(),
  registryUrl: z.string().url().optional(),
  registryCredentials: z.object({
    username: z.string(),
    password: z.string()
  }).optional(),
  
  // Custom sources
  customData: z.record(z.string(), z.unknown()).optional()
});

// Build configuration schema
export const buildConfigSchema = z.object({
  dockerfilePath: z.string(),
  buildContext: z.string(),
  buildArgs: z.record(z.string(), z.string()).optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  workingDirectory: z.string().optional()
});

// Environment variable schema
export const environmentVariableSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  isSecret: z.boolean(),
  description: z.string().optional()
});

// Network configuration schema
export const networkConfigSchema = z.object({
  ports: z.array(z.number().int().min(1).max(65535)),
  subdomain: z.string().optional(),
  customDomain: z.string().optional(),
  internalOnly: z.boolean(),
  allowedOrigins: z.array(z.string()).optional()
});

// Preview configuration schema
export const previewConfigSchema = z.object({
  enabled: z.boolean(),
  baseDomain: z.string(),
  subdomain: z.string().optional(),
  customDomain: z.string().optional(),
  shareEnvVars: z.boolean(),
  autoDelete: z.boolean(),
  retentionDays: z.number().int().positive().optional()
});

// Service dependency schema
export const serviceDependencySchema = z.object({
  serviceId: z.string().uuid(),
  dependsOn: z.array(z.string().uuid()),
  deploymentOrder: z.number().int().positive(),
  healthCheckDependency: z.boolean()
});

// Main deployment configuration schema
export const deploymentConfigSchema = z.object({
  // Core identification
  deploymentId: z.string().uuid().optional(),
  serviceId: z.string().uuid(),
  projectId: z.string().uuid(),
  
  // Environment and provider
  environment: environmentSchema,
  provider: deploymentProviderSchema,
  buildStrategy: buildStrategySchema,
  
  // Source and build
  sourceType: sourceTypeSchema,
  sourceConfig: sourceConfigSchema,
  buildConfig: buildConfigSchema,
  
  // Resources and scaling
  resourceLimits: resourceLimitsSchema,
  healthCheck: healthCheckConfigSchema,
  
  // Network and domains
  networkConfig: networkConfigSchema,
  
  // Environment variables
  environmentVariables: z.array(environmentVariableSchema),
  
  // Preview configuration (optional)
  previewConfig: previewConfigSchema.optional(),
  
  // Dependencies
  dependencies: z.array(serviceDependencySchema),
  
  // Metadata
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  createdBy: z.string().optional()
});

// Deployment result schema
export const deploymentResultSchema = z.object({
  deploymentId: z.string().uuid(),
  status: deploymentStatusSchema,
  message: z.string(),
  
  // Container information
  containerId: z.string().optional(),
  imageId: z.string().optional(),
  
  // Network information
  url: z.string().url().optional(),
  internalUrl: z.string().url().optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
  
  // Build information
  buildLogs: z.array(z.string()).optional(),
  buildDuration: z.number().int().positive().optional(),
  
  // Health check results
  healthStatus: z.enum(['healthy', 'unhealthy', 'starting']).optional(),
  lastHealthCheck: z.date().optional(),
  
  // Timestamps
  startedAt: z.date(),
  completedAt: z.date().optional(),
  
  // Metadata
  deployedBy: z.string(),
  deploymentSize: z.number().int().positive().optional(),
  resourceUsage: z.object({
    cpu: z.string(),
    memory: z.string(),
    storage: z.string()
  }).optional()
});

// Simplified schemas for common API operations
export const createDeploymentInputSchema = z.object({
  serviceId: z.string().uuid(),
  environment: environmentSchema,
  sourceType: sourceTypeSchema,
  sourceConfig: sourceConfigSchema,
  buildConfig: buildConfigSchema.optional(),
  environmentVariables: z.array(environmentVariableSchema).optional(),
  previewConfig: previewConfigSchema.optional()
});

export const updateDeploymentConfigInputSchema = z.object({
  deploymentId: z.string().uuid(),
  buildConfig: buildConfigSchema.optional(),
  environmentVariables: z.array(environmentVariableSchema).optional(),
  resourceLimits: resourceLimitsSchema.optional(),
  healthCheck: healthCheckConfigSchema.optional()
});

export const deploymentSummarySchema = z.object({
  deploymentId: z.string().uuid(),
  serviceId: z.string().uuid(),
  environment: environmentSchema,
  status: deploymentStatusSchema,
  sourceType: sourceTypeSchema,
  url: z.string().url().optional(),
  createdAt: z.date(),
  deployedBy: z.string()
});