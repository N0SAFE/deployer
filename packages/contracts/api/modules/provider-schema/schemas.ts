import { z } from 'zod';

/**
 * Configuration schema field definition
 */
export const configSchemaFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  schema: z.any(), // ZodType is not serializable, will be handled separately
  type: z.enum(['text', 'number', 'boolean', 'select', 'textarea', 'password', 'url', 'json', 'array']),
  required: z.boolean(),
  defaultValue: z.any().optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })).optional(),
  placeholder: z.string().optional(),
  group: z.string().optional(),
  conditional: z.object({
    field: z.string(),
    value: z.any(),
    operator: z.enum(['equals', 'notEquals', 'in', 'notIn']).optional(),
  }).optional(),
  ui: z.object({
    order: z.number().optional(),
    fullWidth: z.boolean().optional(),
    inline: z.boolean().optional(),
    icon: z.string().optional(),
  }).optional(),
});

/**
 * Complete configuration schema
 */
export const configSchemaSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  fields: z.array(configSchemaFieldSchema),
});

/**
 * Provider metadata
 */
export const providerMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  category: z.enum(['git', 'registry', 'storage', 'manual', 'other']),
  supportedBuilders: z.array(z.string()),
  tags: z.array(z.string()),
});

/**
 * Builder metadata
 */
export const builderMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  category: z.enum(['container', 'static', 'serverless', 'other']),
  compatibleProviders: z.array(z.string()),
  tags: z.array(z.string()),
});

/**
 * Validation result
 */
export const providerConfigValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
});
