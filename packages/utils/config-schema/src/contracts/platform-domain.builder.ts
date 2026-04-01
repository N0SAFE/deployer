import { z } from 'zod'
import {
  dependencyAttachmentModeSchema,
  dependencyFailureModeSchema,
  dependencyHealthGateSchema,
  dependencyRequirementModeSchema,
  dependencyRequirementSchema,
  dependencySelectionOrderSchema,
  dependencyStartupModeSchema,
} from '../enums/dependency.schema'
import {
  envNameSchema,
  projectEnvironmentDeploymentStrategySchema,
  serviceHealthProtocolSchema,
  serviceHealthStateSchema,
  serviceLifecycleSchema,
} from '../enums/environment.schema'
import {
  operationsDeploymentStatusSchema,
  incidentSeveritySchema,
  incidentStatusSchema,
  notificationChannelSchema,
  notificationLevelSchema,
} from '../enums/operations.schema'
import {
  organizationPlanSchema,
  runnerNetworkModeSchema,
  serviceDeploymentProfileSchema,
  serviceProviderTypeSchema,
  serviceRunnerStrategySchema,
  serviceRunnerTypeSchema,
} from '../enums/provider-runner.schema'
import {
  projectEnvironmentConfigSchema,
  serviceEnvironmentExecutionOverrideSchema,
  serviceProviderConfigSchema,
  serviceRunnerConfigSchema,
} from '../entities/configuration.schema'

export type PlatformDomainSchemaDeps = {
  envNameSchema?: typeof envNameSchema
  organizationPlanSchema?: typeof organizationPlanSchema
  serviceProviderTypeSchema?: typeof serviceProviderTypeSchema
  serviceRunnerTypeSchema?: typeof serviceRunnerTypeSchema
  serviceHealthProtocolSchema?: typeof serviceHealthProtocolSchema
  serviceRunnerStrategySchema?: typeof serviceRunnerStrategySchema
  runnerNetworkModeSchema?: typeof runnerNetworkModeSchema
  projectEnvironmentDeploymentStrategySchema?: typeof projectEnvironmentDeploymentStrategySchema
}

export function createPlatformDomainSchemas(deps: PlatformDomainSchemaDeps = {}) {
  const env = deps.envNameSchema ?? envNameSchema
  const organizationPlan = deps.organizationPlanSchema ?? organizationPlanSchema
  const serviceProviderType = deps.serviceProviderTypeSchema ?? serviceProviderTypeSchema
  const serviceRunnerType = deps.serviceRunnerTypeSchema ?? serviceRunnerTypeSchema
  const serviceHealthProtocol = deps.serviceHealthProtocolSchema ?? serviceHealthProtocolSchema
  const serviceRunnerStrategy = deps.serviceRunnerStrategySchema ?? serviceRunnerStrategySchema
  const runnerNetworkMode = deps.runnerNetworkModeSchema ?? runnerNetworkModeSchema
  const projectEnvDeploymentStrategy =
    deps.projectEnvironmentDeploymentStrategySchema ?? projectEnvironmentDeploymentStrategySchema

  const mockOrganizationSchema = z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    plan: organizationPlan,
    region: z.string(),
  })

  const mockTeamSchema = z.object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
    purpose: z.string(),
  })

  const mockProjectSchema = z.object({
    id: z.string(),
    organizationId: z.string(),
    teamId: z.string(),
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

  const envPolicyMapSchema = z.object({
    production: envPolicySchema,
    staging: envPolicySchema,
    preview: envPolicySchema,
    development: envPolicySchema,
  })

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

  const serviceRuntimeStatusByEnvironmentSchema = z.object({
    production: serviceEnvironmentRuntimeStatusSchema,
    staging: serviceEnvironmentRuntimeStatusSchema,
    preview: serviceEnvironmentRuntimeStatusSchema,
    development: serviceEnvironmentRuntimeStatusSchema,
  })

  const serviceExecutionOverridesByEnvironmentSchema = z.object({
    production: serviceEnvironmentExecutionOverrideSchema.optional(),
    staging: serviceEnvironmentExecutionOverrideSchema.optional(),
    preview: serviceEnvironmentExecutionOverrideSchema.optional(),
    development: serviceEnvironmentExecutionOverrideSchema.optional(),
  })

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
    environment: z.object({
      defaultVariables: z.record(z.string(), z.string()),
      environments: z.object({
        production: projectEnvironmentConfigSchema.optional(),
        staging: projectEnvironmentConfigSchema.optional(),
        preview: projectEnvironmentConfigSchema.optional(),
        development: projectEnvironmentConfigSchema.optional(),
      }),
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
    organizationId: z.string(),
    projectId: z.string(),
    environment: env,
    status: operationsDeploymentStatusSchema,
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    initiatedBy: z.string(),
  })

  const mockIncidentSchema = z.object({
    id: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    severity: incidentSeveritySchema,
    title: z.string(),
    environment: env,
    affectedServiceIds: z.array(z.string()),
    status: incidentStatusSchema,
  })

  const mockNotificationSchema = z.object({
    id: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    channel: notificationChannelSchema,
    level: notificationLevelSchema,
    message: z.string(),
    createdAt: z.string(),
  })

  const dependencyGraphMockScenarioSchema = z.object({
    organization: mockOrganizationSchema,
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
  })

  const platformMockOverviewSchema = z.object({
    organizations: z.array(mockOrganizationSchema),
    teams: z.array(mockTeamSchema),
    projects: z.array(mockProjectSchema),
    projectScenarios: z.record(z.string(), dependencyGraphMockScenarioSchema),
  })

  return {
    mockOrganizationSchema,
    mockTeamSchema,
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
