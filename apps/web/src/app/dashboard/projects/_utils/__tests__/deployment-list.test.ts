import { describe, expect, it } from 'vitest'
import { filterDeployments, hasActiveFilters, sortDeployments } from '../deployment-list'

const names: Record<string, string> = { s1: 'api', s2: 'web' }
const name = (id: string) => names[id] ?? id
const list = [
  { id: 'a', serviceId: 's1', status: 'success', environment: 'production', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'b', serviceId: 's2', status: 'building', environment: 'staging', createdAt: '2026-10-03T00:00:00Z' },
  { id: 'c', serviceId: 's1', status: 'failed', environment: 'production', createdAt: '2026-10-02T00:00:00Z', triggeredBy: 'ana' },
]
const none = { search: '', status: 'all', environment: 'all' } as const

describe('deployment list', () => {
  it('no filter keeps everything and reports no active filter', () => {
    expect(filterDeployments(list, none, name)).toHaveLength(3)
    expect(hasActiveFilters(none)).toBe(false)
  })
  it('in-progress matches pending/queued/building/deploying', () => {
    expect(filterDeployments(list, { ...none, status: 'in-progress' }, name).map((d) => d.id)).toEqual(['b'])
  })
  it('searches by service name and initiator', () => {
    expect(filterDeployments(list, { ...none, search: 'web' }, name).map((d) => d.id)).toEqual(['b'])
    expect(filterDeployments(list, { ...none, search: 'ANA' }, name).map((d) => d.id)).toEqual(['c'])
    expect(hasActiveFilters({ ...none, search: 'x' })).toBe(true)
  })
  it('sorts newest first by default', () => {
    expect(sortDeployments(list, 'newest', name).map((d) => d.id)).toEqual(['b', 'c', 'a'])
    expect(sortDeployments(list, 'oldest', name).map((d) => d.id)).toEqual(['a', 'c', 'b'])
    expect(sortDeployments(list, 'service', name)[0]?.serviceId).toBe('s1')
  })
})
