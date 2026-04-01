import type { ProjectConfiguration } from '../types'

const BASE_CONFIGURATION: Omit<ProjectConfiguration, 'general' | 'environment'> = {
  deployment: {
    deploymentStrategy: 'canary',
    canaryStepsPercent: [5, 20, 50, 100],
    healthCheckTimeoutSeconds: 90,
    rollbackWindowSeconds: 600,
    maxParallelServiceDeployments: 4,
    requireManualApprovalFor: ['production', 'hotfix'],
  },
  security: {
    enableHttpsRedirect: true,
    mTLSInternalTraffic: true,
    zeroTrustPoliciesEnabled: true,
    allowedIngressCidrs: ['10.12.0.0/16', '10.13.0.0/16'],
    ssoProviders: ['okta', 'github-enterprise'],
  },
  resource: {
    defaultCpuLimit: '1000m',
    defaultMemoryLimit: '1024Mi',
    maxServiceReplicas: 12,
    autoscaling: {
      enabled: true,
      targetCpuPercent: 65,
      targetMemoryPercent: 75,
    },
    storage: {
      defaultVolumeClass: 'ssd-replicated',
      backupRetentionDays: 14,
    },
  },
  notification: {
    enableEmailNotifications: true,
    enableSlackNotifications: true,
    slackChannels: ['#deployments', '#incident-ops', '#platform-alerts'],
    notifyOnDeploymentFailure: true,
    notifyOnCriticalDependencyFailure: true,
    notifyOnPolicyDrift: true,
  },
}

