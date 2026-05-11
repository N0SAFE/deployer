import z from 'zod/v4'
import {
  builderIdSchema,
  deployStrategySchema,
  providerIdSchema,
  templateEnvironmentSchema,
} from './config.schema'
import {
  templateCompatibilityValidationResultSchema,
} from './compatibility.schema'
import {
  buildTemplateCreateSchema,
  dependencyTemplateCreateSchema,
  deployTemplateCreateSchema,
  previewTemplateCreateSchema,
  providerTemplateCreateSchema,
  routeTemplateCreateSchema,
  templateCreateInputSchema,
} from './templates.schema'
import { templateKindSchema } from './vocabulary.schema'

export const templateValidationIssueSeveritySchema = z.enum(['error', 'warning', 'info'])
export type TemplateValidationIssueSeverity = z.infer<typeof templateValidationIssueSeveritySchema>

export const templateValidationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: templateValidationIssueSeveritySchema,
  path: z.array(z.union([z.string(), z.number()])).default([]),
  kind: templateKindSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type TemplateValidationIssue = z.infer<typeof templateValidationIssueSchema>

export const templateSemanticValidationContextSchema = z.object({
  provider: providerIdSchema.optional(),
  buildStrategy: builderIdSchema.optional(),
  deployStrategy: deployStrategySchema.optional(),
  environment: templateEnvironmentSchema.optional(),
  strict: z.boolean().default(true),
})
export type TemplateSemanticValidationContext = z.infer<typeof templateSemanticValidationContextSchema>

export const templateValidationInputSchema = z.object({
  template: z.lazy(() => templateCreateInputSchema),
  context: templateSemanticValidationContextSchema.optional(),
})
export type TemplateValidationInput = z.infer<typeof templateValidationInputSchema>

export const templateValidationResultSchema = z.object({
  valid: z.boolean(),
  structuralValid: z.boolean(),
  semanticValid: z.boolean(),
  issues: z.array(templateValidationIssueSchema).default([]),
  normalizedTemplate: z.lazy(() => templateCreateInputSchema).optional(),
})
export type TemplateValidationResult = z.infer<typeof templateValidationResultSchema>

export const templateSetValidationInputSchema = z.object({
  templates: z
    .object({
      provider: z.lazy(() => providerTemplateCreateSchema).optional(),
      build: z.lazy(() => buildTemplateCreateSchema).optional(),
      deploy: z.lazy(() => deployTemplateCreateSchema).optional(),
      route: z.lazy(() => routeTemplateCreateSchema).optional(),
      preview: z.lazy(() => previewTemplateCreateSchema).optional(),
      dependency: z.lazy(() => dependencyTemplateCreateSchema).optional(),
    })
    .partial(),
  context: templateSemanticValidationContextSchema.optional(),
})
export type TemplateSetValidationInput = z.infer<typeof templateSetValidationInputSchema>

export const templateSetValidationResultSchema = z.object({
  valid: z.boolean(),
  issues: z.array(templateValidationIssueSchema).default([]),
  compatibility: templateCompatibilityValidationResultSchema.optional(),
  byKind: z.object({
    provider: templateValidationResultSchema.optional(),
    build: templateValidationResultSchema.optional(),
    deploy: templateValidationResultSchema.optional(),
    route: templateValidationResultSchema.optional(),
    preview: templateValidationResultSchema.optional(),
    dependency: templateValidationResultSchema.optional(),
  }),
})
export type TemplateSetValidationResult = z.infer<typeof templateSetValidationResultSchema>
