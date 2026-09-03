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

  it('accepts the flat project settings storage shape', () => {
    const result = projectSettingsSchema.safeParse({
      defaultBranch: 'main',
      autoDeployEnabled: true,
      enablePreviewEnvironments: true,
      defaultEnvironmentVariables: { NODE_ENV: 'production' },
      productionEnvironmentVariables: { NODE_ENV: 'production' },
      autoCleanupDays: 30,
      maxPreviewEnvironments: 10,
      deploymentStrategy: 'rolling',
      healthCheckTimeout: 30,
      deploymentTimeout: 600,
      enableRollback: true,
      requireApprovalForProduction: true,
      enableHttpsRedirect: true,
      allowedDomains: [],
      ipWhitelist: [],
      enableBasicAuth: false,
      defaultCpuLimit: '500m',
      defaultMemoryLimit: '512Mi',
      defaultStorageLimit: '1Gi',
      maxServicesPerProject: 20,
      enableEmailNotifications: true,
      enableSlackNotifications: false,
      emailRecipients: ['team@example.com'],
      notifyOnDeploymentSuccess: true,
      notifyOnDeploymentFailure: true,
      notifyOnServiceDown: true,
    })

    expect(result.success).toBe(true)
  })

  it('accepts a partial settings blob (subset of keys)', () => {
    const result = projectSettingsSchema.safeParse({
      enableRollback: true,
      emailRecipients: [],
      healthCheckTimeout: 60,
      enableSlackNotifications: false,
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
