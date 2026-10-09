import { describe, expect, it } from 'vitest'
import type { DockerNetwork } from '@repo/contracts-entities'
import { describeNetwork, filterNetworks, isBuiltInNetwork } from './networks'

function net(overrides: Partial<DockerNetwork>): DockerNetwork {
  return {
    id: 'abc123', name: 'app-net', driver: 'bridge', scope: 'local', internal: false, attachable: true,
    subnet: '172.18.0.0/16', gateway: '172.18.0.1', containerIds: [], labels: {},
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isBuiltInNetwork', () => {
  it('flags bridge, host and none only', () => {
    expect(['bridge', 'host', 'none'].every(isBuiltInNetwork)).toBe(true)
    expect(isBuiltInNetwork('app-net')).toBe(false)
  })
})

describe('filterNetworks', () => {
  const list = [net({ name: 'a', containerIds: ['c1'] }), net({ id: 'z', name: 'b', driver: 'overlay' })]
  it('filters by usage and driver', () => {
    expect(filterNetworks(list, { query: '', view: 'with-containers' }).map((n) => n.name)).toEqual(['a'])
    expect(filterNetworks(list, { query: '', view: 'unused' }).map((n) => n.name)).toEqual(['b'])
    expect(filterNetworks(list, { query: '', view: 'bridge' }).map((n) => n.name)).toEqual(['a'])
  })
  it('searches name, id prefix and subnet', () => {
    expect(filterNetworks(list, { query: 'Z', view: 'all' })).toHaveLength(1)
    expect(filterNetworks(list, { query: '172.18', view: 'all' })).toHaveLength(2)
  })
})

describe('describeNetwork', () => {
  it('reports only what is missing or notable', () => {
    expect(describeNetwork(net({ name: 'bridge', containerIds: ['c'] }))).toEqual([
      'Built-in network: Docker creates it and does not allow removing it.',
    ])
    expect(describeNetwork(net({ gateway: null, subnet: null, internal: true }))).toHaveLength(4)
  })
})
