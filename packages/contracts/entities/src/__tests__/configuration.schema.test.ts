import { describe, expect, it } from 'vitest'
import {
  serviceDependencyLinkPolicySchema,
  serviceEnvironmentExecutionOverrideByEnvSchema,
  serviceEnvironmentExecutionOverrideSchema,
} from '../entities/configuration.schema'

describe('serviceEnvironmentExecutionOverrideByEnvSchema - preview/development guardrails', () => {
  it('rejects preview fixed-environment targeting production', () => {
    const result = serviceEnvironmentExecutionOverrideByEnvSchema.safeParse({
      preview: {
        dependencyLinkPolicy: {
          target: {
            mode: 'fixed-environment',
            targetEnvironment: 'production',
          },
          provisioning: {
            provisioningMode: 'shared-service',
            sharingScope: 'environment',
            reuseKey: 'preview-db',
          },
        },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'preview.dependencyLinkPolicy.target.targetEnvironment')).toBe(true)
    }
  })

  it('rejects development derived-environment fallback to production', () => {
    const result = serviceEnvironmentExecutionOverrideByEnvSchema.safeParse({
      development: {
        dependencyLinkPolicy: {
          target: {
            mode: 'derived-environment',
            fromInputKey: 'runtimeTargetEnv',
            fallbackEnvironment: 'production',
          },
          provisioning: {
            provisioningMode: 'on-demand-pool',
            poolRef: 'db-preview-pool',
          },
        },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'development.dependencyLinkPolicy.target.fallbackEnvironment')).toBe(true)
    }
  })

  it('accepts preview fixed-environment targeting staging', () => {
    const result = serviceEnvironmentExecutionOverrideByEnvSchema.safeParse({
      preview: {
        dependencyLinkPolicy: {
          target: {
            mode: 'fixed-environment',
            targetEnvironment: 'staging',
          },
          provisioning: {
            provisioningMode: 'shared-service',
            sharingScope: 'environment',
            reuseKey: 'preview-db:staging',
          },
        },
      },
    })

    expect(result.success).toBe(true)
  })
})

describe('serviceEnvironmentExecutionOverrideSchema - target selection strategy and filter conditions', () => {
  const baseDependencyBehavior = {
    requirement: 'required' as const,
    healthGate: 'must-pass' as const,
    startupMode: 'before' as const,
    attachmentMode: 'single-target' as const,
  }

  it('rejects direct-only strategy without directServiceId', () => {
    const result = serviceEnvironmentExecutionOverrideSchema.safeParse({
      dependencyBehavior: {
        ...baseDependencyBehavior,
        targetSelection: {
          strategy: 'direct-only',
        },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'dependencyBehavior.targetSelection.directServiceId')).toBe(true)
    }
  })

  it('rejects filter-first strategy without filter', () => {
    const result = serviceEnvironmentExecutionOverrideSchema.safeParse({
      dependencyBehavior: {
        ...baseDependencyBehavior,
        targetSelection: {
          strategy: 'filter-first',
        },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'dependencyBehavior.targetSelection.filter')).toBe(true)
    }
  })

  it('rejects isNull operator with a value', () => {
    const result = serviceEnvironmentExecutionOverrideSchema.safeParse({
      dependencyBehavior: {
        ...baseDependencyBehavior,
        targetSelection: {
          strategy: 'filter-first',
          filter: {
            source: 'runtime-input',
            key: 'env',
            operator: 'isNull',
            value: 'preview',
          },
        },
      },
    })

    expect(result.success).toBe(false)
  })

  it('accepts preferred-then-filter with directServiceId only', () => {
    const result = serviceEnvironmentExecutionOverrideSchema.safeParse({
      dependencyBehavior: {
        ...baseDependencyBehavior,
        targetSelection: {
          strategy: 'preferred-then-filter',
          directServiceId: 'svc-db',
        },
      },
    })

    expect(result.success).toBe(true)
  })
})

describe('serviceDependencyLinkPolicySchema - existing incompatible combinations', () => {
  it('rejects same-environment + shared-service + organization scope', () => {
    const result = serviceDependencyLinkPolicySchema.safeParse({
      target: { mode: 'same-environment' },
      provisioning: {
        provisioningMode: 'shared-service',
        sharingScope: 'organization',
        reuseKey: 'org-wide',
      },
    })

    expect(result.success).toBe(false)
  })
})
