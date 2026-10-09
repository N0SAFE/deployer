import { describe, expect, it } from 'vitest'
import type { ContainerRow } from '../_models/container-list.model'
import {
  actionTargets,
  fallbackImageRef,
  filterContainerRows,
  formatPorts,
  hasActiveFilters,
  summarizeContainers,
} from './container-rows'

function row(overrides: Partial<ContainerRow>): ContainerRow {
  return {
    id: 'abc123', name: 'web', image: 'docker.io/library/nginx:1', imageId: null, status: 'running',
    health: 'none', environment: null, serviceId: 'svc-1', managedBy: 'orphan', ports: [],
    updatedAt: '2026-01-01T00:00:00Z', ...overrides,
  }
}

const NO_FILTER = { q: '', view: 'all', status: 'all', environment: 'all', ownership: 'all' } as const

describe('formatPorts', () => {
  it('shows published and unpublished ports', () => {
    expect(formatPorts([
      { containerPort: 80, hostPort: 8080, protocol: 'tcp' },
      { containerPort: 53, hostPort: null, protocol: 'udp' },
    ])).toEqual(['8080→80/tcp', '53/udp'])
  })
})

describe('fallbackImageRef', () => {
  it('shortens sha ids and handles null', () => {
    expect(fallbackImageRef('sha256:0123456789abcdef0123')).toBe('sha256:0123456789ab')
    expect(fallbackImageRef(null)).toBe('unknown image')
  })
})

describe('filterContainerRows', () => {
  const rows = [
    row({ id: 'a', name: 'api', status: 'running', health: 'healthy' }),
    row({ id: 'b', name: 'db', status: 'exited', managedBy: 'deployment_service', environment: 'production' }),
    row({ id: 'c', name: 'cache', status: 'running', health: 'unhealthy' }),
  ]
  it('applies views', () => {
    expect(filterContainerRows(rows, { ...NO_FILTER, view: 'active' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterContainerRows(rows, { ...NO_FILTER, view: 'failed' }).map((r) => r.id)).toEqual(['b', 'c'])
  })
  it('applies ownership, environment and search', () => {
    expect(filterContainerRows(rows, { ...NO_FILTER, ownership: 'deployment_service' }).map((r) => r.id)).toEqual(['b'])
    expect(filterContainerRows(rows, { ...NO_FILTER, environment: 'production' }).map((r) => r.id)).toEqual(['b'])
    expect(filterContainerRows(rows, { ...NO_FILTER, q: ' CAC ' }).map((r) => r.id)).toEqual(['c'])
  })
  it('knows when a filter is active', () => {
    expect(hasActiveFilters(NO_FILTER)).toBe(false)
    expect(hasActiveFilters({ ...NO_FILTER, q: 'x' })).toBe(true)
  })
})

describe('actionTargets', () => {
  const rows = [row({ id: 'run', status: 'running' }), row({ id: 'off', status: 'exited' })]
  it('stop and restart skip stopped containers, start skips live ones', () => {
    expect(actionTargets('stop', rows).map((r) => r.id)).toEqual(['run'])
    expect(actionTargets('restart', rows).map((r) => r.id)).toEqual(['run'])
    expect(actionTargets('start', rows).map((r) => r.id)).toEqual(['off'])
    expect(actionTargets('remove', rows)).toHaveLength(2)
  })
})

describe('summarizeContainers', () => {
  it('counts running, stopped and unhealthy', () => {
    expect(summarizeContainers([
      row({ status: 'running', health: 'unhealthy' }),
      row({ status: 'exited' }),
      row({ status: 'paused' }),
    ])).toEqual({ total: 3, running: 1, stopped: 1, unhealthy: 1 })
  })
})
