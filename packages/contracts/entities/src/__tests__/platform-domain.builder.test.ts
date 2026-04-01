import { describe, expect, it } from 'vitest'
import { platformDomainSchemas } from '../contracts/platform-domain.builder'

function createBaseScenario() {
  return {
    organization: {
      id: 'org_1',
      slug: 'acme',
      name: 'Acme',
      plan: 'team',
      region: 'eu-west-1',
    },
    project: {
      id: 'prj_1',
      organizationId: 'org_1',
      teamId: 'team_1',
      slug: 'platform',
      name: 'Platform',
      description: 'Main project',
    },
    relatedProjects: [],
    configuration: {
      general: {
        projectName: 'Platform',
        defaultBranch: 'main',
        autoDeployEnabled: true,
        reviewAppsEnabled: true,
        ownerTeam: 'platform',
        releasePolicy: {
          cadence: 'weekly',
          freezeWindowUtc: 'sunday-00:00-02:00',
          progressiveRollout: true,
        },
      },
      environment: {
        previewEnabled: true,
        developmentEnabled: true,
        defaultVariables: {},
        extensionConfig: {
          preview: {
            extends: 'production',
            overrides: {},
          },
          development: {
            extends: 'production',
            overrides: {},
          },
        },
        environments: {
          production: {
            variables: {},
            autoDeployEnabled: true,
            deploymentStrategy: 'rolling',
            healthGate: 'strict',
            startupMode: 'before',
            replicas: { min: 1, max: 3 },
            trafficPolicy: {
              maxErrorRatePercent: 1,
              maxLatencyMs: 250,
              allowCrossRegionFailover: false,
            },
          },
          staging: {
            variables: {},
            autoDeployEnabled: true,
            deploymentStrategy: 'rolling',
            healthGate: 'strict',
            startupMode: 'before',
            replicas: { min: 1, max: 2 },
            trafficPolicy: {
              maxErrorRatePercent: 2,
              maxLatencyMs: 300,
              allowCrossRegionFailover: false,
            },
          },
          preview: {
            variables: {},
            autoDeployEnabled: true,
            deploymentStrategy: 'rolling',
            healthGate: 'warn',
            startupMode: 'parallel',
            replicas: { min: 0, max: 1 },
            trafficPolicy: {
              maxErrorRatePercent: 5,
              maxLatencyMs: 500,
              allowCrossRegionFailover: false,
            },
          },
          development: {
            variables: {},
            autoDeployEnabled: true,
            deploymentStrategy: 'rolling',
            healthGate: 'ignore',
            startupMode: 'parallel',
            replicas: { min: 0, max: 1 },
            trafficPolicy: {
              maxErrorRatePercent: 10,
              maxLatencyMs: 1000,
              allowCrossRegionFailover: false,
            },
          },
        },
      },
      deployment: {
        deploymentStrategy: 'rolling',
        canaryStepsPercent: [10, 50, 100],
        healthCheckTimeoutSeconds: 60,
        rollbackWindowSeconds: 300,
        maxParallelServiceDeployments: 3,
        requireManualApprovalFor: ['production'],
      },
      security: {
        enableHttpsRedirect: true,
        mTLSInternalTraffic: false,
        zeroTrustPoliciesEnabled: false,
        allowedIngressCidrs: [],
        ssoProviders: [],
      },
      resource: {
        defaultCpuLimit: '500m',
        defaultMemoryLimit: '512Mi',
        maxServiceReplicas: 10,
        autoscaling: {
          enabled: true,
          targetCpuPercent: 70,
          targetMemoryPercent: 80,
        },
        storage: {
          defaultVolumeClass: 'standard',
          backupRetentionDays: 7,
        },
      },
      notification: {
        enableEmailNotifications: true,
        enableSlackNotifications: false,
        slackChannels: [],
        notifyOnDeploymentFailure: true,
        notifyOnCriticalDependencyFailure: true,
        notifyOnPolicyDrift: true,
      },
    },
    services: [
      {
        id: 'svc_api',
        projectId: 'prj_1',
        name: 'api',
        description: 'API',
        type: 'api',
        runtime: 'node',
        layer: 1,
        isActive: true,
      },
    ],
    dependencies: [],
    serviceConfigs: {
      svc_api: {
        deploymentProfile: 'standard',
        autoscaleEnabled: true,
        minReplicas: 1,
        maxReplicas: 3,
        pinnedEnvironment: 'any',
        observabilityTags: [],
        exposeGroupInternals: false,
        providerType: 'github',
        providerConfig: {
          sourceUrl: 'https://github.com/acme/platform.git',
          branch: 'main',
          rootPath: '/',
          buildContext: '.',
          dockerfilePath: 'Dockerfile',
          autoSyncEnabled: true,
          webhookEnabled: true,
          authSecretRef: 'secret://scm/github',
        },
        runnerType: 'kubernetes',
        runnerConfig: {
          strategy: 'rolling',
          startCommand: 'bun run start',
          args: [],
          ports: [3000],
          volumeMounts: [],
          secretRefs: [],
          networkMode: 'overlay',
          gracefulShutdownSeconds: 15,
        },
        executionOverrides: {
          preview: {
            dependencyLinkPolicy: {
              target: {
                mode: 'fixed-environment',
                targetEnvironment: 'staging',
              },
              provisioning: {
                provisioningMode: 'shared-service',
                sharingScope: 'environment',
                reuseKey: 'shared-db-preview',
              },
            },
          },
        },
        healthCheck: {
          protocol: 'http',
          target: '/health',
          intervalSeconds: 10,
          timeoutSeconds: 5,
          healthyThreshold: 2,
          unhealthyThreshold: 3,
        },
        statusByEnvironment: {
          production: {
            lifecycle: 'running',
            health: 'passing',
            lastHeartbeatAt: '2026-03-27T10:00:00Z',
            uptimePercent: 99.9,
            averageLatencyMs: 30,
            errorRatePercent: 0.2,
          },
          staging: {
            lifecycle: 'running',
            health: 'passing',
            lastHeartbeatAt: '2026-03-27T10:00:00Z',
            uptimePercent: 99.9,
            averageLatencyMs: 30,
            errorRatePercent: 0.2,
          },
          preview: {
            lifecycle: 'running',
            health: 'passing',
            lastHeartbeatAt: '2026-03-27T10:00:00Z',
            uptimePercent: 99.9,
            averageLatencyMs: 30,
            errorRatePercent: 0.2,
          },
          development: {
            lifecycle: 'running',
            health: 'passing',
            lastHeartbeatAt: '2026-03-27T10:00:00Z',
            uptimePercent: 99.9,
            averageLatencyMs: 30,
            errorRatePercent: 0.2,
          },
        },
      },
    },
    serviceProviders: {
      svc_api: {
        id: 'prov_1',
        projectId: 'prj_1',
        serviceId: 'svc_api',
        type: 'github',
        name: 'GitHub Provider',
        integrationRef: 'github-main',
        defaultConfig: {
          sourceUrl: 'https://github.com/acme/platform.git',
          branch: 'main',
          rootPath: '/',
          buildContext: '.',
          dockerfilePath: 'Dockerfile',
          autoSyncEnabled: true,
          webhookEnabled: true,
          authSecretRef: 'secret://scm/github',
        },
      },
    },
    serviceRunners: {
      svc_api: {
        id: 'run_1',
        projectId: 'prj_1',
        serviceId: 'svc_api',
        type: 'kubernetes',
        name: 'K8s Runner',
        pool: 'default',
        defaultConfig: {
          strategy: 'rolling',
          startCommand: 'bun run start',
          args: [],
          ports: [3000],
          volumeMounts: [],
          secretRefs: [],
          networkMode: 'overlay',
          gracefulShutdownSeconds: 15,
        },
      },
    },
    policyOverrides: {},
    deployments: [],
    incidents: [],
    notifications: [],
  }
}

