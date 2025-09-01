import { z } from 'zod';

// Variable Reference Types
export const variableReferenceTypeEnum = z.enum([
  'variable',
  'project', 
  'service',
  'environment',
  'external_project',
  'external_service',
  'default'
]);

// Variable Reference Schema
export const variableReferenceSchema = z.object({
  type: variableReferenceTypeEnum,
  identifier: z.string(),
  property: z.string().optional(),
  fullPath: z.string(),
  raw: z.string(),
  isEscaped: z.boolean().default(false),
  isExternal: z.boolean().default(false),
  defaultValue: z.string().optional(),
});

// Parse Result Schema
export const parseResultSchema = z.object({
  isValid: z.boolean(),
  originalValue: z.string(),
  hasReferences: z.boolean(),
  staticParts: z.array(z.string()),
  references: z.array(variableReferenceSchema),
  errors: z.array(z.object({
    type: z.enum(['syntax_error', 'invalid_reference', 'empty_reference']),
    message: z.string(),
    position: z.number(),
    raw: z.string(),
  })),
});

// Legacy alias for backward compatibility
export const variableTemplateParseResultSchema = parseResultSchema;

// Variable Resolution Context Schema
export const variableResolutionContextSchema = z.object({
  projectId: z.string(),
  environmentId: z.string(),
  projects: z.record(z.string(), z.any()).default({}),
  services: z.record(z.string(), z.any()).default({}),
  environments: z.record(z.string(), z.any()).default({}),
  variables: z.record(z.string(), z.string()).default({}),
  externalProjects: z.record(z.string(), z.any()).optional(),
  externalServices: z.record(z.string(), z.any()).optional(),
  defaults: z.record(z.string(), z.string()).optional(),
});

// Resolution Result Schema
export const resolutionResultSchema = z.object({
  success: z.boolean(),
  resolvedValue: z.string(),
  parseResult: parseResultSchema.optional(),
  errors: z.array(z.object({
    type: z.enum(['resolution_error', 'circular_dependency', 'missing_variable']),
    message: z.string(),
    reference: z.string(),
    raw: z.string(),
    error: z.string(), // Legacy alias
  })),
  warnings: z.array(z.object({
    type: z.enum(['deep_nesting_warning', 'potential_circular_reference']),
    message: z.string(),
    reference: z.string(),
    warning: z.string(), // Legacy alias
  })),
  metadata: z.object({
    resolvedReferences: z.number(),
    totalReferences: z.number(),
    resolutionTime: z.number().optional(),
  }).optional(),
});

// Legacy alias for backward compatibility
export const variableResolutionResultSchema = resolutionResultSchema;

// Recursive Resolution Result Schema
export const recursiveResolutionResultSchema = z.object({
  success: z.boolean(),
  resolvedVariables: z.record(z.string(), z.string()),
  errors: z.array(z.object({
    type: z.enum(['resolution_error', 'circular_dependency', 'missing_variable', 'max_depth_exceeded']),
    message: z.string(),
    variable: z.string().optional(),
    reference: z.string().optional(),
  })),
  circularDependencies: z.array(z.array(z.string())),
  metadata: z.object({
    totalVariables: z.number(),
    resolvedVariables: z.number(),
    failedVariables: z.number(),
    resolutionDepth: z.number(),
    resolutionTime: z.number().optional(),
  }),
});

// Validation Result Schema
export const validationResultSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(z.object({
    type: z.enum(['syntax_error', 'invalid_reference', 'empty_reference']),
    message: z.string(),
    position: z.number(),
    raw: z.string(),
  })),
  warnings: z.array(z.object({
    type: z.enum(['deep_nesting_warning', 'potential_circular_reference', 'deprecated_syntax']),
    message: z.string(),
    position: z.number().optional(),
  })),
});

// Template Parsing Input/Output
export const parseTemplateInput = z.object({
  template: z.string(),
  options: z.object({
    strict: z.boolean().default(false),
    allowEscaping: z.boolean().default(true),
    maxReferenceDepth: z.number().default(10),
  }).optional(),
});

