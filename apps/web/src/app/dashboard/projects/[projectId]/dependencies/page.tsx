'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { ENV_NAMES } from '@repo/contracts-common'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { PageSkeleton } from '@/components/dashboard'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { AuthDashboardProjectsProjectIdServicesServiceId } from '@/routes'
import { ServiceDependencyGraphPanel } from '../../_components/ServiceDependencyGraphPanel'
import type { ServiceGraphNode } from '../../_components/dependency-graph/graph-types'
import { DependencyFilters, ModeToggle, type DependencyMode, type StatusFilter } from '../../_components/dependencies/DependencyFilters'
import { InlineError } from '../../_components/workload/WorkloadStates'
import { useProjectDetail } from '../_hooks/use-project-detail'
import {
  deriveRealDependencies,
  filterGraphServices,
  findCycleParticipants,
  summarizeContainers,
} from '../_utils/dependency-topology'

/**
 * Dependencies tab — two views of the service topology:
 * - **Expected**: the declared `serviceDependencies` graph (config).
 * - **Real state**: derived from this project's Docker containers; two
 *   services are "connected" when a container of each shares a Docker network.
 * Both share the same filters (environment, service search, status).
 */
export default function ProjectDependenciesPage() {
  const { projectId, localServices, subServiceNodes, dependencies, isLoading, error, refetch } = useProjectDetail()
  const containersQuery = useDockerContainerList({ query: { limit: 500, offset: 0 } })
  const router = useRouter()

  const handleServiceClick = useCallback(
    (serviceId: string) => { router.push(AuthDashboardProjectsProjectIdServicesServiceId({ projectId, serviceId })) },
    [router, projectId],
  )

  const [mode, setMode] = useState<DependencyMode>('expected')
  const [environment, setEnvironment] = useState('all')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  // Top-level services PLUS every sub-service discovered through the
  // namespace-aware dependencies responses (a service is a namespace for
  // everything below it). Sub-services nest under their parent in the graph.
  // The API reports no lifecycle status for sub-services, so say "unknown"
  // rather than inventing "active".
  const graphServices = useMemo<ServiceGraphNode[]>(() => [
    ...localServices.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      projectId: s.projectId,
      isActive: s.isActive,
      status: s.isActive ? 'active' : 'inactive',
      parentId: null,
    })),
    ...subServiceNodes.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      projectId,
      isActive: true,
      status: 'unknown',
      parentId: s.parentId,
    })),
  ], [localServices, subServiceNodes, projectId])

  // Per-service environment lists are not persisted: every service is shown in every environment.
  const graphServiceEnvironments = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const service of graphServices) map[service.id] = [...ENV_NAMES]
    return map
  }, [graphServices])

  const expectedDependencies = dependencies

  const cycles = useMemo(() => findCycleParticipants(graphServices, expectedDependencies), [graphServices, expectedDependencies])

  const containers = useMemo(() => containersQuery.data?.data ?? [], [containersQuery.data])
  const realDependencies = useMemo(() => deriveRealDependencies(containers), [containers])
  const realSummary = useMemo(
    () => summarizeContainers(containers, new Set(graphServices.map((s) => s.id))),
    [containers, graphServices],
  )

  const filteredServices = useMemo(() => {
    const byStatus = filterGraphServices(graphServices, { search, status })
    return environment === 'all'
      ? byStatus
      : byStatus.filter((s) => graphServiceEnvironments[s.id]?.includes(environment))
  }, [environment, graphServiceEnvironments, graphServices, search, status])

  // Only keep dependencies whose endpoints are still visible.
  const filteredDependencies = useMemo(() => {
    const visibleIds = new Set(filteredServices.map((s) => s.id))
    return (mode === 'expected' ? expectedDependencies : realDependencies).filter(
      (d) => visibleIds.has(d.serviceId) && visibleIds.has(d.dependsOnServiceId),
    )
  }, [mode, expectedDependencies, realDependencies, filteredServices])

  if (isLoading) return <PageSkeleton blocks={1} withStrip={false} label="Loading dependencies" />
  if (error) return <InlineError title="Could not load dependencies" error={error} onRetry={refetch} />

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Service dependencies</CardTitle>
          <p className="text-sm text-muted-foreground">Deploy order between services: a service waits for what it depends on, and cascade deploys follow these links.</p>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </CardHeader>

      <CardContent className="space-y-3">
        <DependencyFilters
          search={search}
          onSearch={setSearch}
          environment={environment}
          onEnvironment={setEnvironment}
          status={status}
          onStatus={setStatus}
          visibleCount={filteredServices.length}
          totalCount={graphServices.length}
          containerSummary={mode === 'real' ? (containersQuery.isLoading ? null : realSummary) : undefined}
        />

        {mode === 'real' && containersQuery.error ? (
          <InlineError title="Could not load containers" error={containersQuery.error} onRetry={() => { void containersQuery.refetch() }} />
        ) : null}

        {mode === 'expected' && cycles.length > 0 ? (
          <Alert variant="destructive" className="border-destructive/40">
            <TriangleAlert className="size-4" />
            <AlertTitle>Dependency cycle detected</AlertTitle>
            <AlertDescription>
              {cycles.length} service{cycles.length === 1 ? '' : 's'} participate in a circular dependency
              (or depend on a cycle): <strong>{cycles.map((c) => c.name).join(', ')}</strong>. Deploy ordering and
              readiness gating cannot resolve a cycle — review these edges.
            </AlertDescription>
          </Alert>
        ) : null}

        {mode === 'real' && filteredDependencies.length === 0 && !containersQuery.isLoading && !containersQuery.error ? (
          <p role="status" className="text-sm text-muted-foreground">
            No shared-network connections detected between running services in this project. Deploy and start services on a common network to see them here.
          </p>
        ) : null}

        <ServiceDependencyGraphPanel
          services={filteredServices}
          dependencies={filteredDependencies}
          serviceEnvironments={graphServiceEnvironments}
          selectedEnvironment={environment}
          onServiceClick={handleServiceClick}
          title={mode === 'expected' ? 'Expected dependency topology' : 'Real runtime topology'}
          description={
            mode === 'expected'
              ? 'Declared dependency links (deploy order + readiness gating). Sub-services nest inside their parent.'
              : 'Derived from containers sharing Docker networks.'
          }
        />
      </CardContent>
    </Card>
  )
}