describe('platformDomainSchemas.dependencyGraphMockScenarioSchema validation', () => {
  it('accepts a valid baseline scenario', () => {
    const scenario = createBaseScenario()
    const result = platformDomainSchemas.dependencyGraphMockScenarioSchema.safeParse(scenario)
    expect(result.success).toBe(true)
  })

  it('rejects unknown execution override environment key', () => {
    const scenario = createBaseScenario()
    const invalidScenario = {
      ...scenario,
      serviceConfigs: {
        ...scenario.serviceConfigs,
        svc_api: {
          ...scenario.serviceConfigs.svc_api,
          executionOverrides: {
            ...scenario.serviceConfigs.svc_api.executionOverrides,
            qa: {
              disabled: true,
            },
          },
        },
      },
    }

    const result = platformDomainSchemas.dependencyGraphMockScenarioSchema.safeParse(invalidScenario)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'serviceConfigs.svc_api.executionOverrides.qa')).toBe(true)
    }
  })

  it('rejects preview override targeting production', () => {
    const scenario = createBaseScenario()
    const invalidScenario = {
      ...scenario,
      serviceConfigs: {
        ...scenario.serviceConfigs,
        svc_api: {
          ...scenario.serviceConfigs.svc_api,
          executionOverrides: {
            ...scenario.serviceConfigs.svc_api.executionOverrides,
            preview: {
              dependencyLinkPolicy: {
                target: {
                  mode: 'fixed-environment',
                  targetEnvironment: 'production',
                },
                provisioning: {
                  provisioningMode: 'shared-service',
                  sharingScope: 'environment',
                  reuseKey: 'preview-shared',
                },
              },
            },
          },
        },
      },
    }

    const result = platformDomainSchemas.dependencyGraphMockScenarioSchema.safeParse(invalidScenario)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join('.') === 'serviceConfigs.svc_api.executionOverrides.preview.dependencyLinkPolicy.target.targetEnvironment'),
      ).toBe(true)
    }
  })

  it('rejects development override fallback to production', () => {
    const scenario = createBaseScenario()
    const invalidScenario = {
      ...scenario,
      serviceConfigs: {
        ...scenario.serviceConfigs,
        svc_api: {
          ...scenario.serviceConfigs.svc_api,
          executionOverrides: {
            ...scenario.serviceConfigs.svc_api.executionOverrides,
            development: {
              dependencyLinkPolicy: {
                target: {
                  mode: 'derived-environment',
                  fromInputKey: 'targetEnv',
                  fallbackEnvironment: 'production',
                },
                provisioning: {
                  provisioningMode: 'on-demand-pool',
                  poolRef: 'db-dev',
                },
              },
            },
          },
        },
      },
    }

    const result = platformDomainSchemas.dependencyGraphMockScenarioSchema.safeParse(invalidScenario)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join('.') === 'serviceConfigs.svc_api.executionOverrides.development.dependencyLinkPolicy.target.fallbackEnvironment'),
      ).toBe(true)
    }
  })

  it('rejects fixed target environment that does not exist', () => {
    const scenario = createBaseScenario()
    const invalidScenario = {
      ...scenario,
      serviceConfigs: {
        ...scenario.serviceConfigs,
        svc_api: {
          ...scenario.serviceConfigs.svc_api,
          executionOverrides: {
            ...scenario.serviceConfigs.svc_api.executionOverrides,
            preview: {
              dependencyLinkPolicy: {
                target: {
                  mode: 'fixed-environment',
                  targetEnvironment: 'qa',
                },
                provisioning: {
                  provisioningMode: 'shared-service',
                  sharingScope: 'environment',
                  reuseKey: 'preview-shared',
                },
              },
            },
          },
        },
      },
    }

    const result = platformDomainSchemas.dependencyGraphMockScenarioSchema.safeParse(invalidScenario)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join('.') === 'serviceConfigs.svc_api.executionOverrides.preview.dependencyLinkPolicy.target.targetEnvironment'),
      ).toBe(true)
    }
  })
})
