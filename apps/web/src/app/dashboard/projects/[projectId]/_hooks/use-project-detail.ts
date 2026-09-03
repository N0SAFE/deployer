'use client'

import { useParams } from 'next/navigation'
import { useQueries } from '@tanstack/react-query'
import { useProject } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { serviceEndpoints } from '@/domains/service/endpoints'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { useMemo } from 'react'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Aggregated project detail data hook
 *
 * Combines project, services, deployments, and dependencies
 * into a single return value. Extracted from the monolithic page.tsx.
 */
export function useProjectDetail() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  // Core data queries
  const { data: projectData, isLoading: projectLoading, error: projectError } = useProject(projectId)
  const { data: servicesData, isLoading: servicesLoading } = useServiceList({
    query: { limit: 100, offset: 0 },
  })

  // Filter services to current project — TOP-LEVEL only. Sub-services are
  // real rows with the same projectId but a non-null parentId; they must
  // NOT appear as main services in the project's graph/stats.
  const localServices = useMemo(() => {
    if (!servicesData?.data) return []
    return filterProjectTopLevelServices(servicesData.data, projectId)
  }, [servicesData, projectId])

  // Dependencies per service (N+1 — known issue, needs batch endpoint).
  // `enabled` guards prevent `:id` template placeholders reaching the API
  // when a service row is briefly malformed/undefined (e.g. during HMR).
  const dependencyQueries = useQueries({
    queries: localServices.map((service: any) => {
      const serviceId = String(service.id ?? '')
      return serviceEndpoints.dependencies.list.queryOptions({
        input: { params: { id: serviceId }, id: serviceId },
        enabled: UUID_RE.test(serviceId),
      })
    }),
  })

  // Deployments
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
   * Namespace-aware dependency flattening.
   *
   * Each top-level service's dependencies response now carries `subServices`
   * — the sub-service dependency tree (a service is a namespace for everything
   * below it). The project graph therefore includes:
   *  - each top-level service's OWN edges, plus
   *  - every sub-service's edges (recursively), and
   *  - the sub-service nodes themselves (so those edges have visible ends).
   */
  const { dependencies, subServiceNodes } = useMemo(() => {
    const deps: any[] = []
    const nodes: Array<{ id: string; name: string; type: string; parentId: string | null; status?: string }> = []
    for (const q of dependencyQueries) {
      const data = q.data as {
        dependencies?: unknown[]
        subServices?: unknown[]
      } | undefined
      deps.push(...(data?.dependencies ?? []))
      collectSubServiceNodes(data?.subServices, deps, nodes, null)
    }
    return { dependencies: deps, subServiceNodes: nodes }
  }, [dependencyQueries])

  return {
    projectId,
    project,
    localServices,
    subServiceNodes,
    deployments,
    dependencies,
    isLoading: projectLoading || servicesLoading,
    error: projectError,
    refetchDeployments,
  }
}

interface SubDepsNodeShape {
  serviceId?: string
  serviceName?: string
  serviceType?: string
  status?: string
  state?: string
  dependencies?: unknown[]
  children?: SubDepsNodeShape[]
}

/**
 * Recursively collect a sub-service tree's edges into `deps` and its nodes
 * into `nodes`. `parentServiceId` links each sub-service to its parent so the
 * graph can render them as nested/grouped nodes.
 */
function collectSubServiceNodes(
  subServices: unknown[] | undefined,
  deps: unknown[],
  nodes: Array<{ id: string; name: string; type: string; parentId: string | null; status?: string }>,
  parentServiceId: string | null,
): void {
  for (const raw of subServices ?? []) {
    const node = raw as SubDepsNodeShape
    if (!node.serviceId) continue
    deps.push(...(node.dependencies ?? []))
    nodes.push({
      id: node.serviceId,
      name: node.serviceName ?? 'Unnamed sub-service',
      type: node.serviceType ?? 'service',
      parentId: parentServiceId,
      status: node.status ?? node.state ?? undefined,
    })
    collectSubServiceNodes(node.children, deps, nodes, node.serviceId)
  }
}
