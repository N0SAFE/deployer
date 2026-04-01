import { describe, expect, it } from 'vitest'
import { providersCatalog, buildersCatalog } from '@repo/provider-schema/catalog'
import {
  templateVersionSchema,
  templateCreateInputSchema,
  templateCompatibilityValidationInputSchema,
  templateUpdateInputSchema,
  templateMigrationDirectionSchema,
  templateVersionMigrationPreviewInputSchema,
} from '../entities/template.schema'

const providerId = providersCatalog[0]?.id
const builderId = buildersCatalog[0]?.id

if (!providerId || !builderId) {
  throw new Error('Provider and builder catalogs must be non-empty for template schema tests.')
}

describe('template schema exhaustive validation', () => {
  describe('templateVersionSchema', () => {
    it.each([
      ['1.0.0', true],
      ['2.3.4-alpha', true],
      ['3.2.1+build.4', true],
      ['v1', false],
      ['1.0', false],
      ['latest', false],
    ])('validates semver %s', (value, expected) => {
      expect(templateVersionSchema.safeParse(value).success).toBe(expected)
    })
  })

  describe('templateCreateInputSchema discriminated branches', () => {
    const base = {
      key: 'tpl-key',
      name: 'Template Name',
      scope: 'project' as const,
      version: '1.0.0',
      status: 'draft' as const,
      isSystem: false,
    }

    it('accepts provider kind branch', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'provider',
        config: {
          provider: providerId,
          defaultBranch: 'main',
          webhookEvents: ['push'],
          supportsPreview: true,
          secretRefs: [],
        },
      })
      expect(result.success).toBe(true)
    })

    it('accepts build kind branch', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'build',
        config: {
          strategy: 'dockerfile',
          contextDir: '.',
          cacheEnabled: true,
          envAllowlist: [],
        },
      })
      expect(result.success).toBe(true)
    })

    it('accepts deploy kind branch', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'deploy',
        config: {
          strategy: 'rolling',
          maxUnavailable: 1,
          maxSurge: 1,
          healthCheckPath: '/health',
          healthCheckTimeoutSec: 60,
          deploymentTimeoutSec: 600,
          rollbackOnFailure: true,
        },
      })
      expect(result.success).toBe(true)
    })

    it('accepts route kind branch', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'route',
        config: {
          hostPattern: '*.example.com',
          entrypoints: ['websecure'],
          tlsEnabled: true,
          tlsResolver: 'letsencrypt',
          middlewares: [],
          healthProbeEnabled: true,
        },
      })
      expect(result.success).toBe(true)
    })

    it('accepts preview kind branch', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'preview',
        config: {
          urlPattern: '{branch}.preview.example.com',
          namingStrategy: 'branch_hash',
          ttlHours: 24,
          autoDeleteOnMerge: true,
          autoDeleteOnClose: true,
          envOverlayStrategy: 'merge',
        },
      })
      expect(result.success).toBe(true)
    })

    it('accepts dependency kind branch', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'dependency',
        config: {
          orderingStrategy: 'topological',
          rolloutMode: 'ordered',
          gateOnDependencyHealth: true,
          retryPolicy: {
            maxAttempts: 3,
            backoffMs: 2000,
          },
          failureIsolation: 'service',
        },
      })
      expect(result.success).toBe(true)
    })

    it('rejects mismatched kind/config pair', () => {
      const result = templateCreateInputSchema.safeParse({
        ...base,
        kind: 'provider',
        config: {
          strategy: 'dockerfile',
          contextDir: '.',
          cacheEnabled: true,
          envAllowlist: [],
        },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('compatibility + migration inputs', () => {
    it('accepts valid compatibility validation input', () => {
      const result = templateCompatibilityValidationInputSchema.safeParse({
        provider: providerId,
        buildStrategy: builderId,
        deployStrategy: 'rolling',
        environment: 'preview',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid update id', () => {
      const result = templateUpdateInputSchema.safeParse({
        id: 'not-a-uuid',
        name: 'updated',
      })
      expect(result.success).toBe(false)
    })

    it.each([
      ['up', true],
      ['down', true],
      ['sideways', false],
    ])('validates migration direction %s', (value, expected) => {
      expect(templateMigrationDirectionSchema.safeParse(value).success).toBe(expected)
    })

    it('rejects migration preview input with invalid source version', () => {
      const result = templateVersionMigrationPreviewInputSchema.safeParse({
        templateId: '11111111-1111-4111-8111-111111111111',
        kind: 'deploy',
        direction: 'up',
        sourceVersion: 'bad',
        targetVersion: '1.1.0',
        sourceConfig: {
          strategy: 'rolling',
          maxUnavailable: 1,
          maxSurge: 1,
          healthCheckPath: '/health',
          healthCheckTimeoutSec: 60,
          deploymentTimeoutSec: 600,
          rollbackOnFailure: true,
        },
      })
      expect(result.success).toBe(false)
    })
  })
})
