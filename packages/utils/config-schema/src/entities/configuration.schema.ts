import { z } from 'zod'
import { projectEnvironmentDeploymentStrategySchema, projectEnvironmentHealthGateSchema, projectEnvironmentStartupModeSchema } from '../enums/environment.schema'
import { runnerNetworkModeSchema, serviceRunnerStrategySchema } from '../enums/provider-runner.schema'

export const serviceProviderConfigSchema = z.object({
  sourceUrl: z.string(),
  branch: z.string(),
  rootPath: z.string(),
  buildContext: z.string(),
  dockerfilePath: z.string().optional(),
  image: z.string().optional(),
  autoSyncEnabled: z.boolean(),
  webhookEnabled: z.boolean(),
  authSecretRef: z.string(),
})
export type ServiceProviderConfig = z.infer<typeof serviceProviderConfigSchema>

export const serviceRunnerConfigSchema = z.object({
  strategy: serviceRunnerStrategySchema,
  startCommand: z.string(),
  args: z.array(z.string()),
  ports: z.array(z.number().int().positive()),
  volumeMounts: z.array(z.string()),
  secretRefs: z.array(z.string()),
  networkMode: runnerNetworkModeSchema,
  gracefulShutdownSeconds: z.number().int().nonnegative(),
})
export type ServiceRunnerConfig = z.infer<typeof serviceRunnerConfigSchema>

export const serviceEnvironmentExecutionOverrideSchema = z.object({
  disabled: z.boolean().optional(),
  replicas: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    })
    .optional(),
  strategy: serviceRunnerStrategySchema.optional(),
  providerRefOverride: z.string().optional(),
  runnerRefOverride: z.string().optional(),
})
export type ServiceEnvironmentExecutionOverride = z.infer<typeof serviceEnvironmentExecutionOverrideSchema>

export const projectEnvironmentConfigSchema = z.object({
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
})
export type ProjectEnvironmentConfig = z.infer<typeof projectEnvironmentConfigSchema>
