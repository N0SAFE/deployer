import { MOCK_SERVICES_BY_PROJECT } from './services.mock'
import { REQUIRED_ENV_NAMES } from '@repo/contracts-common'
import type {
  EnvName,
  EnvironmentName,
  ServiceExecutionOverridesByEnvironment,
  ServiceConfigEntry,
  ServiceEnvironmentRuntimeStatus,
  ServiceProviderConfig,
  ServiceProviderType,
  ServiceRunnerConfig,
  ServiceRunnerType,
  ServiceRuntimeStatusByEnvironment,
} from '../types'

const BASE_STATUS: ServiceEnvironmentRuntimeStatus = {
  lifecycle: 'running',
  health: 'passing',
  lastHeartbeatAt: '2026-03-25T09:30:00Z',
  uptimePercent: 99.95,
  averageLatencyMs: 18,
  errorRatePercent: 0.1,
}

function createStatusMap(
  overrides?: Partial<Record<EnvironmentName, Partial<ServiceEnvironmentRuntimeStatus>>>,
): ServiceRuntimeStatusByEnvironment {
  const environments = [...new Set<EnvironmentName>([...REQUIRED_ENV_NAMES, ...Object.keys(overrides ?? {}) as EnvironmentName[]])]
  const entries = environments.map((env) => {
    const patch = overrides?.[env] ?? {}
    return [
      env,
      {
        ...BASE_STATUS,
        ...patch,
      },
    ]
  })

  return Object.fromEntries(entries) as ServiceRuntimeStatusByEnvironment
}

function createDefaultServiceConfig(service: {
  id: string
  projectId: string
  type: string
  runtime: string
  role?: 'group'
}): ServiceConfigEntry {
  const providerType = resolveProviderType(service)
  const runnerType = resolveRunnerType(service)

  return {
    deploymentProfile: service.role === 'group' ? 'isolated-group' : 'standard',
    autoscaleEnabled: true,
    minReplicas: service.role === 'group' ? 1 : 2,
    maxReplicas: service.role === 'group' ? 4 : 8,
    pinnedEnvironment: 'any',
    observabilityTags: service.role === 'group' ? ['group', 'composite-service'] : [service.runtime, 'service'],
    exposeGroupInternals: service.role === 'group',
    providerType,
    providerConfig: createProviderConfig(service, providerType),
    runnerType,
    runnerConfig: createRunnerConfig(service, runnerType),
    executionOverrides: createExecutionOverrides(service),
    healthCheck: {
      protocol: service.runtime === 'postgresql' || service.runtime === 'redis' ? 'tcp' : 'http',
      target:
        service.runtime === 'postgresql'
          ? 'tcp://localhost:5432'
          : service.runtime === 'redis'
            ? 'tcp://localhost:6379'
            : '/health',
      intervalSeconds: 15,
      timeoutSeconds: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
    },
    statusByEnvironment: createStatusMap(),
  }
}

function resolveProviderType(service: { runtime: string; type: string }): ServiceProviderType {
  if (service.type === 'storage' || service.runtime === 's3') {
    return 'container-registry'
  }

  if (service.runtime === 'python' || service.runtime === 'go' || service.runtime === 'rust') {
    return 'gitlab'
  }

  if (service.runtime === 'postgresql' || service.runtime === 'redis' || service.runtime === 'rabbitmq') {
    return 'artifact-bundle'
  }

  return 'github'
}

function resolveRunnerType(service: { runtime: string; type: string }): ServiceRunnerType {
  if (service.runtime === 'postgresql' || service.runtime === 'redis' || service.runtime === 'rabbitmq') {
    return 'docker-compose'
  }

  if (service.type === 'worker' || service.type === 'projection-worker' || service.type === 'data-pipeline') {
    return 'worker-runtime'
  }

  if (service.runtime === 'rust') {
    return 'nomad'
  }

  return 'kubernetes'
}

function createProviderConfig(
  service: { id: string; projectId: string; runtime: string },
  providerType: ServiceProviderType,
): ServiceProviderConfig {
  return {
    sourceUrl:
      providerType === 'artifact-bundle'
        ? `oci://artifacts.local/${service.projectId}/${service.id}:latest`
        : `https://git.example.local/${service.projectId}/${service.id}.git`,
    branch: 'main',
    rootPath: '/',
    buildContext: '.',
    dockerfilePath:
      providerType === 'artifact-bundle' ? undefined : service.runtime === 'nextjs' ? 'apps/web/Dockerfile' : 'Dockerfile',
    image:
      providerType === 'artifact-bundle' || providerType === 'container-registry'
        ? `registry.internal/${service.projectId}/${service.id}:latest`
        : undefined,
    autoSyncEnabled: providerType !== 'manual',
    webhookEnabled: providerType === 'github' || providerType === 'gitlab' || providerType === 'bitbucket',
    authSecretRef:
      providerType === 'github'
        ? 'secret://scm/github-app-token'
        : providerType === 'gitlab'
          ? 'secret://scm/gitlab-deploy-token'
          : 'secret://registry/pull-credentials',
  }
}

