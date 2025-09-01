import { z } from 'zod';
// Import shared schemas
import { 
  environmentTypeSchema as sharedEnvironmentTypeSchema,
  environmentVariableSchema as sharedEnvironmentVariableSchema,
  dynamicVariableSchema as sharedDynamicVariableSchema,
  variableDefinitionSchema as sharedVariableDefinitionSchema,
  createVariableTemplateSchema as sharedCreateVariableTemplateSchema,
  updateVariableTemplateSchema as sharedUpdateVariableTemplateSchema,
} from '../../shared';

// Re-export shared schemas for backward compatibility (primary export point)
export const environmentTypeSchema = sharedEnvironmentTypeSchema;
export const environmentVariableSchema = sharedEnvironmentVariableSchema;

// Variable template validation schemas
export const variableValidationRuleSchema = z.object({
  type: z.enum(['regex', 'url', 'email', 'number', 'boolean', 'enum']),
  value: z.string(), // regex pattern, enum values (comma-separated), etc.
  message: z.string().optional(),
});

// Enhanced dynamic variable schema using new variable resolver
export const dynamicVariableSchema = sharedDynamicVariableSchema.extend({
  resolvedValue: z.string().optional(),
  references: z.array(z.any()).default([]), // Will be properly typed when variable-resolver is imported
  lastResolved: z.date().optional(),
  resolutionStatus: z.enum(['pending', 'resolved', 'failed']).default('pending'),
  resolutionError: z.string().optional(),
});

// Extended variable definition schema for environments
export const variableDefinitionSchema = sharedVariableDefinitionSchema.extend({
  validation: z.array(variableValidationRuleSchema).default([]),
  category: z.string().optional(), // for grouping in UI
});

// Enhanced variable template schemas
export const updateVariableTemplateSchema = sharedUpdateVariableTemplateSchema.extend({
  template: z.string().optional(),
  variables: z.array(dynamicVariableSchema).default([]).optional(),
  variableDefinitions: z.array(variableDefinitionSchema).default([]).optional(),
});

export const createVariableTemplateSchema = sharedCreateVariableTemplateSchema.extend({
  template: z.string(),
  variables: z.array(dynamicVariableSchema).default([]),
  variableDefinitions: z.array(variableDefinitionSchema).default([]),
});

// Extended environment variable schema with database fields
export const environmentVariableExtendedSchema = z.object({
  id: z.string().uuid(),
  environmentId: z.string().uuid(),
  key: z.string(),
  value: z.string(),
  isSecret: z.boolean(),
  description: z.string().optional(),
  category: z.string().optional(),
  isDynamic: z.boolean(),
  template: z.string().optional(),
  resolutionStatus: z.enum(['pending', 'resolved', 'failed']),
  resolvedValue: z.string().optional(),
  resolutionError: z.string().optional(),
  lastResolved: z.date().optional(),
  references: z.array(z.string()).default([]),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Environment deployment configuration
export const deploymentConfigSchema = z.object({
  strategy: z.enum(['rolling', 'blue_green', 'canary']).default('rolling'),
  healthCheckPath: z.string().default('/health'),
  healthCheckTimeout: z.number().min(1).max(300).default(30),
  deploymentTimeout: z.number().min(60).max(3600).default(600),
  replicas: z.number().min(1).max(100).default(1),
  resources: z.object({
    cpu: z.string().default('0.5'),
    memory: z.string().default('512MB'),
    storage: z.string().optional(),
  }),
  scaling: z.object({
    enabled: z.boolean().default(false),
    minReplicas: z.number().min(1).default(1),
    maxReplicas: z.number().min(1).default(10),
    targetCPU: z.number().min(1).max(100).default(70),
    targetMemory: z.number().min(1).max(100).default(80),
  }).optional(),
});

// Enhanced environment schema
export const deploymentEnvironmentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: environmentTypeSchema,
  url: z.string().url().optional(),
  branch: z.string().optional(), // for preview environments
  isActive: z.boolean().default(true),
  autoDeloy: z.boolean().default(false),
  variables: z.array(environmentVariableSchema).default([]),
  dynamicVariables: z.array(dynamicVariableSchema).default([]),
  deploymentConfig: deploymentConfigSchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).default([]),
  protectionRules: z.object({
    requireApproval: z.boolean().default(false),
    approvers: z.array(z.string().uuid()).default([]),
    allowedBranches: z.array(z.string()).default([]),
    requireStatusChecks: z.boolean().default(false),
  }).optional(),
  createdBy: z.string().uuid().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create/update schemas
export const createEnvironmentSchema = z.object({
  name: z.string().min(1).max(100),
  type: environmentTypeSchema,
  url: z.string().url().optional(),
  branch: z.string().optional(),
  autoDeloy: z.boolean().default(false),
  variables: z.array(environmentVariableSchema).default([]),
  dynamicVariables: z.array(dynamicVariableSchema).default([]),
  deploymentConfig: deploymentConfigSchema.optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).default([]),
  protectionRules: z.object({
    requireApproval: z.boolean().default(false),
    approvers: z.array(z.string().uuid()).default([]),
    allowedBranches: z.array(z.string()).default([]),
    requireStatusChecks: z.boolean().default(false),
  }).optional(),
});

export const updateEnvironmentSchema = createEnvironmentSchema.partial();