'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ServiceDependencyGraphPanel, type ServiceGraphDependency, type ServiceGraphNode } from '../../_components/ServiceDependencyGraphPanel'
import { useProjectDetail } from '../_hooks/use-project-detail'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Siren, Search, Boxes, GitBranch, Network, TriangleAlert } from 'lucide-react'
import { AuthDashboardProjectsProjectIdServicesServiceId } from '@/routes'
import { ENV_NAMES } from '@repo/contracts-common'

type DependencyMode = 'expected' | 'real'

const ENV_OPTIONS = ['all', ...ENV_NAMES] as const

/**
 * Dependencies Tab
 *
 * Two views of the service topology:
 * - **Expected state**: the declared `serviceDependencies` graph (config).
 * - **Real state**: what is actually running — derived from the Docker
 *   containers of this project. Two services are considered "connected" when
 *   a container of each shares a Docker network.
 *
 * Both views share the same filters (environment, service search, status).
 */
export default function ProjectDependenciesPage() {
  const { projectId, localServices, subServiceNodes, dependencies, isLoading, error } = useProjectDetail()
  const { data: containerData, isLoading: containersLoading } = useDockerContainerList({ query: { limit: 500, offset: 0 } })
  const router = useRouter()

  const handleServiceClick = useCallback(
    (serviceId: string) => {
      router.push(`/dashboard/projects/${projectId}/services/${serviceId}`)
    },
    [router, projectId],
  )

  // ── View mode + filters ─────────────────────────────────────────
  const [mode, setMode] = useState<DependencyMode>('expected')
  const [environment, setEnvironment] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // Normalize services (they come from the API as untyped rows). Includes the
  // top-level services PLUS every sub-service discovered through the
  // namespace-aware dependencies responses — a service is a namespace for
  // everything below it, so sub-service deps are visible in the project graph.
  // Sub-services carry their real parentId + status so the graph can nest
  // them under their parent (dashed group) instead of flattening them.
  const graphServices = useMemo<ServiceGraphNode[]>(() => {
    const mains = localServices.map((s: any, i: number) => ({
      id: String(s.id ?? ''),
      name: typeof s.name === 'string' && s.name ? s.name : `Service ${i + 1}`,
      type: typeof s.type === 'string' ? s.type : 'unknown',
      projectId: String(s.projectId ?? s.project_id ?? projectId),
      isActive: (s.status ?? s.state ?? 'active') === 'active',
      status: String(s.status ?? s.state ?? (s.isActive ? 'active' : 'inactive')),
      parentId: s.parentId ? String(s.parentId) : null,
    }))
    const subs = (subServiceNodes ?? []).map((s) => ({
      id: String(s.id ?? ''),
      name: typeof s.name === 'string' && s.name ? s.name : 'Unnamed sub-service',
      type: typeof s.type === 'string' ? s.type : 'service',
      projectId,
      isActive: s.status ? s.status !== 'stopped' && s.status !== 'error' && s.status !== 'failed' : true,
      status: typeof s.status === 'string' ? s.status : 'unknown',
      parentId: s.parentId ? String(s.parentId) : null,
    }))
    return [...mains, ...subs]
  }, [localServices, subServiceNodes, projectId])

  // Every service is enabled in every environment by default (the env page
  // falls back to ENV_NAMES too — per-service env lists are not persisted).
  const graphServiceEnvironments = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const service of graphServices) {
      map[service.id] = [...ENV_NAMES]
    }
    return map
  }, [graphServices])

  // ── Expected state: declared dependencies ───────────────────────
  const expectedDependencies = useMemo<ServiceGraphDependency[]>(() => {
    return dependencies.map((d: any, i: number) => ({
      id: String(d.id ?? `dep-${i}`),
      serviceId: String(d.serviceId ?? d.sourceId ?? ''),
      dependsOnServiceId: String(d.dependsOnServiceId ?? d.targetId ?? ''),
      isRequired: Boolean(d.isRequired ?? (d.type === 'required' || d.type === 'default')),
    }))
  }, [dependencies])

  // ── Cycle detection (Kahn's algorithm on the expected graph) ───
  const cycles = useMemo(() => {
    // Build adjacency: service → set of services it depends on
    const byId = new Map<string, string>()
    for (const s of graphServices) byId.set(s.id, s.name)

    const depsOf = new Map<string, Set<string>>()
    for (const s of graphServices) depsOf.set(s.id, new Set<string>())
    for (const dep of expectedDependencies) {
      if (dep.dependsOnServiceId && depsOf.has(dep.serviceId)) {
        depsOf.get(dep.serviceId)!.add(dep.dependsOnServiceId)
      }
    }

    // Kahn: repeatedly remove nodes with no remaining dependencies
    const removed = new Set<string>()
    let progress = true
    while (progress) {
      progress = false
      for (const [id, deps] of depsOf) {
        if (removed.has(id)) continue
        const remaining = [...deps].filter((d) => !removed.has(d))
        if (remaining.length === 0) {
          removed.add(id)
          progress = true
        }
      }
    }

    // Anything not removed is part of (or depends on) a cycle
    const inCycle = graphServices.filter((s) => !removed.has(s.id))
    return inCycle.map((s) => ({ id: s.id, name: s.name }))
  }, [graphServices, expectedDependencies])

  // ── Real state: derived from containers sharing Docker networks ─
  const realDependencies = useMemo<ServiceGraphDependency[]>(() => {
    const containers = (containerData?.data ?? []) as Array<Record<string, unknown>>
    if (containers.length === 0) return []

    const serviceIdByContainerId = new Map<string, string>()
    const networkIdsByContainerId = new Map<string, string[]>()
    for (const container of containers) {
      const containerId = String(container.id ?? container.Id ?? '')
      const serviceId = String(container.serviceId ?? container.service_id ?? '')
      if (!containerId || !serviceId) continue
      const networkIds = Array.isArray(container.networkIds)
        ? container.networkIds.map(String)
        : []
      serviceIdByContainerId.set(containerId, serviceId)
      networkIdsByContainerId.set(containerId, networkIds)
    }

    const edges = new Map<string, ServiceGraphDependency>()
    const containerEntries = [...serviceIdByContainerId.entries()]
    for (let i = 0; i < containerEntries.length; i += 1) {
      const entryA = containerEntries[i]
      if (!entryA) continue
      const [containerIdA, serviceIdA] = entryA
      const networksA = new Set(networkIdsByContainerId.get(containerIdA) ?? [])
      for (let j = i + 1; j < containerEntries.length; j += 1) {
        const entryB = containerEntries[j]
        if (!entryB) continue
        const [containerIdB, serviceIdB] = entryB
        if (serviceIdA === serviceIdB) continue
        const networksB = networkIdsByContainerId.get(containerIdB) ?? []
        const sharesNetwork = networksB.some((networkId) => networksA.has(networkId))
        if (!sharesNetwork) continue

        // Deterministic key so the edge is deduplicated regardless of order.
        // NOTE: a shared Docker network is an UNDIRECTED connection — we
        // cannot tell who depends on whom from network membership alone, so
        // the direction here is purely canonical (alphabetical) and the edge
        // is NOT stamped isRequired (that would falsely claim a declared
        // deployment-order requirement).
        const sortedPair: [string, string] = serviceIdA < serviceIdB
          ? [serviceIdA, serviceIdB]
          : [serviceIdB, serviceIdA]
        const [targetId, sourceId] = sortedPair
        const edgeKey = `${targetId}::${sourceId}`
        if (edges.has(edgeKey)) continue
        edges.set(edgeKey, {
          id: `real-${edgeKey}`,
          serviceId: targetId,
          dependsOnServiceId: sourceId,
          isRequired: false,
        })
      }
    }

    return [...edges.values()]
  }, [containerData, graphServices])

  const activeDependencies = mode === 'expected' ? expectedDependencies : realDependencies

  // ── Apply filters (environment + status + service search) ──────
  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return graphServices.filter((service) => {
      if (statusFilter !== 'all') {
        const isActive = service.isActive ? 'active' : 'inactive'
        if (isActive !== statusFilter) return false
      }
      if (query) {
        const name = service.name.toLowerCase()
        if (!name.includes(query)) return false
      }
      return true
    })
  }, [graphServices, searchQuery, statusFilter])

  // Only keep dependencies whose endpoints are still visible.
  const filteredDependencies = useMemo(() => {
    const visibleIds = new Set(filteredServices.map((service) => service.id))
    return activeDependencies.filter(
      (dependency) => visibleIds.has(dependency.serviceId) && visibleIds.has(dependency.dependsOnServiceId),
    )
  }, [activeDependencies, filteredServices])

  const realStateSummary = useMemo(() => {
    const containers = (containerData?.data ?? []) as Array<Record<string, unknown>>
    const serviceContainers = containers.filter((c) =>
      graphServices.some((service) => service.id === String(c.serviceId ?? c.service_id ?? '')),
    )
    const running = serviceContainers.filter((c) => String(c.status ?? '').toLowerCase() === 'running').length
    return { containers: serviceContainers.length, running }
  }, [containerData, graphServices])

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Failed to load dependencies</AlertTitle>
        <AlertDescription>
          {isDefinedORPCError(error) ? getErrorMessage(error) : 'An unexpected error occurred.'}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Service Dependencies</CardTitle>
        </div>
        {/* Mode toggle: expected vs real state */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setMode('expected')}
            aria-pressed={mode === 'expected'}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'expected' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitBranch className="size-3.5" />
            Expected
          </button>
          <button
            type="button"
            onClick={() => setMode('real')}
            aria-pressed={mode === 'real'}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'real' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Boxes className="size-3.5" />
            Real state
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ── Filters bar ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter services…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={environment} onValueChange={(v) => setEnvironment(v)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Environment" />
            </SelectTrigger>
            <SelectContent>
              {ENV_OPTIONS.map((env) => (
                <SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v: 'all' | 'active' | 'inactive') => setStatusFilter(v)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Network className="size-3" />
            {filteredServices.length}/{graphServices.length} services
          </Badge>
          {mode === 'real' && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Boxes className="size-3" />
              {containersLoading ? '…' : `${realStateSummary.running}/${realStateSummary.containers} containers running`}
            </Badge>
          )}
        </div>

        {/* ── Cycle warning (expected mode) ── */}
        {mode === 'expected' && cycles.length > 0 && (
          <Alert variant="destructive" className="border-destructive/40">
            <TriangleAlert className="size-4" />
            <AlertTitle>Dependency cycle detected</AlertTitle>
            <AlertDescription>
              {cycles.length} service{cycles.length === 1 ? '' : 's'} participate in a circular dependency
              (or depend on a cycle): <strong>{cycles.map((c) => c.name).join(', ')}</strong>. Deploy ordering and
              readiness gating cannot resolve a cycle — review these edges.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Legend for the active mode ── */}
        {mode === 'real' && filteredDependencies.length === 0 && !containersLoading && (
          <p className="text-xs text-muted-foreground">
            No shared-network connections detected between running services in this project.
          </p>
        )}

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
