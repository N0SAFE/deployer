import { z } from 'zod'
import {
  dependencyAttachmentModeSchema,
  dependencyHealthGateSchema,
  dependencyRequirementModeSchema,
  dependencyStartupModeSchema,
  projectEnvironmentDeploymentStrategySchema,
  projectEnvironmentHealthGateSchema,
  projectEnvironmentStartupModeSchema,
  envNameSchema,
  runnerNetworkModeSchema,
  serviceRunnerStrategySchema,
} from '@repo/contracts-common'
import { ALL_FILTER_OPERATORS, type FilterOperator } from '@repo/orpc-utils'

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

const serviceEnvironmentDependencyBehaviorSchema = z.object({
  requirement: dependencyRequirementModeSchema,
  healthGate: dependencyHealthGateSchema,
  startupMode: dependencyStartupModeSchema,
  attachmentMode: dependencyAttachmentModeSchema,
  targetSelection: z
    .object({
      strategy: z.enum(['filter-first', 'direct-only', 'preferred-then-filter']).default('filter-first'),
      directServiceId: z.string().optional(),
      filter: z.lazy(() => dependencyTargetFilterNodeSchema).optional(),
    })
    .default({ strategy: 'filter-first' })
    .superRefine((selection, ctx) => {
      if (selection.strategy === 'direct-only' && !selection.directServiceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['directServiceId'],
          message: 'direct-only strategy requires directServiceId.',
        })
      }

      if (selection.strategy === 'filter-first' && !selection.filter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['filter'],
          message: 'filter-first strategy requires a filter definition.',
        })
      }

      if (selection.strategy === 'preferred-then-filter' && !selection.directServiceId && !selection.filter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['strategy'],
          message: 'preferred-then-filter requires directServiceId, filter, or both.',
        })
      }
    }),
})

const dependencyFilterInputSourceSchema = z.enum([
  'project-environment',
  'source-service-environment',
  'source-service-provider-tags',
  'source-service-input',
  'target-service-tags',
  'target-service-provider-tags',
  'target-service-metadata',
  'runtime-input',
])
export type DependencyFilterInputSource = z.infer<typeof dependencyFilterInputSourceSchema>

const dependencyFilterOperatorSchema = z.enum(ALL_FILTER_OPERATORS)
export type DependencyFilterOperator = z.infer<typeof dependencyFilterOperatorSchema>

const dependencyTargetFilterConditionSchema = z.object({
  source: dependencyFilterInputSourceSchema,
  key: z.string().min(1),
  operator: dependencyFilterOperatorSchema,
  value: z.union([z.string(), z.array(z.string())]).optional(),
  valuesFromInputKey: z.string().min(1).optional(),
}).superRefine((condition, ctx) => {
  const nullaryOperators: FilterOperator[] = ['isNull', 'isNotNull']
  const listOperators: FilterOperator[] = ['in', 'notIn', 'contains']

  const hasStaticValue = condition.value !== undefined
  const hasInputValue = condition.valuesFromInputKey !== undefined

  if (hasStaticValue && hasInputValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valuesFromInputKey'],
      message: 'Provide either value or valuesFromInputKey, not both.',
    })
  }

  if (nullaryOperators.includes(condition.operator)) {
    if (hasStaticValue || hasInputValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `${condition.operator} does not accept value inputs.`,
      })
    }
    return
  }

  if (!hasStaticValue && !hasInputValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: `Operator ${condition.operator} requires value or valuesFromInputKey.`,
    })
    return
  }

  if (hasStaticValue && listOperators.includes(condition.operator) && !Array.isArray(condition.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: `Operator ${condition.operator} requires an array value.`,
    })
  }
})

const dependencyTargetFilterBuilderSchema = z.object({
  mode: z.literal('builder'),
  all: z.array(z.lazy(() => dependencyTargetFilterNodeSchema)).default([]),
  any: z.array(z.lazy(() => dependencyTargetFilterNodeSchema)).default([]),
  not: z.array(z.lazy(() => dependencyTargetFilterNodeSchema)).default([]),
  minShouldMatch: z.number().int().positive().optional(),
})

const dependencyTargetFilterNodeSchema: z.ZodType = z.union([
  dependencyTargetFilterConditionSchema,
  dependencyTargetFilterBuilderSchema,
])
export const serviceDependencyTargetFilterSchema = dependencyTargetFilterNodeSchema
export type ServiceDependencyTargetFilter = z.infer<typeof serviceDependencyTargetFilterSchema>

const dependencyLinkTargetSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('same-environment'),
  }),
  z.object({
    mode: z.literal('fixed-environment'),
    targetEnvironment: envNameSchema,
  }),
  z.object({
    mode: z.literal('derived-environment'),
    fromInputKey: z.string().min(1),
    fallbackEnvironment: envNameSchema,
  }),
])
export type DependencyLinkTarget = z.infer<typeof dependencyLinkTargetSchema>

const dependencyInstanceProvisioningSchema = z.discriminatedUnion('provisioningMode', [
  z.object({
    provisioningMode: z.literal('shared-service'),
    sharingScope: z.enum(['project', 'environment', 'organization']),
    reuseKey: z.string().min(1),
    allowAttachAllTargets: z.boolean().default(false),
    noMatchPolicy: z.enum(['create-new-instance', 'fail']).default('create-new-instance'),
  }),
  z.object({
    provisioningMode: z.literal('per-source-instance'),
    instanceNameTemplate: z.string().min(1),
    maxInstancesPerEnvironment: z.number().int().positive().optional(),
    noMatchPolicy: z.enum(['create-new-instance', 'fail']).default('create-new-instance'),
  }),
  z.object({
    provisioningMode: z.literal('on-demand-pool'),
    poolRef: z.string().min(1),
    warmInstances: z.number().int().nonnegative().default(0),
    scaleToZeroAfterSeconds: z.number().int().positive().optional(),
    noMatchPolicy: z.enum(['create-new-instance', 'fail']).default('create-new-instance'),
  }),
])
export type DependencyInstanceProvisioning = z.infer<typeof dependencyInstanceProvisioningSchema>

export const serviceDependencyLinkPolicySchema = z
  .object({
    target: dependencyLinkTargetSchema,
    provisioning: dependencyInstanceProvisioningSchema,
  })
  .superRefine((policy, ctx) => {
    if (policy.target.mode === 'same-environment' && policy.provisioning.provisioningMode === 'shared-service') {
      if (policy.provisioning.sharingScope === 'organization') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['provisioning', 'sharingScope'],
          message: 'same-environment target cannot use organization sharing scope.',
        })
      }
    }
  })
export type ServiceDependencyLinkPolicy = z.infer<typeof serviceDependencyLinkPolicySchema>

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
