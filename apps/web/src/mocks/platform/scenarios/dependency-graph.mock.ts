import { MOCK_DEPENDENCIES_BY_PROJECT } from '../entities/dependencies.mock'
import { MOCK_POLICY_OVERRIDES_BY_PROJECT, getDependencyPolicyKey } from '../entities/dependency-policies.mock'
import { MOCK_ORGANIZATIONS } from '../entities/organizations.mock'
import { MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS } from '../entities/operations.mock'
import { MOCK_PROJECTS } from '../entities/projects.mock'
import { MOCK_PROJECT_CONFIGURATIONS } from '../entities/configurations.mock'
import { MOCK_SERVICE_PROVIDERS_BY_PROJECT } from '../entities/service-providers.mock'
import { MOCK_SERVICE_RUNNERS_BY_PROJECT } from '../entities/service-runners.mock'
import { MOCK_SERVICE_CONFIGS_BY_PROJECT } from '../entities/service-configs.mock'
import { MOCK_SERVICES_BY_PROJECT } from '../entities/services.mock'
import { REQUIRED_ENV_NAMES } from '@repo/contracts-common'
import type {
  DependencyGraphMockScenario,
  DependencyPolicyOverrideMap,
  EnvironmentName,
  FixtureDependency,
  MockServiceProvider,
  MockServiceRunner,
  ServiceConfigEntry,
} from '../types'

function cloneDependencies(input: FixtureDependency[]): FixtureDependency[] {
  return input.map((dependency) => ({
    ...dependency,
    enabledIn: dependency.enabledIn ? [...dependency.enabledIn] : undefined,
  }))
}

function cloneServiceConfigs(input: Record<string, ServiceConfigEntry>): Record<string, ServiceConfigEntry> {
  const entries = Object.entries(input).map(([serviceId, config]) => {
    return [
      serviceId,
      {
        ...config,
        observabilityTags: [...config.observabilityTags],
        providerConfig: {
          ...config.providerConfig,
        },
        runnerConfig: {
          ...config.runnerConfig,
          args: [...config.runnerConfig.args],
          ports: [...config.runnerConfig.ports],
          volumeMounts: [...config.runnerConfig.volumeMounts],
          secretRefs: [...config.runnerConfig.secretRefs],
        },
        executionOverrides: Object.fromEntries(
          Object.entries(config.executionOverrides).map(([env, override]) => [
            env,
            override
              ? {
                  ...override,
                  replicas: override.replicas
                    ? {
                        ...override.replicas,
                      }
                    : undefined,
                }
              : undefined,
          ]),
        ) as ServiceConfigEntry['executionOverrides'],
        healthCheck: {
          ...config.healthCheck,
        },
        statusByEnvironment: Object.fromEntries(
          Object.entries(config.statusByEnvironment).map(([env, status]) => [env, { ...status }]),
        ) as ServiceConfigEntry['statusByEnvironment'],
      },
    ]
  })

  return Object.fromEntries(entries)
}

function cloneServiceProviders(
  input: Record<string, MockServiceProvider>,
): Record<string, MockServiceProvider> {
  return Object.fromEntries(
    Object.entries(input).map(([serviceId, provider]) => [
      serviceId,
      {
        ...provider,
        defaultConfig: {
          ...provider.defaultConfig,
        },
      },
    ]),
  )
}

function cloneServiceRunners(
  input: Record<string, MockServiceRunner>,
): Record<string, MockServiceRunner> {
  return Object.fromEntries(
    Object.entries(input).map(([serviceId, runner]) => [
      serviceId,
      {
        ...runner,
        defaultConfig: {
          ...runner.defaultConfig,
          args: [...runner.defaultConfig.args],
          ports: [...runner.defaultConfig.ports],
          volumeMounts: [...runner.defaultConfig.volumeMounts],
          secretRefs: [...runner.defaultConfig.secretRefs],
        },
      },
    ]),
  )
}

function mergePolicyOverrides(
  base: DependencyPolicyOverrideMap,
  derived: DependencyPolicyOverrideMap,
): DependencyPolicyOverrideMap {
  const merged: DependencyPolicyOverrideMap = { ...base }

  for (const [policyKey, envPatch] of Object.entries(derived)) {
    const existing = merged[policyKey] ?? {}
    const next = {
      ...existing,
      ...envPatch,
    }

    for (const env of REQUIRED_ENV_NAMES) {
      next[env] = {
        ...(existing[env] ?? {}),
        ...(envPatch?.[env] ?? {}),
      }
    }

    merged[policyKey] = next
  }

  return merged
}

