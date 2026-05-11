import z from 'zod'
import { serviceRunnerStrategySchema } from '@repo/contracts-common'
import {
  serviceEnvironmentDependencyBehaviorSchema,
  serviceDependencyLinkPolicySchema,
} from './dependency-targeting.schema'

const serviceEnvironmentExecutionOverrideBaseSchema = z
  .object({
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
    dependencyBehavior: serviceEnvironmentDependencyBehaviorSchema.optional(),
    dependencyLinkPolicy: serviceDependencyLinkPolicySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.replicas && value.replicas.max < value.replicas.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replicas', 'max'],
        message: 'replicas.max must be greater than or equal to replicas.min',
      })
    }
  })

export const serviceEnvironmentExecutionOverrideSchema = serviceEnvironmentExecutionOverrideBaseSchema
export type ServiceEnvironmentExecutionOverride = z.infer<typeof serviceEnvironmentExecutionOverrideSchema>

export const serviceEnvironmentExecutionOverrideByEnvSchema = z
  .object({
    production: serviceEnvironmentExecutionOverrideBaseSchema.optional(),
    preview: serviceEnvironmentExecutionOverrideBaseSchema.optional(),
    development: serviceEnvironmentExecutionOverrideBaseSchema.optional(),
  })
  .catchall(serviceEnvironmentExecutionOverrideBaseSchema)
  .superRefine((overrides, ctx) => {
    const previewTarget = overrides.preview?.dependencyLinkPolicy?.target
    if (previewTarget?.mode === 'fixed-environment' && previewTarget.targetEnvironment === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preview', 'dependencyLinkPolicy', 'target', 'targetEnvironment'],
        message: 'preview override cannot directly target production dependencies.',
      })
    }

    if (previewTarget?.mode === 'derived-environment' && previewTarget.fallbackEnvironment === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preview', 'dependencyLinkPolicy', 'target', 'fallbackEnvironment'],
        message: 'preview override cannot fallback to production dependencies.',
      })
    }

    const developmentTarget = overrides.development?.dependencyLinkPolicy?.target
    if (developmentTarget?.mode === 'fixed-environment' && developmentTarget.targetEnvironment === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['development', 'dependencyLinkPolicy', 'target', 'targetEnvironment'],
        message: 'development override cannot directly target production dependencies.',
      })
    }

    if (developmentTarget?.mode === 'derived-environment' && developmentTarget.fallbackEnvironment === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['development', 'dependencyLinkPolicy', 'target', 'fallbackEnvironment'],
        message: 'development override cannot fallback to production dependencies.',
      })
    }
  })
export type ServiceEnvironmentExecutionOverrideByEnv = z.infer<typeof serviceEnvironmentExecutionOverrideByEnvSchema>
