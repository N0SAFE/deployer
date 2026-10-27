import z from 'zod/v4'
import {
  buildTemplateConfigSchema,
  dependencyTemplateConfigSchema,
  deployTemplateConfigSchema,
  previewTemplateConfigSchema,
  providerTemplateConfigSchema,
  routeTemplateConfigSchema,
  templateConfigSchema,
} from './config.schema'
import {
  nonEmptyString,
  templateKindSchema,
  templateScopeSchema,
  templateStatusSchema,
  templateVersionSchema,
} from './vocabulary.schema'

export const deploymentTemplateSchema = z.object({
  id: z.uuid(),
  key: nonEmptyString,
  name: nonEmptyString,
  description: z.string().nullable(),
  kind: templateKindSchema,
  scope: templateScopeSchema,
  version: templateVersionSchema,
  status: templateStatusSchema,
  isSystem: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  config: templateConfigSchema,
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type DeploymentTemplate = z.infer<typeof deploymentTemplateSchema>

const templateCreateBaseSchema = z.object({
  key: nonEmptyString,
  name: nonEmptyString,
  description: z.string().optional(),
  scope: templateScopeSchema.default('project'),
  version: templateVersionSchema.default('1.0.0'),
  status: templateStatusSchema.default('draft'),
  isSystem: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const providerTemplateCreateSchema = templateCreateBaseSchema.extend({
  kind: z.literal('provider'),
  config: providerTemplateConfigSchema,
})

export const buildTemplateCreateSchema = templateCreateBaseSchema.extend({
  kind: z.literal('build'),
  config: buildTemplateConfigSchema,
})

export const deployTemplateCreateSchema = templateCreateBaseSchema.extend({
  kind: z.literal('deploy'),
  config: deployTemplateConfigSchema,
})

export const routeTemplateCreateSchema = templateCreateBaseSchema.extend({
  kind: z.literal('route'),
  config: routeTemplateConfigSchema,
})

export const previewTemplateCreateSchema = templateCreateBaseSchema.extend({
  kind: z.literal('preview'),
  config: previewTemplateConfigSchema,
})

export const dependencyTemplateCreateSchema = templateCreateBaseSchema.extend({
  kind: z.literal('dependency'),
  config: dependencyTemplateConfigSchema,
})

export const templateCreateInputSchema = z.discriminatedUnion('kind', [
  providerTemplateCreateSchema,
  buildTemplateCreateSchema,
  deployTemplateCreateSchema,
  routeTemplateCreateSchema,
  previewTemplateCreateSchema,
  dependencyTemplateCreateSchema,
])

export const templateUpdateInputSchema = z.object({
  id: z.uuid(),
  key: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  description: z.string().nullable().optional(),
  scope: templateScopeSchema.optional(),
  version: templateVersionSchema.optional(),
  status: templateStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  config: templateConfigSchema.optional(),
})

export type TemplateCreateInput = z.infer<typeof templateCreateInputSchema>
export type TemplateUpdateInput = z.infer<typeof templateUpdateInputSchema>
