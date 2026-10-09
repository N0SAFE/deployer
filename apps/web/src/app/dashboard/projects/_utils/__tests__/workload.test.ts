import { describe, expect, it } from 'vitest'
import {
  deploymentDurationMs, findRollbackTarget, formatDuration, formatRelative, isInProgress, latestBy, summarizeDeployments,
} from '../workload'

describe('workload helpers', () => {
  it('knows in-progress statuses', () => {
    expect(isInProgress('building')).toBe(true)
    expect(isInProgress('success')).toBe(false)
    expect(isInProgress('in-progress')).toBe(false)
  })

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(185_000)).toBe('3m 05s')
    expect(formatDuration(7_800_000)).toBe('2h 10m')
  })

  it('formats relative times', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    expect(formatRelative('2026-10-09T11:59:50Z', now)).toBe('just now')
    expect(formatRelative('2026-10-09T11:57:00Z', now)).toBe('3 min ago')
    expect(formatRelative('2026-10-09T09:00:00Z', now)).toBe('3 h ago')
    expect(formatRelative('2026-10-04T12:00:00Z', now)).toBe('5 d ago')
    expect(formatRelative(null, now)).toBe('—')
    expect(formatRelative('garbage', now)).toBe('—')
  })

  it('computes deployment duration', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    expect(deploymentDurationMs({ buildStartedAt: '2026-10-09T11:00:00Z', deployCompletedAt: '2026-10-09T11:02:00Z' }, 'success', now)).toBe(120_000)
    expect(deploymentDurationMs({ createdAt: '2026-10-09T11:59:00Z' }, 'building', now)).toBe(60_000)
    expect(deploymentDurationMs({ createdAt: '2026-10-09T11:59:00Z' }, 'failed', now)).toBeNull()
  })

  it('summarises without inventing a success rate', () => {
    expect(summarizeDeployments([])).toEqual({ total: 0, success: 0, failed: 0, inProgress: 0, successRate: null })
    const s = summarizeDeployments([{ status: 'success' }, { status: 'failed' }, { status: 'queued' }, { status: 'success' }])
    expect(s.inProgress).toBe(1)
    expect(s.successRate).toBe(66.7)
  })

  it('finds the previous successful deployment of the same service and environment', () => {
    const list = [
      { id: 'a', serviceId: 's', environment: 'production', status: 'success', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'b', serviceId: 's', environment: 'production', status: 'success', createdAt: '2026-10-03T00:00:00Z' },
      { id: 'c', serviceId: 's', environment: 'staging', status: 'success', createdAt: '2026-10-04T00:00:00Z' },
      { id: 'd', serviceId: 's', environment: 'production', status: 'failed', createdAt: '2026-10-05T00:00:00Z' },
    ]
    const [first, , , failed] = list
    if (!first || !failed) throw new Error('fixture')
    expect(findRollbackTarget(list, failed)?.id).toBe('b')
    expect(findRollbackTarget(list, first)).toBeNull()
  })

  it('keeps the latest per key', () => {
    const m = latestBy(
      [{ s: 'x', createdAt: '2026-10-01' }, { s: 'x', createdAt: '2026-10-03' }, { s: 'y', createdAt: '2026-10-02' }],
      (i) => i.s,
    )
    expect(m.get('x')?.createdAt).toBe('2026-10-03')
    expect(m.size).toBe(2)
  })
})