function deriveHealthLinkedPolicyOverrides(input: {
  dependencies: FixtureDependency[]
  serviceConfigs: Record<string, ServiceConfigEntry>
  environments: EnvironmentName[]
}): DependencyPolicyOverrideMap {
  const derived: DependencyPolicyOverrideMap = {}

  for (const dependency of input.dependencies) {
    const policyKey = getDependencyPolicyKey({
      serviceId: dependency.serviceId,
      dependsOnServiceId: dependency.dependsOnServiceId,
    })

    const sourceConfig = input.serviceConfigs[dependency.serviceId]
    const targetConfig = input.serviceConfigs[dependency.dependsOnServiceId]

    if (!sourceConfig || !targetConfig) {
      continue
    }

    for (const env of input.environments) {
      const sourceStatus = sourceConfig.statusByEnvironment[env]
      const targetStatus = targetConfig.statusByEnvironment[env]

      if (!sourceStatus || !targetStatus) {
        continue
      }

      const envPatch: Record<string, Record<string, unknown>> = {}

      if (targetStatus.health === 'failing') {
        envPatch[env] = {
          requirement: env === 'production' ? 'optional' : 'disabled',
          healthGate: 'warn',
          startup: 'after',
          maxRetries: 1,
          timeoutSeconds: 20,
        }
      } else if (targetStatus.health === 'warning') {
        envPatch[env] = {
          requirement: 'optional',
          healthGate: 'warn',
          startup: env === 'production' ? 'parallel' : 'after',
        }
      }

      if (sourceConfig.pinnedEnvironment !== 'any' && sourceConfig.pinnedEnvironment !== env) {
        envPatch[env] = {
          ...envPatch[env],
          requirement: 'disabled',
          healthGate: 'ignore',
          startup: 'after',
        }
      }

      if (targetStatus.lifecycle === 'maintenance' || targetStatus.lifecycle === 'stopped') {
        envPatch[env] = {
          ...envPatch[env],
          requirement: 'disabled',
          healthGate: 'ignore',
        }
      }

      const patchKeys = Object.keys(envPatch[env] ?? {})
      if (patchKeys.length > 0) {
        derived[policyKey] = {
          ...(derived[policyKey] ?? {}),
          [env]: {
            ...(derived[policyKey]?.[env] ?? {}),
            ...envPatch[env],
          },
        }
      }
    }
  }

  return derived
}

export function getDependencyGraphMockScenario(projectId: string): DependencyGraphMockScenario {
  const project = MOCK_PROJECTS.find((item) => item.id === projectId) ?? MOCK_PROJECTS[0]

  if (!project) {
    throw new Error('No mock project available')
  }

  const organization = MOCK_ORGANIZATIONS.find((item) => item.id === project.organizationId) ?? MOCK_ORGANIZATIONS[0]
  if (!organization) {
    throw new Error('No mock organization available')
  }

  const fallbackProjectId = 'proj-orion-control-plane'
  const fallbackConfiguration = MOCK_PROJECT_CONFIGURATIONS[fallbackProjectId]
  const fallbackServices = MOCK_SERVICES_BY_PROJECT[fallbackProjectId]
  const fallbackDependencies = MOCK_DEPENDENCIES_BY_PROJECT[fallbackProjectId]
  const fallbackServiceConfigs = MOCK_SERVICE_CONFIGS_BY_PROJECT[fallbackProjectId]
  const fallbackServiceProviders = MOCK_SERVICE_PROVIDERS_BY_PROJECT[fallbackProjectId]
  const fallbackServiceRunners = MOCK_SERVICE_RUNNERS_BY_PROJECT[fallbackProjectId]

  if (
    !fallbackConfiguration ||
    !fallbackServices ||
    !fallbackDependencies ||
    !fallbackServiceConfigs ||
    !fallbackServiceProviders ||
    !fallbackServiceRunners
  ) {
    throw new Error('Missing fallback fixture for dependency graph scenario')
  }

  const configuration = MOCK_PROJECT_CONFIGURATIONS[project.id] ?? fallbackConfiguration
  const services = MOCK_SERVICES_BY_PROJECT[project.id] ?? fallbackServices
  const dependencies = MOCK_DEPENDENCIES_BY_PROJECT[project.id] ?? fallbackDependencies
  const serviceConfigs = MOCK_SERVICE_CONFIGS_BY_PROJECT[project.id] ?? fallbackServiceConfigs
  const serviceProviders = MOCK_SERVICE_PROVIDERS_BY_PROJECT[project.id] ?? fallbackServiceProviders
  const serviceRunners = MOCK_SERVICE_RUNNERS_BY_PROJECT[project.id] ?? fallbackServiceRunners
  const explicitOverrides =
    MOCK_POLICY_OVERRIDES_BY_PROJECT[project.id] ?? MOCK_POLICY_OVERRIDES_BY_PROJECT[fallbackProjectId] ?? {}

  const configuredEnvironments = Object.keys(configuration.environment.environments) as EnvironmentName[]
  const environments: EnvironmentName[] =
    configuredEnvironments.length > 0
      ? configuredEnvironments
      : [...REQUIRED_ENV_NAMES]

  const healthLinkedOverrides = deriveHealthLinkedPolicyOverrides({
    dependencies,
    serviceConfigs,
    environments,
  })

  const relatedProjects = MOCK_PROJECTS.filter((candidate) => candidate.organizationId === project.organizationId)

  return {
    organization,
    project,
    relatedProjects,
    configuration,
    services: services.map((service) => ({
      ...service,
      groupDefinition: service.groupDefinition
        ? {
            services: service.groupDefinition.services.map((member) => ({ ...member })),
            dependencies: service.groupDefinition.dependencies.map((dependency) => ({ ...dependency })),
          }
        : undefined,
    })),
    dependencies: cloneDependencies(dependencies),
    serviceConfigs: cloneServiceConfigs(serviceConfigs),
    serviceProviders: cloneServiceProviders(serviceProviders),
    serviceRunners: cloneServiceRunners(serviceRunners),
    policyOverrides: mergePolicyOverrides(explicitOverrides, healthLinkedOverrides),
    deployments: MOCK_DEPLOYMENTS.filter((deployment) => deployment.projectId === project.id),
    incidents: MOCK_INCIDENTS.filter((incident) => incident.projectId === project.id),
    notifications: MOCK_NOTIFICATIONS.filter((notification) => notification.projectId === project.id),
  }
}

export { getDependencyPolicyKey }