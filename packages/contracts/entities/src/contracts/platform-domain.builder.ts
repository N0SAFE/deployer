import z from 'zod'
import {
  dependencyAttachmentModeSchema,
  dependencyFailureModeSchema,
  dependencyHealthGateSchema,
  dependencyRequirementModeSchema,
  dependencyRequirementSchema,
  dependencySelectionOrderSchema,
  dependencyStartupModeSchema,
} from '@repo/contracts-common'
import {
  envNameSchema,
  projectEnvironmentDeploymentStrategySchema,
  serviceHealthProtocolSchema,
  serviceHealthStateSchema,
  serviceLifecycleSchema,
  withRequiredEnvironments,
} from '@repo/contracts-common'
import {
  operationsDeploymentStatusSchema,
  incidentSeveritySchema,
  incidentStatusSchema,
  notificationChannelSchema,
  notificationLevelSchema,
} from '@repo/contracts-common'
import {
  runnerNetworkModeSchema,
  serviceDeploymentProfileSchema,
  serviceProviderTypeSchema,
  serviceRunnerStrategySchema,
  serviceRunnerTypeSchema,
} from '@repo/contracts-common'
import {
  projectEnvironmentConfigByNameSchema,
  projectEnvironmentExtensionConfigSchema,
  serviceEnvironmentExecutionOverrideByEnvSchema,
  serviceEnvironmentExecutionOverrideSchema,
  serviceProviderConfigSchema,
  serviceRunnerConfigSchema,
} from '../entities/configuration'

export type PlatformDomainSchemaDeps = {
  envNameSchema?: typeof envNameSchema
  serviceProviderTypeSchema?: typeof serviceProviderTypeSchema
  serviceRunnerTypeSchema?: typeof serviceRunnerTypeSchema
  serviceHealthProtocolSchema?: typeof serviceHealthProtocolSchema
  serviceRunnerStrategySchema?: typeof serviceRunnerStrategySchema
  runnerNetworkModeSchema?: typeof runnerNetworkModeSchema
  projectEnvironmentDeploymentStrategySchema?: typeof projectEnvironmentDeploymentStrategySchema
}

