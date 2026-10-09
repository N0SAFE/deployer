import { describe, expect, it } from 'vitest'
import type { DockerVolume } from '@repo/contracts-entities'
import { filterVolumes, isVolumeInUse, totalReportedBytes } from './volumes'

function vol(overrides: Partial<DockerVolume>): DockerVolume {
  return {
    id: 'v1', name: 'pgdata', driver: 'local', mountpoint: '/var/lib/docker/volumes/pgdata/_data',
    sizeBytes: null, usedByContainerIds: [], labels: {}, createdAt: '', updatedAt: '',
    ...overrides,
  }
}

describe('volume helpers', () => {
  const list = [vol({ usedByContainerIds: ['c1'], sizeBytes: 100 }), vol({ id: 'v2', name: 'cache', sizeBytes: 50 })]
  it('knows when a volume is in use', () => {
    expect(isVolumeInUse(list[0]!)).toBe(true)
    expect(isVolumeInUse(list[1]!)).toBe(false)
  })
  it('filters by view and query', () => {
    expect(filterVolumes(list, { query: '', view: 'active' })).toHaveLength(1)
    expect(filterVolumes(list, { query: 'cac', view: 'all' }).map((v) => v.name)).toEqual(['cache'])
  })
  it('sums only reported sizes', () => {
    expect(totalReportedBytes(list)).toBe(150)
    expect(totalReportedBytes([vol({})])).toBeNull()
  })
})
