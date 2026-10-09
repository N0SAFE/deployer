import { describe, expect, it } from 'vitest'
import {
  collectSubServices,
  deriveRealDependencies,
  filterGraphServices,
  findCycleParticipants,
  summarizeContainers,
  type SubDependenciesNode,
} from './dependency-topology'

const svc = (id: string, name = id, isActive = true) => ({ id, name, type: 't', projectId: 'p', isActive })

describe('findCycleParticipants', () => {
  const services = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
  it('returns nothing for an acyclic graph', () => {
    expect(findCycleParticipants(services, [{ serviceId: 'a', dependsOnServiceId: 'b' }])).toEqual([])
  })
  it('returns the cycle and whatever depends on it', () => {
    const result = findCycleParticipants(services, [
      { serviceId: 'a', dependsOnServiceId: 'b' },
      { serviceId: 'b', dependsOnServiceId: 'a' },
      { serviceId: 'c', dependsOnServiceId: 'a' },
    ])
    expect(result.map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('deriveRealDependencies', () => {
  it('links services whose containers share a network, once, never required', () => {
    const edges = deriveRealDependencies([
      { id: '1', serviceId: 'z', status: 'running', networkIds: ['n1'] },
      { id: '2', serviceId: 'a', status: 'running', networkIds: ['n1', 'n2'] },
      { id: '3', serviceId: 'a', status: 'running', networkIds: ['n1'] },
      { id: '4', serviceId: 'q', status: 'exited', networkIds: ['other'] },
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ serviceId: 'a', dependsOnServiceId: 'z', isRequired: false })
  })
})

describe('summarizeContainers / filterGraphServices', () => {
  it('counts running containers of the listed services only', () => {
    const containers = [
      { id: '1', serviceId: 'a', status: 'Running', networkIds: [] },
      { id: '2', serviceId: 'a', status: 'exited', networkIds: [] },
      { id: '3', serviceId: 'x', status: 'running', networkIds: [] },
    ]
    expect(summarizeContainers(containers, new Set(['a']))).toEqual({ containers: 2, running: 1 })
  })
  it('filters by search and status', () => {
    const list = [svc('1', 'API'), svc('2', 'Worker', false)]
    expect(filterGraphServices(list, { search: 'api', status: 'all' })).toHaveLength(1)
    expect(filterGraphServices(list, { search: '', status: 'inactive' }).map((s) => s.id)).toEqual(['2'])
  })
})

describe('collectSubServices', () => {
  it('flattens edges and nodes recursively with parent links', () => {
    const edge = (id: string) => ({ id, serviceId: 's', dependsOnServiceId: 't', isRequired: true })
    const tree: SubDependenciesNode[] = [
      { serviceId: 'c1', serviceName: 'C1', serviceType: 'x', dependencies: [edge('e1')], children: [
        { serviceId: 'g1', serviceName: 'G1', serviceType: 'x', dependencies: [edge('e2')] },
      ] },
    ]
    const { edges, nodes } = collectSubServices(tree, 'root')
    expect(edges.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(nodes).toEqual([
      { id: 'c1', name: 'C1', type: 'x', parentId: 'root' },
      { id: 'g1', name: 'G1', type: 'x', parentId: 'c1' },
    ])
  })
})
