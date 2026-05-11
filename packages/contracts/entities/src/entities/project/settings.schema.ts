import z from 'zod/v4'
import {
  projectDeploymentStrategySchema,
} from '@repo/contracts-common'

export const projectBaseEnvironmentSettingsSchema = z.object({
  variables: z.record(z.string(), z.string()),
  autoDeployEnabled: z.boolean(),
  deploymentStrategy: z.enum(['rolling', 'canary', 'blue-green', 'manual']),
  healthGate: z.enum(['strict', 'warn', 'ignore']),
  startupMode: z.enum(['before', 'parallel', 'after']),
  replicas: z.object({
    min: z.int().min(0),
    max: z.int().min(0),
  }),
  trafficPolicy: z.object({
    maxErrorRatePercent: z.number().min(0),
    maxLatencyMs: z.number().min(0),
    allowCrossRegionFailover: z.boolean(),
  }),
})

export const projectPreviewEnvironmentSettingsSchema = projectBaseEnvironmentSettingsSchema
export const projectDevelopmentEnvironmentSettingsSchema = projectBaseEnvironmentSettingsSchema

export const projectEnvironmentSettingsByNameSchema = z
  .object({
    production: projectBaseEnvironmentSettingsSchema,
    preview: projectPreviewEnvironmentSettingsSchema.optional(),
    development: projectDevelopmentEnvironmentSettingsSchema.optional(),
  })
  .catchall(projectBaseEnvironmentSettingsSchema)

export const projectGeneralSettingsSchema = z
  .object({
    defaultBranch: z.string().min(1),
    autoDeployEnabled: z.boolean(),
    enablePreviewEnvironments: z.boolean(),
  })
  .strict()

export const projectEnvironmentSettingsSchema = z
  .object({
    previewEnabled: z.boolean().default(false),
    developmentEnabled: z.boolean().default(false),
    defaultEnvironmentVariables: z.record(z.string(), z.string()).default({}),
    environments: projectEnvironmentSettingsByNameSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const envNames = Object.keys(value.environments)

    if (!envNames.includes('production')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['environments'],
        message: 'Project settings must include production environment configuration.',
      })
    }

    if (value.previewEnabled !== envNames.includes('preview')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previewEnabled'],
        message: 'previewEnabled must reflect whether preview configuration exists.',
      })
    }

    if (value.developmentEnabled !== envNames.includes('development')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['developmentEnabled'],
        message: 'developmentEnabled must reflect whether development configuration exists.',
      })
    }
  })

export const projectDeploymentSettingsSchema = z
  .object({
    autoCleanupDays: z.int().min(1).max(365),
    maxPreviewEnvironments: z.int().min(1).max(50),
    deploymentStrategy: projectDeploymentStrategySchema,
    healthCheckTimeout: z.number().min(5).max(600),
    deploymentTimeout: z.number().min(60).max(3600),
    enableRollback: z.boolean(),
    requireApprovalForProduction: z.boolean(),
  })
  .strict()

export const projectSecuritySettingsSchema = z
  .object({
    webhookSecret: z.string().optional(),
    enableHttpsRedirect: z.boolean(),
    allowedDomains: z.array(z.string()).default([]),
    ipWhitelist: z.array(z.string()).default([]),
    enableBasicAuth: z.boolean(),
    basicAuthUsername: z.string().optional(),
    basicAuthPassword: z.string().optional(),
  })
  .strict()

export const projectResourceSettingsSchema = z
  .object({
    defaultCpuLimit: z.string().min(1),
    defaultMemoryLimit: z.string().min(1),
    defaultStorageLimit: z.string().min(1),
    maxServicesPerProject: z.int().min(1).max(100),
  })
  .strict()

export const projectNotificationSettingsSchema = z
  .object({
    enableEmailNotifications: z.boolean(),
    enableSlackNotifications: z.boolean(),
    slackWebhookUrl: z.string().optional(),
    emailRecipients: z.array(z.email()).default([]),
    notifyOnDeploymentSuccess: z.boolean(),
    notifyOnDeploymentFailure: z.boolean(),
    notifyOnServiceDown: z.boolean(),
  })
  .strict()

export const projectSettingsSchema = z
  .object({
    general: projectGeneralSettingsSchema,
    environment: projectEnvironmentSettingsSchema,
    deployment: projectDeploymentSettingsSchema,
    security: projectSecuritySettingsSchema,
    resource: projectResourceSettingsSchema,
    notification: projectNotificationSettingsSchema,
  })
  .strict()

export type ProjectSettings = z.infer<typeof projectSettingsSchema>

export const projectGeneralConfigSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    baseDomain: z.string().optional(),
    ...projectGeneralSettingsSchema.shape,
  })
  .strict()

export const projectEnvironmentConfigSchema = projectEnvironmentSettingsSchema

export const projectDeploymentConfigSchema = projectDeploymentSettingsSchema

export const projectSecurityConfigSchema = projectSecuritySettingsSchema

export const projectResourceConfigSchema = projectResourceSettingsSchema

export const projectNotificationConfigSchema = projectNotificationSettingsSchema
