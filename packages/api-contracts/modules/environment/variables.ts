import { oc } from '@orpc/contract';
import { z } from 'zod';
import { environmentVariableExtendedSchema, environmentVariableSchema } from './schemas';

// Get Variables
export const environmentGetVariablesInput = z.object({
  environmentId: z.string().uuid(),
});

export const environmentGetVariablesOutput = z.object({
  success: z.boolean(),
  data: z.array(environmentVariableExtendedSchema),
});

export const environmentGetVariablesContract = oc
  .route({
    method: "GET",
    path: "/:environmentId/variables",
    summary: "Get all variables for an environment",
  })
  .input(environmentGetVariablesInput)
  .output(environmentGetVariablesOutput);

// Update Variables
export const environmentUpdateVariablesInput = z.object({
  environmentId: z.string().uuid(),
  variables: z.array(environmentVariableSchema.extend({
    isDynamic: z.boolean().default(false),
    template: z.string().optional(),
  })),
});

export const environmentUpdateVariablesOutput = z.object({
  success: z.boolean(),
  data: z.array(environmentVariableExtendedSchema),
});

export const environmentUpdateVariablesContract = oc
  .route({
    method: "PUT",
    path: "/:environmentId/variables",
    summary: "Update variables for an environment",
  })
  .input(environmentUpdateVariablesInput)
  .output(environmentUpdateVariablesOutput);

// Resolve Variables
export const environmentResolveVariablesInput = z.object({
  environmentId: z.string().uuid(),
});

export const environmentResolveVariablesOutput = z.object({
  success: z.boolean(),
  data: z.array(environmentVariableExtendedSchema),
});

export const environmentResolveVariablesContract = oc
  .route({
    method: "POST",
    path: "/:environmentId/variables/resolve",
    summary: "Resolve all dynamic variables for an environment",
  })
  .input(environmentResolveVariablesInput)
  .output(environmentResolveVariablesOutput);

// Bulk Update Variables
export const environmentBulkUpdateVariablesInput = z.object({
  id: z.string().uuid(),
  operations: z.array(z.object({
    operation: z.enum(['add', 'update', 'delete']),
    key: z.string(),
    value: z.string().optional(),
    isSecret: z.boolean().optional(),
    description: z.string().optional(),
  })),
});

export const environmentBulkUpdateVariablesOutput = z.object({
  success: z.boolean(),
  results: z.array(z.object({
    key: z.string(),
    operation: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  })),
  summary: z.object({
    total: z.number(),
    successful: z.number(),
    failed: z.number(),
  }),
});

export const environmentBulkUpdateVariablesContract = oc
  .route({
    method: "PUT",
    path: "/:id/variables/bulk",
    summary: "Bulk update environment variables",
  })
  .input(environmentBulkUpdateVariablesInput)
  .output(environmentBulkUpdateVariablesOutput);