export const parseTemplateOutput = parseResultSchema;

// Template Resolution Input/Output
export const resolveTemplateInput = z.object({
  template: z.string(),
  context: variableResolutionContextSchema,
  options: z.object({
    strict: z.boolean().default(false),
    allowEscaping: z.boolean().default(true),
    maxRecursionDepth: z.number().default(10),
    timeout: z.number().default(5000),
  }).optional(),
});

export const resolveTemplateOutput = resolutionResultSchema;

// Recursive Variable Resolution Input/Output
export const resolveVariablesRecursivelyInput = z.object({
  variables: z.record(z.string(), z.string()),
  context: variableResolutionContextSchema,
  options: z.object({
    maxRecursionDepth: z.number().default(10),
    detectCircularDependencies: z.boolean().default(true),
    continueOnError: z.boolean().default(true),
    timeout: z.number().default(10000),
  }).optional(),
});

export const resolveVariablesRecursivelyOutput = recursiveResolutionResultSchema;

// Validation Input/Output
export const validateTemplateInput = z.object({
  template: z.string(),
  context: variableResolutionContextSchema.optional(),
  options: z.object({
    strict: z.boolean().default(false),
    checkCircularDependencies: z.boolean().default(true),
    maxNestingDepth: z.number().default(5),
  }).optional(),
});

export const validateTemplateOutput = validationResultSchema;

// Suggestions Input/Output
export const getSuggestionsInput = z.object({
  partial: z.string(),
  context: variableResolutionContextSchema,
  position: z.number().default(0),
  options: z.object({
    maxSuggestions: z.number().default(20),
    includeDescriptions: z.boolean().default(false),
  }).optional(),
});

export const getSuggestionsOutput = z.object({
  suggestions: z.array(z.object({
    text: z.string(),
    displayText: z.string(),
    description: z.string().optional(),
    type: variableReferenceTypeEnum,
    insertText: z.string().optional(),
  })),
});

// Built-in Defaults
export const builtinDefaultsSchema = z.record(z.string(), z.string()).default({
  'INTERNAL_URL': 'http://localhost',
  'INTERNAL_HOST': 'localhost',
  'INTERNAL_PORT': '3000',
  'INTERNAL_API_PORT': '3001',
  'INTERNAL_DB_PORT': '5432',
  'INTERNAL_REDIS_PORT': '6379',
  'INTERNAL_API_PATH': '/api',
  'INTERNAL_PROTOCOL': 'http',
  'ENVIRONMENT_NAME': 'development',
});

// Reference Extraction Input/Output
export const extractReferencesInput = z.object({
  templates: z.array(z.string()),
  options: z.object({
    includeEscaped: z.boolean().default(false),
    groupByType: z.boolean().default(false),
  }).optional(),
});

export const extractReferencesOutput = z.object({
  references: z.array(variableReferenceSchema),
  byType: z.record(variableReferenceTypeEnum, z.array(variableReferenceSchema)).optional(),
  statistics: z.object({
    totalReferences: z.number(),
    uniqueReferences: z.number(),
    referencesByType: z.record(variableReferenceTypeEnum, z.number()),
  }),
});

// Circular Dependencies Input/Output
export const detectCircularDependenciesInput = z.object({
  variables: z.record(z.string(), z.string()),
  options: z.object({
    maxDepth: z.number().default(100),
    returnPaths: z.boolean().default(true),
  }).optional(),
});

export const detectCircularDependenciesOutput = z.object({
  hasCircularDependencies: z.boolean(),
  cycles: z.array(z.array(z.string())),
  affectedVariables: z.array(z.string()),
});

// Type exports
export type VariableReference = z.infer<typeof variableReferenceSchema>;
export type VariableTemplateParseResult = z.infer<typeof variableTemplateParseResultSchema>;
export type VariableResolutionContext = z.infer<typeof variableResolutionContextSchema>;
export type VariableResolutionResult = z.infer<typeof variableResolutionResultSchema>;