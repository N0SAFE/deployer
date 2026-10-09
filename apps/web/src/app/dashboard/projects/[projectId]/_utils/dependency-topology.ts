/**
 * Pure helpers for the project Dependencies page: declared-graph cycle
 * detection, the runtime ("real") graph derived from Docker networks, and the
 * flattening of the namespace-aware dependencies responses.
 */
import type {
  ServiceGraphDependency,
  ServiceGraphNode,
} from '../../_components/dependency-graph/graph-types'

export interface TopologyContainer {
  id: string
  serviceId: string
  status: string
  networkIds: readonly string[]
}

export interface DependencyEdgeLike {
  id: string
  serviceId: string
  dependsOnServiceId: string
  isRequired: boolean
}

/** Sub-service dependency tree as the API returns it (namespace-aware). */
export interface SubDependenciesNode {
  serviceId: string
  serviceName: string
  serviceType: string
  dependencies: readonly DependencyEdgeLike[]
  children?: readonly SubDependenciesNode[]
}

export interface SubServiceNode {
  id: string
  name: string
  type: string
  parentId: string | null
}

/**
 * Services that take part in (or depend on) a circular dependency, found with
 * Kahn's algorithm: repeatedly remove services whose dependencies are all gone;
 * whatever cannot be removed is in or behind a cycle.
 */
export function findCycleParticipants(
  services: readonly { id: string; name: string }[],
  dependencies: readonly { serviceId: string; dependsOnServiceId: string }[],
): { id: string; name: string }[] {
  const depsOf = new Map<string, Set<string>>()
  for (const s of services) depsOf.set(s.id, new Set<string>())
  for (const dep of dependencies) {
    if (dep.dependsOnServiceId) depsOf.get(dep.serviceId)?.add(dep.dependsOnServiceId)
  }

  const removed = new Set<string>()
  let progress = true
  while (progress) {
    progress = false
    for (const [id, deps] of depsOf) {
      if (removed.has(id)) continue
      if ([...deps].every((d) => removed.has(d))) {
        removed.add(id)
        progress = true
      }
    }
  }
  return services.filter((s) => !removed.has(s.id)).map((s) => ({ id: s.id, name: s.name }))
}

/**
 * Real state: two services are "connected" when a container of each shares a
 * Docker network. Membership is UNDIRECTED, so the direction is canonical
 * (alphabetical) and the edge is never marked required — that would falsely
 * claim a declared deployment-order requirement.
 */
export function deriveRealDependencies(containers: readonly TopologyContainer[]): ServiceGraphDependency[] {
  const withService = containers.filter((c) => c.id && c.serviceId)
  const edges = new Map<string, ServiceGraphDependency>()
  for (let i = 0; i < withService.length; i += 1) {
    const a = withService[i]
    if (!a) continue
    const networksA = new Set(a.networkIds)
    for (let j = i + 1; j < withService.length; j += 1) {
      const b = withService[j]
      if (!b || a.serviceId === b.serviceId) continue
      if (!b.networkIds.some((n) => networksA.has(n))) continue
      const [low, high] = a.serviceId < b.serviceId ? [a.serviceId, b.serviceId] : [b.serviceId, a.serviceId]
      const key = `${low}::${high}`
      if (edges.has(key)) continue
      edges.set(key, { id: `real-${key}`, serviceId: low, dependsOnServiceId: high, isRequired: false })
    }
  }
  return [...edges.values()]
}

/** Running / total containers that belong to the given services. */
export function summarizeContainers(
  containers: readonly TopologyContainer[],
  serviceIds: ReadonlySet<string>,
): { containers: number; running: number } {
  const mine = containers.filter((c) => serviceIds.has(c.serviceId))
  return { containers: mine.length, running: mine.filter((c) => c.status.toLowerCase() === 'running').length }
}

/** Services visible after the search + status filters. */
export function filterGraphServices(
  services: readonly ServiceGraphNode[],
  filters: { search: string; status: 'all' | 'active' | 'inactive' },
): ServiceGraphNode[] {
  const query = filters.search.trim().toLowerCase()
  return services.filter((s) => {
    if (filters.status !== 'all' && (s.isActive ? 'active' : 'inactive') !== filters.status) return false
    return !query || s.name.toLowerCase().includes(query)
  })
}

/**
 * Recursively collect a sub-service tree's edges and nodes. `parentServiceId`
 * links each sub-service to its parent so the graph can nest them.
 */
export function collectSubServices(
  subServices: readonly SubDependenciesNode[] | undefined,
  parentServiceId: string | null = null,
): { edges: DependencyEdgeLike[]; nodes: SubServiceNode[] } {
  const edges: DependencyEdgeLike[] = []
  const nodes: SubServiceNode[] = []
  for (const node of subServices ?? []) {
    edges.push(...node.dependencies)
    nodes.push({ id: node.serviceId, name: node.serviceName, type: node.serviceType, parentId: parentServiceId })
    const nested = collectSubServices(node.children, node.serviceId)
    edges.push(...nested.edges)
    nodes.push(...nested.nodes)
  }
  return { edges, nodes }
}
