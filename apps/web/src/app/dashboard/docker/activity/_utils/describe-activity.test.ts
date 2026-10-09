import { describe, expect, it } from 'vitest'
import { activityKind, describeActivity } from './describe-activity'
import { mergeActivities } from './merge-activities'

describe('describeActivity', () => {
  it('turns action codes into sentences', () => {
    expect(describeActivity({ source: 'container', action: 'stop', resourceName: 'web-1' })).toBe('Container web-1 stopped')
    expect(describeActivity({ source: 'container', action: 'die', resourceName: 'web-1' })).toBe('Container web-1 exited')
    expect(describeActivity({ source: 'image', action: 'pull', resourceName: 'nginx:1' })).toBe('Image nginx:1 was pulled')
    expect(describeActivity({ source: 'network', action: 'connect', resourceName: 'app' })).toBe('Network app had a container connected')
  })
  it('handles detail suffixes', () => {
    expect(describeActivity({ source: 'container', action: 'health_status: unhealthy', resourceName: 'db' })).toBe('Container db health check: unhealthy')
    expect(describeActivity({ source: 'container', action: 'exec_start: sh -c ls', resourceName: 'db' })).toBe('Container db ran a command: sh -c ls')
  })
  it('never shows a raw code for unknown actions', () => {
    expect(describeActivity({ source: 'config', action: 'rotate_all', resourceName: 'c1' })).toBe('Config c1: rotate all')
  })
})

describe('activityKind', () => {
  it('groups orchestrator sources under swarm', () => {
    expect(activityKind('task')).toBe('swarm')
    expect(activityKind('container')).toBe('container')
    expect(activityKind('plugin')).toBe('other')
  })
})

describe('mergeActivities', () => {
  const a = { id: '1', occurredAt: '2026-01-01T00:00:01Z' }
  const b = { id: '2', occurredAt: '2026-01-01T00:00:02Z' }
  it('orders newest first, dedupes and caps', () => {
    expect(mergeActivities([a], [b, { ...a }], 10).map((x) => x.id)).toEqual(['2', '1'])
    expect(mergeActivities([a, b], [], 1).map((x) => x.id)).toEqual(['2'])
  })
})
