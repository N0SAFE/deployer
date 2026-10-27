import z from 'zod/v4'
import { templateConfigSchema } from './config.schema'
import { templateValidationIssueSchema } from './validation.schema'
import {
  templateKindSchema,
  templateVersionSchema,
} from './vocabulary.schema'

export const templateMigrationDirectionSchema = z.enum(['up', 'down'])
export type TemplateMigrationDirection = z.infer<typeof templateMigrationDirectionSchema>

export const templateMigrationOperationSchema = z.object({
  op: z.enum(['set', 'unset', 'rename', 'move', 'merge', 'split']),
  fromPath: z.string().optional(),
  toPath: z.string().optional(),
  value: z.unknown().optional(),
  description: z.string().optional(),
})
export type TemplateMigrationOperation = z.infer<typeof templateMigrationOperationSchema>

export const templateVersionTransformSchema = z.object({
  id: z.string().min(1),
  kind: templateKindSchema.optional(),
  fromVersion: templateVersionSchema,
  toVersion: templateVersionSchema,
  direction: templateMigrationDirectionSchema,
  title: z.string().min(1),
  operations: z.array(templateMigrationOperationSchema).default([]),
  introducesBreakingChange: z.boolean().default(false),
})
export type TemplateVersionTransform = z.infer<typeof templateVersionTransformSchema>

export const templateMigrationSafetyCheckSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['error', 'warning', 'info']),
  status: z.enum(['pass', 'fail', 'skip']),
  title: z.string().min(1),
  message: z.string().min(1),
  remediation: z.string().optional(),
})
export type TemplateMigrationSafetyCheck = z.infer<typeof templateMigrationSafetyCheckSchema>

const templateVersionMigrationBaseInputSchema = z.object({
  templateId: z.uuid(),
  kind: templateKindSchema,
  direction: templateMigrationDirectionSchema,
  sourceVersion: templateVersionSchema,
  targetVersion: templateVersionSchema,
  sourceConfig: templateConfigSchema,
  strict: z.boolean().default(true),
})

export const templateVersionMigrationPreviewInputSchema = templateVersionMigrationBaseInputSchema
export type TemplateVersionMigrationPreviewInput = z.infer<typeof templateVersionMigrationPreviewInputSchema>

export const templateVersionMigrationPreviewResultSchema = z.object({
  canMigrate: z.boolean(),
  selectedTransform: templateVersionTransformSchema.optional(),
  safetyChecks: z.array(templateMigrationSafetyCheckSchema).default([]),
  issues: z.array(templateValidationIssueSchema).default([]),
  migratedConfig: templateConfigSchema.optional(),
})
export type TemplateVersionMigrationPreviewResult = z.infer<typeof templateVersionMigrationPreviewResultSchema>

export const templateVersionMigrationApplyInputSchema = templateVersionMigrationBaseInputSchema.extend({
  expectedCurrentVersion: templateVersionSchema.optional(),
  dryRun: z.boolean().default(false),
})
export type TemplateVersionMigrationApplyInput = z.infer<typeof templateVersionMigrationApplyInputSchema>

export const templateVersionMigrationApplyResultSchema = z.object({
  applied: z.boolean(),
  dryRun: z.boolean(),
  templateId: z.uuid(),
  previousVersion: templateVersionSchema,
  nextVersion: templateVersionSchema,
  selectedTransform: templateVersionTransformSchema.optional(),
  safetyChecks: z.array(templateMigrationSafetyCheckSchema).default([]),
  issues: z.array(templateValidationIssueSchema).default([]),
  migratedConfig: templateConfigSchema.optional(),
})
export type TemplateVersionMigrationApplyResult = z.infer<typeof templateVersionMigrationApplyResultSchema>

export const templateVersionMigrationListInputSchema = z.object({
  kind: templateKindSchema.optional(),
  direction: templateMigrationDirectionSchema.optional(),
  fromVersion: templateVersionSchema.optional(),
  toVersion: templateVersionSchema.optional(),
})
export type TemplateVersionMigrationListInput = z.infer<typeof templateVersionMigrationListInputSchema>

export const templateVersionMigrationListResultSchema = z.object({
  transforms: z.array(templateVersionTransformSchema),
})
export type TemplateVersionMigrationListResult = z.infer<typeof templateVersionMigrationListResultSchema>
