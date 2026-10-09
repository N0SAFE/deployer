'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useQueries } from '@tanstack/react-query'
import { useProject } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { serviceEndpoints } from '@/domains/service/endpoints'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { collectSubServices, type DependencyEdgeLike, type SubServiceNode } from '../_utils/dependency-topology'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Aggregated project detail data hook
 *
 * Combines project, services, deployments, and dependencies into a single
 * return value.
 */
export function useProjectDetail() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const projectQuery = useProject(projectId)
  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const { data: projectData, isLoading: projectLoading, error: projectError } = projectQuery
  const { data: servicesData, isLoading: servicesLoading, error: servicesError } = servicesQuery

  // TOP-LEVEL services only. Sub-services are real rows with the same projectId
  // but a non-null parentId; they must not appear as main services.
  const localServices = useMemo(() => {
    if (!servicesData?.data) return []
    return filterProjectTopLevelServices(servicesData.data, projectId)
  }, [servicesData, projectId])

  // Dependencies per service (N+1 — known issue, needs a batch endpoint).
  // `enabled` guards keep `:id` template placeholders away from the API when a
  // service row is briefly malformed (e.g. during HMR).
  const dependencyResponses = useQueries({
    queries: localServices.map((service) =>
      serviceEndpoints.dependencies.list.queryOptions({
        input: { params: { id: service.id } },
        enabled: UUID_RE.test(service.id),
      }),
    ),
    combine: (results) => results.map((r) => r.data),
  })

  const { data: deploymentsData, refetch: refetchDeployments } = useDeploymentList({
    query: {
      filter: { projectId: { operator: 'eq' as const, value: projectId } },
      limit: 50,
      offset: 0,
    },
  })

  const project = useMemo(() => projectData ?? null, [projectData])
  const deployments = useMemo(() => deploymentsData?.data ?? [], [deploymentsData])

  /**
   * Namespace-aware flattening: each top-level service's response carries its
   * OWN edges plus `subServices` (recursively), so the project graph includes
   * every edge and the sub-service nodes that give those edges visible ends.
   */
  const { dependencies, subServiceNodes } = useMemo(() => {
    const edges: DependencyEdgeLike[] = []
    const nodes: SubServiceNode[] = []
    for (const response of dependencyResponses) {
      if (!response) continue
      edges.push(...response.dependencies)
      const sub = collectSubServices(response.subServices)
      edges.push(...sub.edges)
      nodes.push(...sub.nodes)
    }
    return { dependencies: edges, subServiceNodes: nodes }
  }, [dependencyResponses])

  return {
    projectId,
    project,
    localServices,
    subServiceNodes,
    deployments,
    dependencies,
    isLoading: projectLoading || servicesLoading,
    error: projectError ?? servicesError,
    refetchDeployments,
    refetch: () => {
      void projectQuery.refetch()
      void servicesQuery.refetch()
    },
  }
}
