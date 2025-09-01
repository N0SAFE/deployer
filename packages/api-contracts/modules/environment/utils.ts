import { oc } from '@orpc/contract';
import { z } from 'zod';
import { deploymentEnvironmentSchema } from './schemas';

// Environment status schemas
export const serviceStatusSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['running', 'stopped', 'error', 'deploying']),
  url: z.string().url().optional(),
  healthCheck: z.object({
    status: z.enum(['healthy', 'unhealthy', 'unknown']),
    lastChecked: z.date(),
    responseTime: z.number().optional(),
  }).optional(),
  metrics: z.object({
    cpu: z.number().optional(),
    memory: z.number().optional(),
    requests: z.number().optional(),
  }).optional(),
});

export const environmentStatusSchema = z.object({
  environmentId: z.string().uuid(),
  status: z.enum(['healthy', 'unhealthy', 'deploying', 'failed', 'unknown']),
  deploymentCount: z.number(),
  lastDeployment: z.object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
    branch: z.string().optional(),
    commit: z.string().optional(),
    createdAt: z.date(),
    completedAt: z.date().optional(),
  }).optional(),
  services: z.array(serviceStatusSchema).default([]),
  variableResolutionHealth: z.object({
    totalVariables: z.number(),
    resolvedVariables: z.number(),
    failedVariables: z.number(),
    lastCheck: z.date(),
    errors: z.array(z.object({
      variable: z.string(),
      error: z.string(),
    })).default([]),
  }),
  metrics: z.object({
    uptime: z.number().optional(), // percentage
    avgResponseTime: z.number().optional(), // ms
    errorRate: z.number().optional(), // percentage
  }).optional(),
});

// Update Status
export const environmentUpdateStatusInput = z.object({
  environmentId: z.string().uuid(),
  status: environmentStatusSchema,
  metadata: z.record(z.string(), z.any()).optional(),
});

export const environmentUpdateStatusOutput = z.object({
  success: z.boolean(),
  data: deploymentEnvironmentSchema,
});

export const environmentUpdateStatusContract = oc
  .route({
    method: "PATCH",
    path: "/:environmentId/status",
    summary: "Update environment status",
  })
  .input(environmentUpdateStatusInput)
  .output(environmentUpdateStatusOutput);

// Validate Environment
export const environmentValidateInput = z.object({
  id: z.string().uuid(),
});

export const environmentValidateOutput = z.object({
  isValid: z.boolean(),
  errors: z.array(z.object({
    category: z.enum(['variables', 'deployment', 'security', 'networking']),
    field: z.string().optional(),
    message: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    suggestion: z.string().optional(),
  })),
  warnings: z.array(z.object({
    category: z.string(),
    message: z.string(),
    suggestion: z.string().optional(),
  })),
});

export const environmentValidateContract = oc
  .route({
    method: "POST",
    path: "/:id/validate",
    summary: "Validate environment configuration and variables",
  })
  .input(environmentValidateInput)
  .output(environmentValidateOutput);

// Compare Environments
export const environmentCompareInput = z.object({
  sourceEnvironmentId: z.string().uuid(),
  targetEnvironmentId: z.string().uuid(),
  includeVariables: z.boolean().default(true),
  includeDeploymentConfig: z.boolean().default(true),
});

export const environmentCompareOutput = z.object({
  differences: z.array(z.object({
    category: z.enum(['variables', 'deployment', 'general']),
    field: z.string(),
    sourceValue: z.any(),
    targetValue: z.any(),
    type: z.enum(['added', 'removed', 'modified']),
  })),
  summary: z.object({
    totalDifferences: z.number(),
    variableDifferences: z.number(),
    deploymentDifferences: z.number(),
    generalDifferences: z.number(),
  }),
});

export const environmentCompareContract = oc
  .route({
    method: "POST",
    path: "/compare",
    summary: "Compare configurations between environments",
  })
  .input(environmentCompareInput)
  .output(environmentCompareOutput);

// Bulk Delete
export const environmentBulkDeleteInput = z.object({
  environmentIds: z.array(z.string().uuid()),
});

export const environmentBulkDeleteOutput = z.object({
  success: z.boolean(),
  data: z.object({
    deletedCount: z.number(),
    requestedCount: z.number(),
  }),
});

export const environmentBulkDeleteContract = oc
  .route({
    method: "DELETE",
    path: "/bulk",
    summary: "Delete multiple environments",
  })
  .input(environmentBulkDeleteInput)
  .output(environmentBulkDeleteOutput);