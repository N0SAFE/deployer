import z from 'zod/v4'
import {
  builderIdSchema,
  nonEmptyString,
  providerIdSchema,
} from './vocabulary.schema'

const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(0).max(20).default(3),
  backoffMs: z.number().int().min(0).max(600_000).default(2_000),
})

export const providerTemplateConfigSchema = z.object({
  provider: providerIdSchema,
  defaultBranch: z.string().min(1).default('main'),
  webhookEvents: z.array(z.enum(['push', 'pull_request', 'tag', 'release'])).default(['push']),
  supportsPreview: z.boolean().default(true),
  secretRefs: z.array(nonEmptyString).default([]),
})
export type ProviderTemplateConfig = z.infer<typeof providerTemplateConfigSchema>

export const buildTemplateConfigSchema = z.object({
  strategy: z.enum(['dockerfile', 'nixpacks', 'buildpacks', 'custom']),
  contextDir: nonEmptyString.default('.'),
  dockerfilePath: z.string().optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  outputDir: z.string().optional(),
  cacheEnabled: z.boolean().default(true),
  envAllowlist: z.array(nonEmptyString).default([]),
})
export type BuildTemplateConfig = z.infer<typeof buildTemplateConfigSchema>

export const deployTemplateConfigSchema = z.object({
  strategy: z.enum(['recreate', 'rolling', 'blue_green', 'canary']),
  maxUnavailable: z.number().int().min(0).max(100).default(1),
  maxSurge: z.number().int().min(0).max(100).default(1),
  healthCheckPath: z.string().default('/health'),
  healthCheckTimeoutSec: z.number().int().min(1).max(300).default(60),
  deploymentTimeoutSec: z.number().int().min(10).max(7_200).default(600),
  rollbackOnFailure: z.boolean().default(true),
})
export type DeployTemplateConfig = z.infer<typeof deployTemplateConfigSchema>

export const deployStrategySchema = deployTemplateConfigSchema.shape.strategy
export type DeployStrategy = z.infer<typeof deployStrategySchema>

export const templateEnvironmentSchema = z.enum(['development', 'preview', 'staging', 'production'])
export type TemplateEnvironment = z.infer<typeof templateEnvironmentSchema>

export const routeTemplateConfigSchema = z.object({
  hostPattern: nonEmptyString,
  entrypoints: z.array(z.enum(['web', 'websecure'])).default(['websecure']),
  tlsEnabled: z.boolean().default(true),
  tlsResolver: z.string().default('letsencrypt'),
  middlewares: z.array(nonEmptyString).default([]),
  healthProbeEnabled: z.boolean().default(true),
})
export type RouteTemplateConfig = z.infer<typeof routeTemplateConfigSchema>

export const previewTemplateConfigSchema = z.object({
  urlPattern: nonEmptyString,
  namingStrategy: z.enum(['pr', 'branch', 'branch_hash', 'custom']),
  ttlHours: z.number().int().min(1).max(24 * 90).default(168),
  autoDeleteOnMerge: z.boolean().default(true),
  autoDeleteOnClose: z.boolean().default(true),
  envOverlayStrategy: z.enum(['inherit', 'merge', 'replace']).default('merge'),
})
export type PreviewTemplateConfig = z.infer<typeof previewTemplateConfigSchema>

export const dependencyTemplateConfigSchema = z.object({
  orderingStrategy: z.enum(['topological', 'explicit', 'hybrid']).default('topological'),
  rolloutMode: z.enum(['ordered', 'parallel', 'rolling', 'canary']).default('ordered'),
  gateOnDependencyHealth: z.boolean().default(true),
  retryPolicy: retryPolicySchema,
  failureIsolation: z.enum(['service', 'project', 'fleet']).default('service'),
})
export type DependencyTemplateConfig = z.infer<typeof dependencyTemplateConfigSchema>

export const templateConfigSchema = z.union([
  providerTemplateConfigSchema,
  buildTemplateConfigSchema,
  deployTemplateConfigSchema,
  routeTemplateConfigSchema,
  previewTemplateConfigSchema,
  dependencyTemplateConfigSchema,
])
export type TemplateConfig = z.infer<typeof templateConfigSchema>

export {
  builderIdSchema,
  providerIdSchema,
}
