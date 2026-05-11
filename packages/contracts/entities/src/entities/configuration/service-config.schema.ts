import z from 'zod'
import {
  runnerNetworkModeSchema,
  serviceRunnerStrategySchema,
} from '@repo/contracts-common'

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
