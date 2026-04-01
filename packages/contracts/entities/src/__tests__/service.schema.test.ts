import { describe, expect, it } from 'vitest'
import { serviceSchema } from '../entities/service.schema'

describe('service schema validation', () => {
  const baseService = {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    name: 'api',
    description: null,
    type: 'web',
    providerId: 'github' as const,
    providerConfig: {
      sourceUrl: 'https://github.com/acme/repo.git',
      branch: 'main',
      rootPath: '/',
      buildContext: '.',
      dockerfilePath: 'Dockerfile',
      autoSyncEnabled: true,
      webhookEnabled: true,
      authSecretRef: 'secret://github/token',
    },
    builderId: 'kubernetes' as const,
    builderConfig: {
      strategy: 'rolling',
      startCommand: 'bun run start',
      args: [],
      ports: [3000],
      volumeMounts: [],
      secretRefs: [],
      networkMode: 'overlay',
      gracefulShutdownSeconds: 15,
    },
    port: 3000,
    environmentVariables: null,
    resourceLimits: null,
    healthCheckPath: '/health',
    healthCheckInterval: 15,
    healthCheckTimeout: 5,
    healthCheckRetries: 3,
    deploymentRetention: null,
    traefikConfig: null,
    customDomains: null,
    isActive: true,
    metadata: null,
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
  }

  it('accepts matching providerId/providerConfig and builderId/builderConfig', () => {
    const result = serviceSchema.safeParse(baseService)
    expect(result.success).toBe(true)
  })

  it('rejects mismatched providerConfig for artifact-bundle', () => {
    const result = serviceSchema.safeParse({
      ...baseService,
      providerId: 'artifact-bundle',
      providerConfig: {
        ...baseService.providerConfig,
        image: undefined,
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'providerConfig')).toBe(true)
    }
  })

  it('rejects mismatched static builderConfig strategy', () => {
    const result = serviceSchema.safeParse({
      ...baseService,
      builderId: 'static',
      builderConfig: {
        ...baseService.builderConfig,
        strategy: 'rolling',
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'builderConfig')).toBe(true)
    }
  })
})