export const MOCK_PROJECT_CONFIGURATIONS: Record<string, ProjectConfiguration> = {
  'proj-orion-control-plane': {
    general: {
      projectName: 'Orion Commerce Mesh',
      defaultBranch: 'main',
      autoDeployEnabled: true,
      reviewAppsEnabled: true,
      ownerTeam: 'platform-core',
      releasePolicy: {
        cadence: 'daily',
        freezeWindowUtc: 'Fri 20:00 - Sun 23:00',
        progressiveRollout: true,
      },
    },
    environment: {
      previewEnabled: true,
      developmentEnabled: true,
      extensionConfig: {
        preview: {
          extends: 'production',
          overrides: {
            deploymentStrategy: 'rolling',
            healthGate: 'warn',
            startupMode: 'parallel',
            replicas: { min: 0, max: 3 },
          },
        },
        development: {
          extends: 'production',
          overrides: {
            autoDeployEnabled: false,
            deploymentStrategy: 'manual',
            healthGate: 'ignore',
            startupMode: 'after',
            replicas: { min: 0, max: 2 },
          },
        },
      },
      defaultVariables: {
        LOG_LEVEL: 'info',
        FEATURE_FLAG_MESH_GUARDS: 'true',
        METRICS_EXPORT_INTERVAL_MS: '10000',
      },
      environments: {
        production: {
          variables: {
            LOG_LEVEL: 'warn',
            NODE_ENV: 'production',
            ENABLE_CANARY_EVALUATION: 'true',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'canary',
          healthGate: 'strict',
          startupMode: 'before',
          replicas: { min: 3, max: 12 },
          trafficPolicy: {
            maxErrorRatePercent: 0.8,
            maxLatencyMs: 120,
            allowCrossRegionFailover: false,
          },
        },
        preview: {
          variables: {
            AUTO_SCALE_MIN: '0',
            AUTO_SCALE_MAX: '3',
            ENABLE_PER_PR_SANDBOX: 'true',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'rolling',
          healthGate: 'warn',
          startupMode: 'parallel',
          replicas: { min: 0, max: 3 },
          trafficPolicy: {
            maxErrorRatePercent: 3,
            maxLatencyMs: 300,
            allowCrossRegionFailover: true,
          },
        },
        development: {
          variables: {
            LOG_LEVEL: 'debug',
            ENABLE_DEV_SHORTCUTS: 'true',
          },
          autoDeployEnabled: false,
          deploymentStrategy: 'manual',
          healthGate: 'ignore',
          startupMode: 'after',
          replicas: { min: 0, max: 2 },
          trafficPolicy: {
            maxErrorRatePercent: 10,
            maxLatencyMs: 600,
            allowCrossRegionFailover: true,
          },
        },
      },
    },
    ...BASE_CONFIGURATION,
  },

  'proj-phoenix-stream': {
    general: {
      projectName: 'Phoenix Media Pipeline',
      defaultBranch: 'main',
      autoDeployEnabled: true,
      reviewAppsEnabled: true,
      ownerTeam: 'commerce-domain',
      releasePolicy: {
        cadence: 'hourly',
        freezeWindowUtc: 'Sat 00:00 - Sat 06:00',
        progressiveRollout: true,
      },
    },
    environment: {
      previewEnabled: true,
      developmentEnabled: true,
      extensionConfig: {
        preview: {
          extends: 'production',
          overrides: {
            deploymentStrategy: 'rolling',
            healthGate: 'warn',
            startupMode: 'parallel',
            replicas: { min: 0, max: 3 },
          },
        },
        development: {
          extends: 'production',
          overrides: {
            autoDeployEnabled: false,
            deploymentStrategy: 'manual',
            healthGate: 'ignore',
            startupMode: 'after',
            replicas: { min: 0, max: 2 },
          },
        },
      },
      defaultVariables: {
        STREAM_CHUNK_SIZE_MB: '8',
        ENABLE_TRANSCODE_PARALLELISM: 'true',
      },
      environments: {
        production: {
          variables: {
            STREAM_CHUNK_SIZE_MB: '16',
            CDN_CACHE_TTL_SECONDS: '1800',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'canary',
          healthGate: 'strict',
          startupMode: 'before',
          replicas: { min: 4, max: 16 },
          trafficPolicy: {
            maxErrorRatePercent: 1,
            maxLatencyMs: 180,
            allowCrossRegionFailover: false,
          },
        },
        preview: {
          variables: {
            STREAM_CHUNK_SIZE_MB: '4',
            ENABLE_LOW_COST_PROFILE: 'true',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'rolling',
          healthGate: 'warn',
          startupMode: 'parallel',
          replicas: { min: 0, max: 3 },
          trafficPolicy: {
            maxErrorRatePercent: 4,
            maxLatencyMs: 350,
            allowCrossRegionFailover: true,
          },
        },
        development: {
          variables: {
            ENABLE_LOCAL_TRANSCODE_STUB: 'true',
          },
          autoDeployEnabled: false,
          deploymentStrategy: 'manual',
          healthGate: 'ignore',
          startupMode: 'after',
          replicas: { min: 0, max: 2 },
          trafficPolicy: {
            maxErrorRatePercent: 12,
            maxLatencyMs: 700,
            allowCrossRegionFailover: true,
          },
        },
      },
    },
    ...BASE_CONFIGURATION,
  },

  'proj-atlas-billing': {
    general: {
      projectName: 'Atlas Billing Engine',
      defaultBranch: 'main',
      autoDeployEnabled: true,
      reviewAppsEnabled: false,
      ownerTeam: 'finops',
      releasePolicy: {
        cadence: 'weekly',
        freezeWindowUtc: 'Fri 18:00 - Mon 06:00',
        progressiveRollout: true,
      },
    },
    environment: {
      previewEnabled: false,
      developmentEnabled: true,
      extensionConfig: {
        development: {
          extends: 'production',
          overrides: {
            autoDeployEnabled: false,
            deploymentStrategy: 'manual',
            healthGate: 'ignore',
            startupMode: 'after',
            replicas: { min: 0, max: 2 },
          },
        },
      },
      defaultVariables: {
        INVOICE_BATCH_LIMIT: '250',
        ENABLE_DUNNING_AUTOMATION: 'true',
      },
      environments: {
        production: {
          variables: {
            INVOICE_BATCH_LIMIT: '1000',
            PAYMENT_GATEWAY_TIMEOUT_MS: '8000',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'blue-green',
          healthGate: 'strict',
          startupMode: 'before',
          replicas: { min: 2, max: 6 },
          trafficPolicy: {
            maxErrorRatePercent: 0.4,
            maxLatencyMs: 100,
            allowCrossRegionFailover: false,
          },
        },
        development: {
          variables: {
            ENABLE_PAYMENT_SANDBOX: 'true',
          },
          autoDeployEnabled: false,
          deploymentStrategy: 'manual',
          healthGate: 'ignore',
          startupMode: 'after',
          replicas: { min: 0, max: 2 },
          trafficPolicy: {
            maxErrorRatePercent: 10,
            maxLatencyMs: 500,
            allowCrossRegionFailover: true,
          },
        },
      },
    },
    ...BASE_CONFIGURATION,
  },

  'proj-nebula-mlops': {
    general: {
      projectName: 'Nebula MLOps Runtime',
      defaultBranch: 'main',
      autoDeployEnabled: true,
      reviewAppsEnabled: true,
      ownerTeam: 'mlops',
      releasePolicy: {
        cadence: 'on-demand',
        freezeWindowUtc: 'none',
        progressiveRollout: false,
      },
    },
    environment: {
      previewEnabled: true,
      developmentEnabled: true,
      extensionConfig: {
        preview: {
          extends: 'production',
          overrides: {
            deploymentStrategy: 'rolling',
            healthGate: 'warn',
            startupMode: 'parallel',
            replicas: { min: 0, max: 2 },
          },
        },
        development: {
          extends: 'production',
          overrides: {
            autoDeployEnabled: false,
            deploymentStrategy: 'manual',
            healthGate: 'ignore',
            startupMode: 'after',
            replicas: { min: 0, max: 2 },
          },
        },
      },
      defaultVariables: {
        MODEL_REGISTRY_CACHE_TTL: '300',
        FEATURE_SYNC_WINDOW_MINUTES: '30',
      },
      environments: {
        production: {
          variables: {
            ONLINE_FEATURE_TIMEOUT_MS: '35',
            MAX_INFERENCE_CONCURRENCY: '1200',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'canary',
          healthGate: 'strict',
          startupMode: 'before',
          replicas: { min: 3, max: 14 },
          trafficPolicy: {
            maxErrorRatePercent: 1.2,
            maxLatencyMs: 140,
            allowCrossRegionFailover: false,
          },
        },
        preview: {
          variables: {
            MAX_INFERENCE_CONCURRENCY: '200',
          },
          autoDeployEnabled: true,
          deploymentStrategy: 'rolling',
          healthGate: 'warn',
          startupMode: 'parallel',
          replicas: { min: 0, max: 2 },
          trafficPolicy: {
            maxErrorRatePercent: 5,
            maxLatencyMs: 420,
            allowCrossRegionFailover: true,
          },
        },
        development: {
          variables: {
            ENABLE_LOCAL_FEATURE_SIM: 'true',
          },
          autoDeployEnabled: false,
          deploymentStrategy: 'manual',
          healthGate: 'ignore',
          startupMode: 'after',
          replicas: { min: 0, max: 2 },
          trafficPolicy: {
            maxErrorRatePercent: 15,
            maxLatencyMs: 800,
            allowCrossRegionFailover: true,
          },
        },
      },
    },
    ...BASE_CONFIGURATION,
  },
}