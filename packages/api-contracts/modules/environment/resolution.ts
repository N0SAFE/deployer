import { oc } from '@orpc/contract';
import { z } from 'zod';

// Template parsing endpoint schemas
export const parseTemplateRequestSchema = z.object({
  template: z.string(),
});

export const parseTemplateResponseSchema = z.object({
  parseResult: z.any(), // Will be properly typed when variable-resolver is integrated
  validation: z.object({
    isValid: z.boolean(),
    errors: z.array(z.string()),
  }),
  dependencies: z.object({
    projects: z.array(z.string()),
    services: z.array(z.string()),
    environments: z.array(z.string()),
  }),
  circularDependencies: z.object({
    hasCircularDeps: z.boolean(),
    cycles: z.array(z.array(z.string())),
  }).optional(),
});

// Enhanced variable resolution schemas using new variable resolver
export const resolveVariableRequestSchema = z.object({
  template: z.string(),
  environmentId: z.string().uuid().optional(),
  context: z.any().optional(), // Will be properly typed when variable-resolver is integrated
  validateOnly: z.boolean().default(false), // Only validate syntax, don't resolve
});

export const resolveVariableResponseSchema = z.any().and(z.object({
  parseResult: z.any(), // Will be properly typed when variable-resolver is integrated
  metadata: z.object({
    resolutionTime: z.number(), // ms
    totalReferences: z.number(),
    resolvedReferences: z.number(),
    failedReferences: z.number(),
  }),
}));

// Batch variable resolution schemas
export const batchResolveRequestSchema = z.object({
  templates: z.record(z.string(), z.string()), // key -> template
  context: z.any(), // Will be properly typed when variable-resolver is integrated
  stopOnFirstError: z.boolean().default(false),
});

export const batchResolveResponseSchema = z.object({
  results: z.record(z.string(), z.any()), // Will be properly typed when variable-resolver is integrated
  summary: z.object({
    totalTemplates: z.number(),
    successfulTemplates: z.number(),
    failedTemplates: z.number(),
    totalResolutionTime: z.number(),
  }),
  circularDependencies: z.object({
    hasCircularDeps: z.boolean(),
    cycles: z.array(z.array(z.string())),
  }),
});

// Parse Template
export const environmentParseTemplateInput = parseTemplateRequestSchema;
export const environmentParseTemplateOutput = parseTemplateResponseSchema;

export const environmentParseTemplateContract = oc
  .route({
    method: "POST",
    path: "/parse-template",
    summary: "Parse variable template to extract references and validate syntax",
  })
  .input(environmentParseTemplateInput)
  .output(environmentParseTemplateOutput);

// Resolve Template
export const environmentResolveTemplateInput = resolveVariableRequestSchema;
export const environmentResolveTemplateOutput = resolveVariableResponseSchema;

export const environmentResolveTemplateContract = oc
  .route({
    method: "POST",
    path: "/resolve-template",
    summary: "Resolve variable template with provided context",
  })
  .input(environmentResolveTemplateInput)
  .output(environmentResolveTemplateOutput);

// Batch Resolve Templates
export const environmentBatchResolveTemplatesInput = batchResolveRequestSchema;
export const environmentBatchResolveTemplatesOutput = batchResolveResponseSchema;

export const environmentBatchResolveTemplatesContract = oc
  .route({
    method: "POST",
    path: "/batch-resolve",
    summary: "Resolve multiple variable templates with circular dependency detection",
  })
  .input(environmentBatchResolveTemplatesInput)
  .output(environmentBatchResolveTemplatesOutput);

// Resolve Environment Variables
export const environmentResolveEnvironmentVariablesInput = z.object({
  id: z.string().uuid(),
  includeSecrets: z.boolean().default(false),
  forceRefresh: z.boolean().default(false),
});

export const environmentResolveEnvironmentVariablesOutput = z.object({
  environmentId: z.string().uuid(),
  staticVariables: z.array(z.any()), // Will use proper schemas when imported
  dynamicVariables: z.array(z.object({
    resolutionResult: z.any().optional(), // Will be properly typed
  }).passthrough()),
  summary: z.object({
    totalVariables: z.number(),
    staticVariables: z.number(),
    dynamicVariables: z.number(),
    resolvedDynamicVariables: z.number(),
    failedDynamicVariables: z.number(),
  }),
  resolutionContext: z.any(), // Will be properly typed when variable-resolver is integrated
});

export const environmentResolveEnvironmentVariablesContract = oc
  .route({
    method: "POST",
    path: "/:id/resolve-variables",
    summary: "Resolve all variables for a specific environment with full context",
  })
  .input(environmentResolveEnvironmentVariablesInput)
  .output(environmentResolveEnvironmentVariablesOutput);

// Advanced Variable Resolution
export const environmentResolveVariablesAdvancedInput = z.object({
  id: z.string().uuid(),
}).merge(resolveVariableRequestSchema);

export const environmentResolveVariablesAdvancedOutput = resolveVariableResponseSchema;

export const environmentResolveVariablesAdvancedContract = oc
  .route({
    method: "POST",
    path: "/:id/resolve-variables-advanced",
    summary: "Resolve variables with advanced context and validation",
  })
  .input(environmentResolveVariablesAdvancedInput)
  .output(environmentResolveVariablesAdvancedOutput);

// Get Resolution History
export const environmentGetResolutionHistoryInput = z.object({
  id: z.string().uuid(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

export const environmentGetResolutionHistoryOutput = z.object({
  history: z.array(z.object({
    id: z.string().uuid(),
    timestamp: z.date(),
    template: z.string(),
    resolvedTemplate: z.string(),
    variables: z.array(z.object({
      key: z.string(),
      resolved: z.boolean(),
      error: z.string().optional(),
    })),
    context: z.record(z.string(), z.any()).optional(),
  })),
  total: z.number(),
});

export const environmentGetResolutionHistoryContract = oc
  .route({
    method: "GET",
    path: "/:id/resolution-history",
    summary: "Get variable resolution history for troubleshooting",
  })
  .input(environmentGetResolutionHistoryInput)
  .output(environmentGetResolutionHistoryOutput);