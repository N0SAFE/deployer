'use client'

import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@/assets/css/xyflow.css'
import { AlertCircle, GitBranch, Link2, Layers } from 'lucide-react'
import { serviceEndpoints } from '@/domains/service/endpoints'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { ENV_NAMES } from '@repo/contracts-common'
import { buildGraph } from './dependency-graph/build-graph'
import { getColorForEnvironment } from './dependency-graph/graph-env'
import { EnvironmentGroupNode, ServiceNode, SubserviceGroupNode } from './dependency-graph/GraphNodes'
import type {
  DependencyRecord,
  ServiceGraphDependency,
  ServiceGraphDependencyRoute,
  ServiceGraphNode,
  ServiceNodeData,
} from './dependency-graph/graph-types'

export type { ServiceGraphDependency, ServiceGraphDependencyRoute, ServiceGraphNode }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Stable references: defined once so ReactFlow does not re-register node types each render.
const NODE_TYPES = {
  serviceNode: ServiceNode,
  environmentGroup: EnvironmentGroupNode,
  subserviceGroup: SubserviceGroupNode,
}
const DEFAULT_ENVIRONMENT_ORDER: string[] = [...ENV_NAMES]
const NO_ROUTES: ServiceGraphDependencyRoute[] = []
const NO_SERVICE_ENVIRONMENTS: Record<string, string[]> = {}

export function ServiceDependencyGraphPanel({
  services,
  dependencies: providedDependencies,
  dependencyRoutes = NO_ROUTES,
  serviceEnvironments = NO_SERVICE_ENVIRONMENTS,
  environmentOrder = DEFAULT_ENVIRONMENT_ORDER,
  selectedEnvironment = 'all',
  onServiceClick,
  title = 'Service dependency graph',
  description = 'Dependency flow runs left-to-right (dependency → service). Required links are solid, optional links are dashed. Sub-services nest inside their parent.',
}: {
  services: ServiceGraphNode[]
  dependencies?: ServiceGraphDependency[]
  dependencyRoutes?: ServiceGraphDependencyRoute[]
  serviceEnvironments?: Record<string, string[]>
  environmentOrder?: string[]
  selectedEnvironment?: string
  /** Called when a service node is clicked (drill-down). */
  onServiceClick?: (serviceId: string) => void
  title?: string
  description?: string
}) {
  const sortedServices = useMemo(() => [...services].sort((a, b) => a.name.localeCompare(b.name)), [services])

  // When the parent already provides dependency data, skip our own queries.
  const skipOwnQueries = providedDependencies !== undefined

  // Only fetch for real UUID service ids — never a `:id` template placeholder.
  const queryState = useQueries({
    queries: skipOwnQueries
      ? []
      : sortedServices
          .filter((service) => UUID_RE.test(service.id))
          .map((service) => serviceEndpoints.dependencies.list.queryOptions({ input: { params: { id: service.id } } })),
    combine: (results) => ({
      loading: results.some((r) => r.isLoading),
      failed: results.some((r) => r.error),
      edges: results.flatMap((r) => r.data?.dependencies ?? []),
    }),
  })
  const { loading, failed: hasDependencyError, edges: fetchedEdges } = queryState

  const dependencies = useMemo<DependencyRecord[]>(() => {
    if (providedDependencies) {
      return providedDependencies.map((dependency) => ({
        id: dependency.id,
        serviceId: dependency.serviceId,
        dependsOnServiceId: dependency.dependsOnServiceId,
        isRequired: dependency.isRequired ?? true,
        enabledIn: dependency.enabledIn ? [...dependency.enabledIn] : undefined,
      }))
    }
    return fetchedEdges.map((dependency) => ({
      id: dependency.id,
      serviceId: dependency.serviceId,
      dependsOnServiceId: dependency.dependsOnServiceId,
      isRequired: dependency.isRequired,
    }))
  }, [fetchedEdges, providedDependencies])

  // Stable navigation callback so node renders don't thrash.
  const navigate = useCallback(
    (serviceId: string) => { onServiceClick?.(serviceId) },
    [onServiceClick],
  )

  const graph = useMemo(
    () => buildGraph({ sortedServices, dependencies, dependencyRoutes, environmentOrder, selectedEnvironment, serviceEnvironments, navigate }),
    [dependencies, dependencyRoutes, environmentOrder, selectedEnvironment, serviceEnvironments, sortedServices, navigate],
  )

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as Partial<ServiceNodeData>
      if (data.service?.id) navigate(data.service.id)
    },
    [navigate],
  )

  if (sortedServices.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-6">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          No services yet — add a service to this project to see how deploy order links them.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur-xl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1"><GitBranch className="size-3.5" />{sortedServices.length} services</Badge>
          <Badge variant="outline" className="gap-1"><Link2 className="size-3.5" />{dependencies.length} links</Badge>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">edge colors:</Badge>
        {graph.environments.map((environment) => (
          <Badge key={environment} variant="outline" className="gap-1 text-xs">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: getColorForEnvironment(environment) }} />
            {environment}
          </Badge>
        ))}
        <span className="mx-1 h-3 w-px bg-border" />
        <Badge variant="outline" className="gap-1 text-xs"><span className="inline-block h-0.5 w-4 bg-foreground/70" /> required (solid)</Badge>
        <Badge variant="outline" className="gap-1 text-xs"><span className="inline-block h-0.5 w-4 border-t border-dashed border-foreground/70" /> optional (dashed)</Badge>
        <Badge variant="outline" className="gap-1 text-xs"><Layers className="size-3" /> dashed border = sub-service</Badge>
      </div>

      {hasDependencyError ? (
        <div role="alert" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <AlertCircle className="size-3.5" />
            Some dependency links could not be loaded — the graph may be incomplete.
          </span>
        </div>
      ) : null}

      <div className="h-150 w-full overflow-hidden rounded-xl border border-border/60 bg-background/70">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.6}
          /*
            Attribution left visible. `proOptions={{ hideAttribution: true }}`
            used to sit here, and React Flow permits that only under a React Flow
            Pro subscription — without one it breaches the licence. Restore it only
            if this project actually holds that subscription.
          */
          onNodeClick={handleNodeClick}
        >
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        </ReactFlow>
      </div>

      {loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">Refreshing dependency topology…</p> : null}
    </section>
  )
}
