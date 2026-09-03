import z from 'zod'
import {
  projectEnvironmentDeploymentStrategySchema,
  projectEnvironmentHealthGateSchema,
  projectEnvironmentStartupModeSchema,
} from '@repo/contracts-common'

export const projectBaseEnvironmentConfigSchema = z.object({
  variables: z.record(z.string(), z.string()),
  autoDeployEnabled: z.boolean(),
  deploymentStrategy: projectEnvironmentDeploymentStrategySchema,
  healthGate: projectEnvironmentHealthGateSchema,
  startupMode: projectEnvironmentStartupModeSchema,
  replicas: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  trafficPolicy: z.object({
    maxErrorRatePercent: z.number(),
    maxLatencyMs: z.number().nonnegative(),
    allowCrossRegionFailover: z.boolean(),
  }),
  /**
   * Compose-profile style environment gating: optional services (mocks,
   * debug tools) declare a profile and only participate in an environment
   * whose `profiles` list includes it. Prod keeps `[]` → mocks absent.
   */
  profiles: z.array(z.string()).default([]),
  /** TTL for auto-created preview infrastructure (Railway/GitLab auto_stop_in). */
  previewTtlHours: z.number().int().positive().default(72),
  /** Whether previews of this environment auto-destroy when their PR closes/merges. */
  destroyOnMerge: z.boolean().default(true),
})
export type ProjectBaseEnvironmentConfig = z.infer<typeof projectBaseEnvironmentConfigSchema>

export const projectPreviewEnvironmentConfigSchema = projectBaseEnvironmentConfigSchema
export type ProjectPreviewEnvironmentConfig = z.infer<typeof projectPreviewEnvironmentConfigSchema>

export const projectDevelopmentEnvironmentConfigSchema = projectBaseEnvironmentConfigSchema
export type ProjectDevelopmentEnvironmentConfig = z.infer<typeof projectDevelopmentEnvironmentConfigSchema>

export const projectEnvironmentConfigSchema = projectBaseEnvironmentConfigSchema
export type ProjectEnvironmentConfig = z.infer<typeof projectEnvironmentConfigSchema>

export const projectEnvironmentConfigByNameSchema = z
  .object({
    production: projectBaseEnvironmentConfigSchema,
    preview: projectPreviewEnvironmentConfigSchema.optional(),
    development: projectDevelopmentEnvironmentConfigSchema.optional(),
  })
  .catchall(projectBaseEnvironmentConfigSchema)
export type ProjectEnvironmentConfigByName = z.infer<typeof projectEnvironmentConfigByNameSchema>

export const projectEnvironmentConfigOverrideSchema = z.object({
  variables: z.record(z.string(), z.string()).optional(),
  autoDeployEnabled: z.boolean().optional(),
  deploymentStrategy: projectEnvironmentDeploymentStrategySchema.optional(),
  healthGate: projectEnvironmentHealthGateSchema.optional(),
  startupMode: projectEnvironmentStartupModeSchema.optional(),
  replicas: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .optional(),
  trafficPolicy: z
    .object({
      maxErrorRatePercent: z.number().optional(),
      maxLatencyMs: z.number().nonnegative().optional(),
      allowCrossRegionFailover: z.boolean().optional(),
    })
    .optional(),
  profiles: z.array(z.string()).optional(),
  previewTtlHours: z.number().int().positive().optional(),
  destroyOnMerge: z.boolean().optional(),
})
export type ProjectEnvironmentConfigOverride = z.infer<typeof projectEnvironmentConfigOverrideSchema>

export const projectDerivedEnvironmentConfigSchema = z.object({
  extends: z.enum(['production', 'staging']),
  overrides: projectEnvironmentConfigOverrideSchema.default({}),
})
export type ProjectDerivedEnvironmentConfig = z.infer<typeof projectDerivedEnvironmentConfigSchema>

export const projectEnvironmentExtensionConfigSchema = z.object({
  preview: projectDerivedEnvironmentConfigSchema.optional(),
  development: projectDerivedEnvironmentConfigSchema.optional(),
})
export type ProjectEnvironmentExtensionConfig = z.infer<typeof projectEnvironmentExtensionConfigSchema>
