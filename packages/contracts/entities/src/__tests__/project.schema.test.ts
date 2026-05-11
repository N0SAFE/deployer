import { describe, expect, it } from 'vitest'
import {
  projectEnvironmentSettingsSchema,
  projectSettingsSchema,
} from '../entities/project'

describe('project schema validation', () => {
  const baseEnvironment = {
    variables: {},
    autoDeployEnabled: true,
    deploymentStrategy: 'rolling' as const,
    healthGate: 'strict' as const,
    startupMode: 'before' as const,
    replicas: { min: 1, max: 2 },
    trafficPolicy: {
      maxErrorRatePercent: 2,
      maxLatencyMs: 200,
      allowCrossRegionFailover: false,
    },
  }

  it('accepts consistent production/preview/development enablement flags', () => {
    const result = projectSettingsSchema.safeParse({
      general: {
        defaultBranch: 'main',
        autoDeployEnabled: true,
        enablePreviewEnvironments: true,
      },
      environment: {
        previewEnabled: true,
        developmentEnabled: true,
        defaultEnvironmentVariables: {},
        environments: {
          production: baseEnvironment,
          preview: baseEnvironment,
          development: baseEnvironment,
        },
      },
      deployment: {
        autoCleanupDays: 30,
        maxPreviewEnvironments: 10,
        deploymentStrategy: 'rolling',
        healthCheckTimeout: 30,
        deploymentTimeout: 600,
        enableRollback: true,
        requireApprovalForProduction: true,
      },
      security: {
        enableHttpsRedirect: true,
        allowedDomains: [],
        ipWhitelist: [],
        enableBasicAuth: false,
      },
      resource: {
        defaultCpuLimit: '500m',
        defaultMemoryLimit: '512Mi',
        defaultStorageLimit: '1Gi',
        maxServicesPerProject: 20,
      },
      notification: {
        enableEmailNotifications: true,
        enableSlackNotifications: false,
        emailRecipients: ['team@example.com'],
        notifyOnDeploymentSuccess: true,
        notifyOnDeploymentFailure: true,
        notifyOnServiceDown: true,
      },
    })

    expect(result.success).toBe(true)
  })

  it('rejects previewEnabled mismatch with missing preview environment', () => {
    const result = projectEnvironmentSettingsSchema.safeParse({
      previewEnabled: true,
      developmentEnabled: false,
      defaultEnvironmentVariables: {},
      environments: {
        production: baseEnvironment,
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'previewEnabled')).toBe(true)
    }
  })

  it('rejects developmentEnabled mismatch with missing development environment', () => {
    const result = projectEnvironmentSettingsSchema.safeParse({
      previewEnabled: false,
      developmentEnabled: true,
      defaultEnvironmentVariables: {},
      environments: {
        production: baseEnvironment,
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'developmentEnabled')).toBe(true)
    }
  })
})