export function createPlatformDomainSchemas(deps: PlatformDomainSchemaDeps = {}) {
  const env = deps.envNameSchema ?? envNameSchema
  const serviceProviderType = deps.serviceProviderTypeSchema ?? serviceProviderTypeSchema
  const serviceRunnerType = deps.serviceRunnerTypeSchema ?? serviceRunnerTypeSchema
  const serviceHealthProtocol = deps.serviceHealthProtocolSchema ?? serviceHealthProtocolSchema
  const serviceRunnerStrategy = deps.serviceRunnerStrategySchema ?? serviceRunnerStrategySchema
  const runnerNetworkMode = deps.runnerNetworkModeSchema ?? runnerNetworkModeSchema
  const projectEnvDeploymentStrategy =
    deps.projectEnvironmentDeploymentStrategySchema ?? projectEnvironmentDeploymentStrategySchema

  const mockProjectSchema = z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
  })

  const fixtureGroupMemberServiceSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.string(),
    runtime: z.string(),
  })

  const fixtureGroupMemberDependencySchema = z.object({
    id: z.string(),
    serviceId: z.string(),
    dependsOnServiceId: z.string(),
    requirement: dependencyRequirementSchema,
  })

  const fixtureServiceGroupDefinitionSchema = z.object({
    services: z.array(fixtureGroupMemberServiceSchema),
    dependencies: z.array(fixtureGroupMemberDependencySchema),
  })

  const fixtureServiceSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.string(),
    runtime: z.string(),
    layer: z.number().int().nonnegative(),
    isActive: z.boolean(),
    role: z.literal('group').optional(),
    groupDefinition: z.lazy(() => fixtureServiceGroupDefinitionSchema).optional(),
  })

  const fixtureDependencySchema = z.object({
    id: z.string(),
    serviceId: z.string(),
    dependsOnServiceId: z.string(),
    createdAt: z.string(),
    enabledIn: z.array(env).optional(),
  })

  const envPolicySchema = z.object({
    requirement: dependencyRequirementModeSchema,
    healthGate: dependencyHealthGateSchema,
    startup: dependencyStartupModeSchema,
    maxRetries: z.number().int().nonnegative(),
    timeoutSeconds: z.number().int().positive(),
    attachmentMode: dependencyAttachmentModeSchema,
    maxAttachedTargets: z.number().int().positive(),
    selectionOrder: dependencySelectionOrderSchema,
    sharedEnvVariableKeys: z.array(z.string()),
    targetServiceFilters: z.array(z.string()),
    allowAttachAllTargets: z.boolean(),
  })

  const envPolicyMapSchema = withRequiredEnvironments(envPolicySchema)

  const dependencyPolicyAdvancedSchema = z.object({
    failureMode: dependencyFailureModeSchema,
    circuitBreakerEnabled: z.boolean(),
    circuitBreakerFailureThreshold: z.number().int().positive(),
    retryBackoffMs: z.number().int().nonnegative(),
    maxInFlightRequests: z.number().int().positive(),
    enableDependencyTelemetry: z.boolean(),
    allowCrossRegionFailover: z.boolean(),
    observabilityTags: z.array(z.string()),
  })

  const serviceHealthCheckConfigSchema = z.object({
    protocol: serviceHealthProtocol,
    target: z.string(),
    intervalSeconds: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive(),
    healthyThreshold: z.number().int().positive(),
    unhealthyThreshold: z.number().int().positive(),
  })

  const serviceEnvironmentRuntimeStatusSchema = z.object({
    lifecycle: serviceLifecycleSchema,
    health: serviceHealthStateSchema,
    lastHeartbeatAt: z.string(),
    uptimePercent: z.number(),
    averageLatencyMs: z.number(),
    errorRatePercent: z.number(),
  })

  const serviceRuntimeStatusByEnvironmentSchema = withRequiredEnvironments(serviceEnvironmentRuntimeStatusSchema)

  const serviceExecutionOverridesByEnvironmentSchema = serviceEnvironmentExecutionOverrideByEnvSchema

  const serviceConfigEntrySchema = z.object({
    deploymentProfile: serviceDeploymentProfileSchema,
    autoscaleEnabled: z.boolean(),
    minReplicas: z.number().int().nonnegative(),
    maxReplicas: z.number().int().nonnegative(),
    pinnedEnvironment: z.union([env, z.literal('any')]),
    observabilityTags: z.array(z.string()),
    exposeGroupInternals: z.boolean(),
    providerType: serviceProviderType,
    providerConfig: serviceProviderConfigSchema,
    runnerType: serviceRunnerType,
    runnerConfig: z.object({
      strategy: serviceRunnerStrategy,
      startCommand: z.string(),
      args: z.array(z.string()),
      ports: z.array(z.number().int().positive()),
      volumeMounts: z.array(z.string()),
      secretRefs: z.array(z.string()),
      networkMode: runnerNetworkMode,
      gracefulShutdownSeconds: z.number().int().nonnegative(),
    }),
    executionOverrides: serviceExecutionOverridesByEnvironmentSchema,
    healthCheck: serviceHealthCheckConfigSchema,
    statusByEnvironment: serviceRuntimeStatusByEnvironmentSchema,
  })

  const mockServiceProviderSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    serviceId: z.string(),
    type: serviceProviderType,
    name: z.string(),
    integrationRef: z.string(),
    defaultConfig: serviceProviderConfigSchema,
  })

  const mockServiceRunnerSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    serviceId: z.string(),
    type: serviceRunnerType,
    name: z.string(),
    pool: z.string(),
    defaultConfig: serviceRunnerConfigSchema,
  })

  const projectConfigurationSchema = z.object({
    general: z.object({
      projectName: z.string(),
      defaultBranch: z.string(),
      autoDeployEnabled: z.boolean(),
      reviewAppsEnabled: z.boolean(),
      ownerTeam: z.string(),
      releasePolicy: z.object({
        cadence: z.string(),
        freezeWindowUtc: z.string(),
        progressiveRollout: z.boolean(),
      }),
    }),
    environment: z
      .object({
        previewEnabled: z.boolean().default(false),
        developmentEnabled: z.boolean().default(false),
        defaultVariables: z.record(z.string(), z.string()),
        extensionConfig: projectEnvironmentExtensionConfigSchema.optional(),
        environments: projectEnvironmentConfigByNameSchema,
      })
      .superRefine((environment, ctx) => {
        const envNames = Object.keys(environment.environments)

        if (!envNames.includes('production')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['environments'],
            message: 'A project must define the mandatory production environment.',
          })
        }

        if (environment.previewEnabled && !envNames.includes('preview')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['environments', 'preview'],
            message: 'Preview environment must be configured when previewEnabled is true.',
          })
        }

        if (!environment.previewEnabled && envNames.includes('preview')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['previewEnabled'],
            message: 'previewEnabled must be true when preview environment is configured.',
          })
        }

        if (environment.developmentEnabled && !envNames.includes('development')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['environments', 'development'],
            message: 'Development environment must be configured when developmentEnabled is true.',
          })
        }

        if (!environment.developmentEnabled && envNames.includes('development')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['developmentEnabled'],
            message: 'developmentEnabled must be true when development environment is configured.',
          })
        }

        if (environment.previewEnabled && !environment.extensionConfig?.preview) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['extensionConfig', 'preview'],
            message: 'Preview extension config must be defined when previewEnabled is true.',
          })
        }

        if (!environment.previewEnabled && environment.extensionConfig?.preview) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['extensionConfig', 'preview'],
            message: 'Preview extension config must be omitted when previewEnabled is false.',
          })
        }

        if (environment.developmentEnabled && !environment.extensionConfig?.development) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['extensionConfig', 'development'],
            message: 'Development extension config must be defined when developmentEnabled is true.',
          })
        }

        if (!environment.developmentEnabled && environment.extensionConfig?.development) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['extensionConfig', 'development'],
            message: 'Development extension config must be omitted when developmentEnabled is false.',
          })
        }

        if (
          environment.extensionConfig?.preview &&
          !envNames.includes(environment.extensionConfig.preview.extends)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['extensionConfig', 'preview', 'extends'],
            message: `Preview extension base environment ${environment.extensionConfig.preview.extends} must exist in project environments.`,
          })
        }

        if (
          environment.extensionConfig?.development &&
          !envNames.includes(environment.extensionConfig.development.extends)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['extensionConfig', 'development', 'extends'],
            message: `Development extension base environment ${environment.extensionConfig.development.extends} must exist in project environments.`,
          })
        }
      }),
    deployment: z.object({
      deploymentStrategy: projectEnvDeploymentStrategy,
      canaryStepsPercent: z.array(z.number()),
      healthCheckTimeoutSeconds: z.number().int().positive(),
      rollbackWindowSeconds: z.number().int().positive(),
      maxParallelServiceDeployments: z.number().int().positive(),
      requireManualApprovalFor: z.array(z.string()),
    }),
    security: z.object({
      enableHttpsRedirect: z.boolean(),
      mTLSInternalTraffic: z.boolean(),
      zeroTrustPoliciesEnabled: z.boolean(),
      allowedIngressCidrs: z.array(z.string()),
      ssoProviders: z.array(z.string()),
    }),
    resource: z.object({
      defaultCpuLimit: z.string(),
      defaultMemoryLimit: z.string(),
      maxServiceReplicas: z.number().int().positive(),
      autoscaling: z.object({
        enabled: z.boolean(),
        targetCpuPercent: z.number(),
        targetMemoryPercent: z.number(),
      }),
      storage: z.object({
        defaultVolumeClass: z.string(),
        backupRetentionDays: z.number().int().positive(),
      }),
    }),
    notification: z.object({
      enableEmailNotifications: z.boolean(),
      enableSlackNotifications: z.boolean(),
      slackChannels: z.array(z.string()),
      notifyOnDeploymentFailure: z.boolean(),
      notifyOnCriticalDependencyFailure: z.boolean(),
      notifyOnPolicyDrift: z.boolean(),
    }),
  })

  const mockDeploymentSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    environment: env,
    status: operationsDeploymentStatusSchema,
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    initiatedBy: z.string(),
  })

  const mockIncidentSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    severity: incidentSeveritySchema,
    title: z.string(),
    environment: env,
    affectedServiceIds: z.array(z.string()),
    status: incidentStatusSchema,
  })

  const mockNotificationSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    channel: notificationChannelSchema,
    level: notificationLevelSchema,
    message: z.string(),
    createdAt: z.string(),
  })

  const dependencyGraphMockScenarioSchema = z.object({
    project: mockProjectSchema,
    relatedProjects: z.array(mockProjectSchema),
    configuration: projectConfigurationSchema,
    services: z.array(fixtureServiceSchema),
    dependencies: z.array(fixtureDependencySchema),
    serviceConfigs: z.record(z.string(), serviceConfigEntrySchema),
    serviceProviders: z.record(z.string(), mockServiceProviderSchema),
    serviceRunners: z.record(z.string(), mockServiceRunnerSchema),
    policyOverrides: z.record(
      z.string(),
      z.object({
        production: envPolicySchema.partial().optional(),
        staging: envPolicySchema.partial().optional(),
        preview: envPolicySchema.partial().optional(),
        development: envPolicySchema.partial().optional(),
      }),
    ),
    deployments: z.array(mockDeploymentSchema),
    incidents: z.array(mockIncidentSchema),
    notifications: z.array(mockNotificationSchema),
  }).superRefine((scenario, ctx) => {
    const projectId = scenario.project.id
    const projectEnvironmentNames = Object.keys(scenario.configuration.environment.environments)

    if (scenario.services.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['services'],
        message: 'A project must define at least one service.',
      })
      return
    }

    const serviceIds = new Set<string>()

    scenario.services.forEach((service, index) => {
      serviceIds.add(service.id)

      if (service.projectId !== projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['services', index, 'projectId'],
          message: `Service ${service.id} must belong to project ${projectId}.`,
        })
      }

      const serviceConfig = scenario.serviceConfigs[service.id]
      if (!serviceConfig) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceConfigs', service.id],
          message: `Missing configuration for service ${service.id}.`,
        })
        return
      }

      if (serviceConfig.pinnedEnvironment !== 'any' && !projectEnvironmentNames.includes(serviceConfig.pinnedEnvironment)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceConfigs', service.id, 'pinnedEnvironment'],
          message: `Pinned environment must exist in project environments for service ${service.id}.`,
        })
      }

      for (const envName of projectEnvironmentNames) {
        if (!(envName in serviceConfig.statusByEnvironment)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'statusByEnvironment', envName],
            message: `Service ${service.id} must inherit runtime status for project environment ${envName}.`,
          })
        }
      }

      const executionOverrideEntries = Object.entries(serviceConfig.executionOverrides)
      for (const [envName, executionOverride] of executionOverrideEntries) {
        if (!projectEnvironmentNames.includes(envName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName],
            message: `Service ${service.id} override is defined for unknown environment ${envName}.`,
          })
          continue
        }

        if (envName === 'preview' && !scenario.configuration.environment.previewEnabled) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName],
            message: `Service ${service.id} cannot define preview overrides when preview environment is disabled.`,
          })
        }

        if (envName === 'development' && !scenario.configuration.environment.developmentEnabled) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName],
            message: `Service ${service.id} cannot define development overrides when development environment is disabled.`,
          })
        }

        if (!executionOverride?.dependencyLinkPolicy) {
          continue
        }

        const targetPolicy = executionOverride.dependencyLinkPolicy.target
        if (
          targetPolicy.mode === 'fixed-environment' &&
          !projectEnvironmentNames.includes(targetPolicy.targetEnvironment)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName, 'dependencyLinkPolicy', 'target', 'targetEnvironment'],
            message: `Service ${service.id} override for ${envName} references unknown target environment ${targetPolicy.targetEnvironment}.`,
          })
        }

        if (
          targetPolicy.mode === 'derived-environment' &&
          !projectEnvironmentNames.includes(targetPolicy.fallbackEnvironment)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName, 'dependencyLinkPolicy', 'target', 'fallbackEnvironment'],
            message: `Service ${service.id} override for ${envName} references unknown fallback environment ${targetPolicy.fallbackEnvironment}.`,
          })
        }

        if (
          (envName === 'preview' || envName === 'development') &&
          targetPolicy.mode === 'fixed-environment' &&
          targetPolicy.targetEnvironment === 'production'
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName, 'dependencyLinkPolicy', 'target', 'targetEnvironment'],
            message: `${envName} override for ${service.id} cannot target production dependencies directly.`,
          })
        }

        if (
          (envName === 'preview' || envName === 'development') &&
          targetPolicy.mode === 'derived-environment' &&
          targetPolicy.fallbackEnvironment === 'production'
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName, 'dependencyLinkPolicy', 'target', 'fallbackEnvironment'],
            message: `${envName} override for ${service.id} cannot fallback to production dependencies.`,
          })
        }

        if (
          targetPolicy.mode === 'same-environment' &&
          executionOverride.dependencyLinkPolicy.provisioning.provisioningMode === 'shared-service' &&
          executionOverride.dependencyLinkPolicy.provisioning.sharingScope === 'project'
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceConfigs', service.id, 'executionOverrides', envName, 'dependencyLinkPolicy', 'provisioning', 'sharingScope'],
            message: `Organization-wide sharing is invalid for same-environment dependency links on ${service.id}/${envName}.`,
          })
        }
      }

      const provider = scenario.serviceProviders[service.id]
      if (!provider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceProviders', service.id],
          message: `Missing provider entry for service ${service.id}.`,
        })
      } else {
        if (provider.projectId !== projectId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceProviders', service.id, 'projectId'],
            message: `Provider ${provider.id} must belong to project ${projectId}.`,
          })
        }
        if (provider.serviceId !== service.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceProviders', service.id, 'serviceId'],
            message: `Provider ${provider.id} must reference service ${service.id}.`,
          })
        }
      }

      const runner = scenario.serviceRunners[service.id]
      if (!runner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceRunners', service.id],
          message: `Missing runner entry for service ${service.id}.`,
        })
      } else {
        if (runner.projectId !== projectId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceRunners', service.id, 'projectId'],
            message: `Runner ${runner.id} must belong to project ${projectId}.`,
          })
        }
        if (runner.serviceId !== service.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceRunners', service.id, 'serviceId'],
            message: `Runner ${runner.id} must reference service ${service.id}.`,
          })
        }
      }
    })

    Object.keys(scenario.serviceConfigs).forEach((serviceId) => {
      if (!serviceIds.has(serviceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceConfigs', serviceId],
          message: `Service configuration ${serviceId} has no matching service entry.`,
        })
      }
    })

    scenario.dependencies.forEach((dependency, index) => {
      if (!serviceIds.has(dependency.serviceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dependencies', index, 'serviceId'],
          message: `Dependency source ${dependency.serviceId} is not part of project services.`,
        })
      }
      if (!serviceIds.has(dependency.dependsOnServiceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dependencies', index, 'dependsOnServiceId'],
          message: `Dependency target ${dependency.dependsOnServiceId} is not part of project services.`,
        })
      }

      for (const enabledEnv of dependency.enabledIn ?? []) {
        if (!projectEnvironmentNames.includes(enabledEnv)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dependencies', index, 'enabledIn'],
            message: `Dependency environment ${enabledEnv} must exist in project environments.`,
          })
        }
      }
    })
  })

  const platformMockOverviewSchema = z.object({

    projects: z.array(mockProjectSchema),
    projectScenarios: z.record(z.string(), dependencyGraphMockScenarioSchema),
  })

  return {
    mockProjectSchema,
    fixtureGroupMemberServiceSchema,
    fixtureGroupMemberDependencySchema,
    fixtureServiceGroupDefinitionSchema,
    fixtureServiceSchema,
    fixtureDependencySchema,
    envPolicySchema,
    envPolicyMapSchema,
    dependencyPolicyAdvancedSchema,
    serviceHealthCheckConfigSchema,
    serviceEnvironmentRuntimeStatusSchema,
    serviceRuntimeStatusByEnvironmentSchema,
    serviceEnvironmentExecutionOverrideSchema,
    serviceExecutionOverridesByEnvironmentSchema,
    serviceConfigEntrySchema,
    mockServiceProviderSchema,
    mockServiceRunnerSchema,
    projectConfigurationSchema,
    mockDeploymentSchema,
    mockIncidentSchema,
    mockNotificationSchema,
    dependencyGraphMockScenarioSchema,
    platformMockOverviewSchema,
  }
}

export const platformDomainSchemas = createPlatformDomainSchemas()
