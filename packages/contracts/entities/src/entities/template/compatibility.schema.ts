import z from 'zod/v4'
import {
  builderIdSchema,
  deployStrategySchema,
  providerIdSchema,
  templateEnvironmentSchema,
} from './config.schema'

export const templateCompatibilityMatrixItemSchema = z.object({
  provider: providerIdSchema,
  buildStrategy: builderIdSchema,
  deployStrategy: deployStrategySchema,
  environments: z.array(templateEnvironmentSchema).min(1),
  supported: z.boolean(),
  reasons: z.array(z.string()).default([]),
})
export type TemplateCompatibilityMatrixItem = z.infer<typeof templateCompatibilityMatrixItemSchema>

export const templateCompatibilityMatrixSchema = z.object({
  generatedAt: z.date(),
  matrix: z.array(templateCompatibilityMatrixItemSchema),
})
export type TemplateCompatibilityMatrix = z.infer<typeof templateCompatibilityMatrixSchema>

export const templateCompatibilityValidationInputSchema = z.object({
  provider: providerIdSchema,
  buildStrategy: builderIdSchema,
  deployStrategy: deployStrategySchema,
  environment: templateEnvironmentSchema,
  templateIds: z
    .object({
      providerTemplateId: z.uuid().optional(),
      buildTemplateId: z.uuid().optional(),
      deployTemplateId: z.uuid().optional(),
      routeTemplateId: z.uuid().optional(),
      previewTemplateId: z.uuid().optional(),
      dependencyTemplateId: z.uuid().optional(),
    })
    .optional(),
})
export type TemplateCompatibilityValidationInput = z.infer<typeof templateCompatibilityValidationInputSchema>

export const templateCompatibilityValidationResultSchema = z.object({
  compatible: z.boolean(),
  reasons: z.array(z.string()).default([]),
  evaluated: z.object({
    provider: providerIdSchema,
    buildStrategy: builderIdSchema,
    deployStrategy: deployStrategySchema,
    environment: templateEnvironmentSchema,
  }),
})
export type TemplateCompatibilityValidationResult = z.infer<typeof templateCompatibilityValidationResultSchema>
