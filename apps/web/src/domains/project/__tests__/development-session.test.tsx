import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDevelopmentSessionPlanner } from '../development-session'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const SERVICES = [
  { id: 'svc-web', name: 'web', type: 'web', runtime: 'node' },
  { id: 'svc-worker', name: 'worker', type: 'worker', runtime: 'node' },
  { id: 'svc-db', name: 'db', type: 'database', runtime: 'postgresql' },
] as const

describe('useDevelopmentSessionPlanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('initializes execution policies and stats from service metadata', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    expect(result.current.developmentServicePoliciesById['svc-web']?.executionLocation).toBe('local')
    expect(result.current.developmentServicePoliciesById['svc-worker']?.executionLocation).toBe('cloud')
    expect(result.current.developmentServicePoliciesById['svc-db']?.executionLocation).toBe('dependency-managed')

    expect(result.current.developmentExecutionStats.local).toBe(1)
    expect(result.current.developmentExecutionStats.cloud).toBe(1)
    expect(result.current.developmentExecutionStats.dependencyManaged).toBe(1)
    expect(result.current.developmentExecutionStats.tokenRequired).toBe(2)
    expect(result.current.developmentSessionLifecyclePhase).toBe('requested')
    expect(result.current.developmentSessionActionGuards.canStart).toBe(false)
    expect(result.current.developmentSessionActionGuards.nextActionHint).toContain('Provide a development token')
  })

  it('detects and normalizes policy conflicts', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    act(() => {
      result.current.setServiceExecutionLocation('svc-web', 'local')
      result.current.setServiceDependencyHandling('svc-web', 'reuse-shared-preview')
      result.current.setServiceExecutionLocation('svc-worker', 'cloud')
      result.current.setServiceDependencyHandling('svc-worker', 'strict-local-only')
    })

    expect(result.current.developmentPolicyConflicts.length).toBe(3)

    act(() => {
      result.current.normalizeDevelopmentPolicies()
    })

    expect(result.current.developmentPolicyConflicts.length).toBe(0)
    expect(result.current.developmentServicePoliciesById['svc-web']?.dependencyHandling).toBe('auto-resolve-preview')
    expect(result.current.developmentServicePoliciesById['svc-worker']?.dependencyHandling).toBe('reuse-shared-preview')
  })

  it('blocks session start when development is disabled', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: false,
      }),
    )

    act(() => {
      result.current.startDevelopmentSession()
    })

    expect(result.current.developmentSessionState).toBe('idle')
  })

  it('blocks session start when token is required but missing', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    act(() => {
      result.current.startDevelopmentSession()
    })

    expect(result.current.developmentSessionState).toBe('error')
    expect(result.current.developmentSessionLastError).toContain('development token is required')
    expect(result.current.developmentSessionLifecyclePhase).toBe('requested')
    expect(result.current.developmentSessionTimeline[0]?.state).toBe('error')
    expect(result.current.developmentSessionTimeline[0]?.message).toContain('development token is required')
  })

  it('starts and stops session when policies are valid and token is present', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    act(() => {
      result.current.setServiceDependencyHandling('svc-db', 'reuse-shared-preview')
    })

    act(() => {
      result.current.setDevelopmentConnectionToken('devtok_valid')
    })

    act(() => {
      result.current.startDevelopmentSession()
    })

    expect(result.current.developmentSessionState).toBe('starting')
    expect(result.current.developmentSessionLifecyclePhase).toBe('provisioning')

    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(result.current.developmentSessionState).toBe('running')
    expect(result.current.developmentSessionLifecyclePhase).toBe('running')
    expect(result.current.developmentSessionStartedAt).not.toBeNull()

    act(() => {
      result.current.stopDevelopmentSession()
    })

    expect(result.current.developmentSessionState).toBe('stopping')
    expect(result.current.developmentSessionLifecyclePhase).toBe('stopping')

    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(result.current.developmentSessionState).toBe('stopped')
    expect(result.current.developmentSessionLifecyclePhase).toBe('stopped')
    expect(result.current.developmentSessionTimeline[0]?.state).toBe('stopped')
    expect(result.current.developmentSessionTimeline[1]?.state).toBe('stopping')
    expect(result.current.developmentSessionTimeline[2]?.state).toBe('running')
    expect(result.current.developmentSessionTimeline[3]?.state).toBe('starting')
  })

  it('supports degraded and recovery transitions', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    act(() => {
      result.current.setServiceDependencyHandling('svc-db', 'reuse-shared-preview')
    })

    act(() => {
      result.current.setDevelopmentConnectionToken('devtok_valid')
    })

    act(() => {
      result.current.startDevelopmentSession()
    })

    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect(result.current.developmentSessionState).toBe('running')

    act(() => {
      result.current.markDevelopmentSessionDegraded('Synthetic dependency failure')
    })

    expect(result.current.developmentSessionState).toBe('degraded')
    expect(result.current.developmentSessionLifecyclePhase).toBe('degraded')
    expect(result.current.developmentSessionLastError).toContain('Synthetic dependency failure')
    expect(result.current.developmentSessionTimeline[0]?.state).toBe('degraded')

    act(() => {
      result.current.recoverDevelopmentSession()
    })

    expect(result.current.developmentSessionState).toBe('running')
    expect(result.current.developmentSessionLifecyclePhase).toBe('running')
    expect(result.current.developmentSessionLastError).toBeNull()
    expect(result.current.developmentSessionTimeline[0]?.state).toBe('running')
    expect(result.current.developmentSessionTimeline[0]?.message).toContain('recovered')
  })

  it('computes actionable guards when planner becomes start-ready', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    expect(result.current.developmentSessionActionGuards.canStart).toBe(false)

    act(() => {
      result.current.setServiceDependencyHandling('svc-db', 'reuse-shared-preview')
      result.current.setDevelopmentConnectionToken('devtok_valid')
    })

    expect(result.current.developmentPolicyConflicts.length).toBe(0)
    expect(result.current.developmentSessionActionGuards.canStart).toBe(true)
    expect(result.current.developmentSessionActionGuards.nextActionHint).toContain('Ready to start')
  })

  it('computes degraded-phase action guards', () => {
    const { result } = renderHook(() =>
      useDevelopmentSessionPlanner({
        services: [...SERVICES],
        developmentEnabled: true,
      }),
    )

    act(() => {
      result.current.setServiceDependencyHandling('svc-db', 'reuse-shared-preview')
    })

    act(() => {
      result.current.setDevelopmentConnectionToken('devtok_valid')
    })

    act(() => {
      result.current.startDevelopmentSession()
    })

    act(() => {
      vi.advanceTimersByTime(160)
    })

    act(() => {
      result.current.markDevelopmentSessionDegraded('Synthetic dependency failure')
    })

    expect(result.current.developmentSessionActionGuards.canRecover).toBe(true)
    expect(result.current.developmentSessionActionGuards.canStop).toBe(true)
    expect(result.current.developmentSessionActionGuards.canMarkDegraded).toBe(false)
    expect(result.current.developmentSessionActionGuards.nextActionHint).toContain('Recover or stop')
  })
})
