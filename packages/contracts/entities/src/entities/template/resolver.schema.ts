import z from 'zod/v4'
import {
  providerIdSchema,
  templateConfigSchema,
  templateEnvironmentSchema,
} from './config.schema'
import { templateValidationIssueSchema } from './validation.schema'
import {
  templateKindSchema,
  templateVersionSchema,
} from './vocabulary.schema'

export const templateResolverLayerSchema = z.enum(['global', 'provider', 'project', 'environment', 'run'])
export type TemplateResolverLayer = z.infer<typeof templateResolverLayerSchema>

export const templateResolverContextSchema = z.object({
  provider: providerIdSchema.optional(),
  projectId: z.uuid().optional(),
  environment: templateEnvironmentSchema.optional(),
  runId: z.uuid().optional(),
})
export type TemplateResolverContext = z.infer<typeof templateResolverContextSchema>

export const templateResolverChainInputSchema = z.object({
  globalTemplateId: z.uuid().optional(),
  providerTemplateId: z.uuid().optional(),
  projectTemplateId: z.uuid().optional(),
  environmentTemplateId: z.uuid().optional(),
  runTemplateId: z.uuid().optional(),
  inlineOverrides: z
    .object({
      global: z.record(z.string(), z.unknown()).optional(),
      provider: z.record(z.string(), z.unknown()).optional(),
      project: z.record(z.string(), z.unknown()).optional(),
      environment: z.record(z.string(), z.unknown()).optional(),
      run: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
})
export type TemplateResolverChainInput = z.infer<typeof templateResolverChainInputSchema>

export const templateResolveInputSchema = z.object({
  kind: templateKindSchema,
  context: templateResolverContextSchema.optional(),
  chain: templateResolverChainInputSchema,
  strict: z.boolean().default(true),
})
export type TemplateResolveInput = z.infer<typeof templateResolveInputSchema>

export const templateResolvedLayerTraceSchema = z.object({
  layer: templateResolverLayerSchema,
  applied: z.boolean(),
  source: z.enum(['template', 'inlineOverride', 'default', 'none']),
  templateId: z.uuid().optional(),
  templateVersion: templateVersionSchema.optional(),
  notes: z.array(z.string()).default([]),
})
export type TemplateResolvedLayerTrace = z.infer<typeof templateResolvedLayerTraceSchema>

export const templateResolveResultSchema = z.object({
  resolved: z.boolean(),
  kind: templateKindSchema,
  resolvedConfig: templateConfigSchema.optional(),
  chainTrace: z.array(templateResolvedLayerTraceSchema),
  issues: z.array(templateValidationIssueSchema).default([]),
})
export type TemplateResolveResult = z.infer<typeof templateResolveResultSchema>

export const templateSetResolveInputSchema = z.object({
  context: templateResolverContextSchema.optional(),
  strict: z.boolean().default(true),
  byKind: z
    .object({
      provider: templateResolverChainInputSchema.optional(),
      build: templateResolverChainInputSchema.optional(),
      deploy: templateResolverChainInputSchema.optional(),
      route: templateResolverChainInputSchema.optional(),
      preview: templateResolverChainInputSchema.optional(),
      dependency: templateResolverChainInputSchema.optional(),
    })
    .partial(),
})
export type TemplateSetResolveInput = z.infer<typeof templateSetResolveInputSchema>

export const templateSetResolveResultSchema = z.object({
  resolved: z.boolean(),
  byKind: z.object({
    provider: templateResolveResultSchema.optional(),
    build: templateResolveResultSchema.optional(),
    deploy: templateResolveResultSchema.optional(),
    route: templateResolveResultSchema.optional(),
    preview: templateResolveResultSchema.optional(),
    dependency: templateResolveResultSchema.optional(),
  }),
  issues: z.array(templateValidationIssueSchema).default([]),
})
export type TemplateSetResolveResult = z.infer<typeof templateSetResolveResultSchema>