function createRunnerConfig(
  service: { runtime: string; type: string },
  runnerType: ServiceRunnerType,
): ServiceRunnerConfig {
  const defaultPort =
    service.runtime === 'postgresql'
      ? 5432
      : service.runtime === 'redis'
        ? 6379
        : service.runtime === 'rabbitmq'
          ? 5672
          : 3000

  return {
    strategy: service.type === 'edge-gateway' ? 'blue-green' : 'rolling',
    startCommand:
      runnerType === 'worker-runtime'
        ? 'bun run worker:start'
        : service.runtime === 'postgresql' || service.runtime === 'redis'
          ? 'docker-entrypoint.sh'
          : 'bun run start',
    args: runnerType === 'worker-runtime' ? ['--concurrency=4'] : [],
    ports: [defaultPort],
    volumeMounts:
      service.runtime === 'postgresql'
        ? ['/var/lib/postgresql/data:/data']
        : service.runtime === 'redis'
          ? ['/data/redis:/data']
          : ['/var/log/services:/var/log/app'],
    secretRefs: ['secret://platform/common-env', `secret://services/${service.type}/runtime`],
    networkMode: runnerType === 'docker-compose' ? 'bridge' : 'overlay',
    gracefulShutdownSeconds: runnerType === 'worker-runtime' ? 15 : 30,
  }
}

function createExecutionOverrides(service: {
  id: string
  type: string
  runtime: string
}): ServiceExecutionOverridesByEnvironment {
  const overrides: ServiceExecutionOverridesByEnvironment = {
    preview: {
      replicas: { min: 0, max: service.type === 'edge-gateway' ? 2 : 1 },
      strategy: 'recreate',
    },
    development: {
      replicas: { min: 0, max: 1 },
      strategy: 'recreate',
    },
  }

  if (service.runtime === 'postgresql' || service.runtime === 'redis') {
    overrides.preview = {
      disabled: true,
      replicas: { min: 0, max: 0 },
      strategy: 'recreate',
    }
  }

  if (service.type === 'integration-service') {
    overrides.production = {
      strategy: 'canary',
      replicas: { min: 1, max: 3 },
    }
  }

  const crossEnvironmentTargets: Partial<Record<string, EnvName>> = {
    'svc-catalog': 'staging',
    'svc-workflow': 'staging',
    'svc-phx-api': 'staging',
    'svc-nebula-serving': 'staging',
  }

  const targetEnvironment = crossEnvironmentTargets[service.id]
  if (targetEnvironment) {
    overrides.preview = {
      ...(overrides.preview ?? {}),
      dependencyLinkPolicy: {
        target: {
          mode: 'fixed-environment',
          targetEnvironment,
        },
        provisioning: {
          provisioningMode: 'shared-service',
          sharingScope: 'environment',
          reuseKey: 'stable-dependency-target',
          allowAttachAllTargets: true,
          noMatchPolicy: 'create-new-instance',
        },
      },
    }

    overrides.development = {
      ...(overrides.development ?? {}),
      dependencyLinkPolicy: {
        target: {
          mode: 'derived-environment',
          fromInputKey: 'targetEnv',
          fallbackEnvironment: targetEnvironment,
        },
        provisioning: {
          provisioningMode: 'shared-service',
          sharingScope: 'environment',
          reuseKey: 'stable-dependency-target',
          allowAttachAllTargets: true,
          noMatchPolicy: 'create-new-instance',
        },
      },
    }
  }

  return overrides
}

const STATUS_OVERRIDES: Record<string, Partial<Record<EnvironmentName, Partial<ServiceEnvironmentRuntimeStatus>>>> = {
  'svc-payment-adapter': {
    production: {
      lifecycle: 'degraded',
      health: 'warning',
      averageLatencyMs: 190,
      errorRatePercent: 1.6,
    },
  },
  'svc-analytics-pipeline': {
    development: {
      lifecycle: 'maintenance',
      health: 'unknown',
      uptimePercent: 92,
    },
  },
  'svc-phx-transcoder': {
    staging: {
      lifecycle: 'degraded',
      health: 'warning',
      averageLatencyMs: 240,
      errorRatePercent: 2.4,
    },
  },
  'svc-atlas-ledger': {
    production: {
      lifecycle: 'degraded',
      health: 'failing',
      averageLatencyMs: 300,
      errorRatePercent: 6.1,
    },
  },
  'svc-nebula-serving': {
    preview: {
      lifecycle: 'starting',
      health: 'warning',
      uptimePercent: 88,
      averageLatencyMs: 120,
      errorRatePercent: 1.8,
    },
  },
}

const PROFILE_OVERRIDES: Record<
  string,
  Partial<Pick<ServiceConfigEntry, 'autoscaleEnabled' | 'minReplicas' | 'maxReplicas' | 'pinnedEnvironment'>>
> = {
  'svc-edge-proxy': { minReplicas: 3, maxReplicas: 10 },
  'svc-gateway-api': { minReplicas: 3, maxReplicas: 12 },
  'svc-atlas-ledger': { autoscaleEnabled: false, minReplicas: 1, maxReplicas: 1, pinnedEnvironment: 'production' },
  'svc-nebula-trainer': { autoscaleEnabled: false, minReplicas: 0, maxReplicas: 2, pinnedEnvironment: 'staging' },
}

export const MOCK_SERVICE_CONFIGS_BY_PROJECT: Record<string, Record<string, ServiceConfigEntry>> =
  Object.fromEntries(
    Object.entries(MOCK_SERVICES_BY_PROJECT).map(([projectId, services]) => {
      const configEntries = services.map((service) => {
        const defaultConfig = createDefaultServiceConfig(service)
        const profilePatch = PROFILE_OVERRIDES[service.id] ?? {}
        const statusPatch = STATUS_OVERRIDES[service.id]

        return [
          service.id,
          {
            ...defaultConfig,
            ...profilePatch,
            observabilityTags:
              service.role === 'group'
                ? ['group', projectId, service.runtime]
                : [projectId, service.runtime, service.type],
            statusByEnvironment: createStatusMap(statusPatch),
          },
        ]
      })

      return [projectId, Object.fromEntries(configEntries)]
    }),
  )