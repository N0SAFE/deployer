'use client'

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@/assets/css/xyflow.css'
import { AlertCircle, GitBranch, Link2 } from 'lucide-react'
import { serviceEndpoints } from '@/domains/service/endpoints'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'

export interface ServiceGraphNode {
  id: string
  name: string
  type: string
  projectId: string
  isActive: boolean
}

interface DependencyRecord {
  id: string
  serviceId: string
  dependsOnServiceId: string
  isRequired: boolean
  enabledIn?: string[]
}

export interface ServiceGraphDependency {
  id: string
  serviceId: string
  dependsOnServiceId: string
  isRequired?: boolean
  enabledIn?: string[]
}

export interface ServiceGraphDependencyRoute {
  dependencyId: string
  sourceScope: string
  targetScope: string
}

type ServiceNodeData = {
  service: ServiceGraphNode
  dependencies: number
  dependents: number
  environment: string
}

type EnvironmentGroupNodeData = {
  environment: string
  serviceCount: number
  linkCount: number
}

const GROUP_NODE_WIDTH = 1040
const GROUP_NODE_GAP = 120
const GROUP_HEADER_HEIGHT = 48
const GROUP_PADDING_X = 28
const GROUP_PADDING_Y = 72
const GROUP_NODE_MIN_HEIGHT = 320
const GROUP_SERVICE_COLUMNS = 3
const GROUP_SERVICE_HORIZONTAL_GAP = 320
const GROUP_SERVICE_VERTICAL_GAP = 170

const EDGE_ACTIVE_OPACITY = 0.95
const EDGE_INACTIVE_OPACITY = 0.38
const EDGE_DIMMED_OPACITY = 0.17

const ENV_EDGE_COLORS: Record<EnvName, string> = {
  production: '#22c55e',
  staging: '#a855f7',
  preview: '#06b6d4',
  development: '#f59e0b',
}

function getColorForEnvironment(environment: string): string {
  if (environment in ENV_EDGE_COLORS) {
    return ENV_EDGE_COLORS[environment as EnvName]
  }

  let hash = 0
  for (let index = 0; index < environment.length; index += 1) {
    hash = (hash << 5) - hash + environment.charCodeAt(index)
    hash |= 0
  }

  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 75% 55%)`
}

function isDependencyEnabledInEnvironment(dependency: DependencyRecord, environment: string): boolean {
  if (!dependency.enabledIn || dependency.enabledIn.length === 0) {
    return true
  }

  if (environment.startsWith('preview/') && dependency.enabledIn.includes('preview')) {
    return true
  }

  if (dependency.enabledIn.includes(environment)) {
    return true
  }

  return false
}

function isServiceInEnvironment(environments: string[], environment: string): boolean {
  if (environments.includes(environment)) {
    return true
  }

  if (environment.startsWith('preview/')) {
    return environments.includes('preview')
  }

  return false
}

function resolveTargetEnvironment(
  sourceEnvironment: string,
  availableTargetEnvironments: string[],
  explicitTargetEnvironment?: string,
): string | null {
  if (availableTargetEnvironments.length === 0) {
    return null
  }

  if (explicitTargetEnvironment) {
    if (availableTargetEnvironments.includes(explicitTargetEnvironment)) {
      return explicitTargetEnvironment
    }

    if (explicitTargetEnvironment === 'preview') {
      if (sourceEnvironment.startsWith('preview/') && availableTargetEnvironments.includes(sourceEnvironment)) {
        return sourceEnvironment
      }

      if (availableTargetEnvironments.includes('preview')) {
        return 'preview'
      }
    }
  }

  if (availableTargetEnvironments.includes(sourceEnvironment)) {
    return sourceEnvironment
  }

  if (sourceEnvironment.startsWith('preview/') && availableTargetEnvironments.includes('preview')) {
    return 'preview'
  }

  const preferredFallbacks = ['production', 'staging', 'preview', 'development']
  for (const fallback of preferredFallbacks) {
    if (availableTargetEnvironments.includes(fallback)) {
      return fallback
    }
  }

  return availableTargetEnvironments[0] ?? null
}

function computeServiceDepths(
  serviceIds: string[],
  dependencyIdsByServiceId: Map<string, string[]>,
): Map<string, number> {
  const depthMemo = new Map<string, number>()

  const computeDepth = (serviceId: string, stack: Set<string>): number => {
    const memoized = depthMemo.get(serviceId)
    if (memoized !== undefined) {
      return memoized
    }

    if (stack.has(serviceId)) {
      return 0
    }

    const nextStack = new Set(stack)
    nextStack.add(serviceId)
    const dependencies = dependencyIdsByServiceId.get(serviceId) ?? []

    let depth = 0
    for (const dependencyId of dependencies) {
      const dependencyDepth = computeDepth(dependencyId, nextStack) + 1
      depth = Math.max(depth, dependencyDepth)
    }

    depthMemo.set(serviceId, depth)
    return depth
  }

  for (const serviceId of serviceIds) {
    computeDepth(serviceId, new Set())
  }

  return depthMemo
}

function ServiceNode({ data }: NodeProps) {
  const nodeData = data as ServiceNodeData
  const projectIdLabel = nodeData.service.projectId.slice(0, 8)

  return (
    <div className="relative w-56">
      <Handle
        type="target"
        position={Position.Left}
        className="h-2.5! w-2.5! border-0! bg-primary/70!"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="h-2.5! w-2.5! border-0! bg-primary/70!"
      />

      <Card className="border-border/70 bg-card/85 shadow-md backdrop-blur-xl transition-all hover:border-primary/35 hover:shadow-lg">
        <CardHeader className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="truncate text-sm font-semibold">{nodeData.service.name}</CardTitle>
            <Badge variant={nodeData.service.isActive ? 'default' : 'secondary'}>
              {nodeData.service.isActive ? 'active' : 'inactive'}
            </Badge>
          </div>
          <CardDescription className="text-xs">
            type: <span className="font-medium text-foreground">{nodeData.service.type}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-2 pt-0 text-xs">
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/35 px-2 py-1.5">
            <span className="text-muted-foreground">project</span>
            <span className="font-mono text-[11px] text-foreground">{projectIdLabel}</span>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/35 px-2 py-1.5">
            <span className="text-muted-foreground">env</span>
            <span className="font-mono text-[11px] text-foreground">{nodeData.environment}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border/60 bg-muted/25 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">depends on</p>
              <p className="text-sm font-semibold">{nodeData.dependencies}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/25 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">depended by</p>
              <p className="text-sm font-semibold">{nodeData.dependents}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function EnvironmentGroupNode({ data }: NodeProps) {
  const nodeData = data as EnvironmentGroupNodeData
  const laneColor = getColorForEnvironment(nodeData.environment)

  return (
    <div className="pointer-events-none h-full w-full rounded-xl border border-border/60 bg-transparent p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/75 px-2 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: laneColor }} />
          <p className="text-xs font-semibold uppercase tracking-wide">{nodeData.environment}</p>
        </div>
        <div className="flex gap-1">
          <Badge variant="outline" className="text-[10px]">
            {nodeData.serviceCount} services
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {nodeData.linkCount} links
          </Badge>
        </div>
      </div>
    </div>
  )
}

export function ServiceDependencyGraphPanel({
  services,
  dependencies: providedDependencies,
  dependencyRoutes = [],
  serviceEnvironments = {},
  environmentOrder = [...ENV_NAMES],
  selectedEnvironment = 'all',
  title = 'Service dependency graph',
  description = 'Dependency flow runs left-to-right (dependency → service). Required links are solid, optional links are dashed.',
}: {
  services: ServiceGraphNode[]
  dependencies?: ServiceGraphDependency[]
  dependencyRoutes?: ServiceGraphDependencyRoute[]
  serviceEnvironments?: Record<string, string[]>
  environmentOrder?: string[]
  selectedEnvironment?: 'all' | string
  title?: string
  description?: string
}) {
  const sortedServices = useMemo(() => {
    return [...services].sort((a, b) => a.name.localeCompare(b.name))
  }, [services])

  const dependencyQueries = useQueries({
    queries: sortedServices.map((service) =>
      serviceEndpoints.dependencies.list.queryOptions({
        input: {
          params: { id: service.id },
          id: service.id,
        },
      }),
    ),
  })

  const loading = dependencyQueries.some((query) => query.isLoading)
  const hasDependencyError = dependencyQueries.some((query) => query.error)

  const dependencies: DependencyRecord[] = useMemo(() => {
    if (providedDependencies) {
      return providedDependencies.map((dependency) => ({
        id: dependency.id,
        serviceId: dependency.serviceId,
        dependsOnServiceId: dependency.dependsOnServiceId,
        isRequired: dependency.isRequired ?? true,
        enabledIn: dependency.enabledIn ? [...dependency.enabledIn] : undefined,
      }))
    }

    return dependencyQueries.flatMap((query) => {
      if (!query.data) return []
      return query.data.dependencies.map((dependency) => ({
        id: dependency.id,
        serviceId: dependency.serviceId,
        dependsOnServiceId: dependency.dependsOnServiceId,
        isRequired: dependency.isRequired,
      }))
    })
  }, [dependencyQueries, providedDependencies])

  const graph = useMemo(() => {
    const serviceById = new Map(sortedServices.map((service) => [service.id, service]))

    const environments: string[] = []
    const pushEnvironment = (environment: string | undefined) => {
      if (!environment) return
      if (!environments.includes(environment)) {
        environments.push(environment)
      }
    }

    for (const environment of environmentOrder) {
      pushEnvironment(environment)
    }
    for (const environment of ENV_NAMES) {
      pushEnvironment(environment)
    }
    for (const serviceScopeList of Object.values(serviceEnvironments)) {
      for (const environment of serviceScopeList) {
        pushEnvironment(environment)
      }
    }
    for (const dependency of dependencies) {
      for (const environment of dependency.enabledIn ?? []) {
        pushEnvironment(environment)
      }
    }

    const dependencyIdsByServiceId = new Map<string, string[]>()
    for (const service of sortedServices) {
      dependencyIdsByServiceId.set(service.id, [])
    }
    for (const dependency of dependencies) {
      if (!dependencyIdsByServiceId.has(dependency.serviceId)) {
        dependencyIdsByServiceId.set(dependency.serviceId, [])
      }
      dependencyIdsByServiceId.get(dependency.serviceId)?.push(dependency.dependsOnServiceId)
    }

    const serviceDepthById = computeServiceDepths(
      sortedServices.map((service) => service.id),
      dependencyIdsByServiceId,
    )

    const laneServiceIdsByEnvironment = new Map<string, string[]>()
    const laneLinkCount = new Map<string, number>()
    const nodeExistsByEnvironmentService = new Set<string>()
    const nodeCounts = new Map<string, { dependencies: number; dependents: number }>()
    const routeTargetByDependencyAndSourceScope = new Map<string, string>()

    for (const route of dependencyRoutes) {
      routeTargetByDependencyAndSourceScope.set(
        `${route.dependencyId}::${route.sourceScope}`,
        route.targetScope,
      )
    }

    for (const environment of environments) {
      const laneServices = sortedServices
        .filter((service) => isServiceInEnvironment(serviceEnvironments[service.id] ?? [], environment))
        .sort((left, right) => {
          if (left.isActive !== right.isActive) {
            return left.isActive ? -1 : 1
          }

          const leftDepth = serviceDepthById.get(left.id) ?? 0
          const rightDepth = serviceDepthById.get(right.id) ?? 0
          if (leftDepth !== rightDepth) {
            return rightDepth - leftDepth
          }

          return left.name.localeCompare(right.name)
        })

      const laneServiceIds = laneServices.map((service) => service.id)
      laneServiceIdsByEnvironment.set(environment, laneServiceIds)
      laneLinkCount.set(environment, 0)

      for (const serviceId of laneServiceIds) {
        const nodeId = `${environment}::${serviceId}`
        nodeExistsByEnvironmentService.add(nodeId)
        nodeCounts.set(nodeId, { dependencies: 0, dependents: 0 })
      }
    }

    const edges: Edge[] = []
    const edgeIdSet = new Set<string>()

    for (const dependency of dependencies) {
      if (!serviceById.has(dependency.serviceId) || !serviceById.has(dependency.dependsOnServiceId)) {
        continue
      }

      const sourceEnvironments = environments.filter((environment) => {
        const sourceNodeId = `${environment}::${dependency.dependsOnServiceId}`
        return nodeExistsByEnvironmentService.has(sourceNodeId)
          && isDependencyEnabledInEnvironment(dependency, environment)
      })

      const targetEnvironments = environments.filter((environment) => {
        const targetNodeId = `${environment}::${dependency.serviceId}`
        return nodeExistsByEnvironmentService.has(targetNodeId)
      })

      for (const sourceEnvironment of sourceEnvironments) {
        const explicitTargetEnvironment = routeTargetByDependencyAndSourceScope.get(
          `${dependency.id}::${sourceEnvironment}`,
        )
          ?? (
            sourceEnvironment.startsWith('preview/')
              ? routeTargetByDependencyAndSourceScope.get(`${dependency.id}::preview`)
              : undefined
          )

        const resolvedTargetEnvironment = resolveTargetEnvironment(
          sourceEnvironment,
          targetEnvironments,
          explicitTargetEnvironment,
        )
        if (!resolvedTargetEnvironment) {
          continue
        }

        const sourceNodeId = `${sourceEnvironment}::${dependency.dependsOnServiceId}`
        const targetNodeId = `${resolvedTargetEnvironment}::${dependency.serviceId}`

        if (!nodeExistsByEnvironmentService.has(sourceNodeId) || !nodeExistsByEnvironmentService.has(targetNodeId)) {
          continue
        }

        const edgeId = `${dependency.id}::${sourceEnvironment}::${resolvedTargetEnvironment}`
        if (edgeIdSet.has(edgeId)) {
          continue
        }
        edgeIdSet.add(edgeId)

        const sourceService = serviceById.get(dependency.dependsOnServiceId)
        const targetService = serviceById.get(dependency.serviceId)
        const isActivated = Boolean(sourceService?.isActive && targetService?.isActive)
        const isCrossEnvironment = sourceEnvironment !== resolvedTargetEnvironment
        const isSelectedLane = selectedEnvironment === 'all'
          || selectedEnvironment === sourceEnvironment
          || selectedEnvironment === resolvedTargetEnvironment
          || (selectedEnvironment === 'preview' && (sourceEnvironment.startsWith('preview/') || resolvedTargetEnvironment.startsWith('preview/')))

        const sourceCounts = nodeCounts.get(sourceNodeId)
        if (sourceCounts) {
          sourceCounts.dependencies += 1
        }
        const targetCounts = nodeCounts.get(targetNodeId)
        if (targetCounts) {
          targetCounts.dependents += 1
        }

        laneLinkCount.set(sourceEnvironment, (laneLinkCount.get(sourceEnvironment) ?? 0) + 1)
        if (isCrossEnvironment) {
          laneLinkCount.set(resolvedTargetEnvironment, (laneLinkCount.get(resolvedTargetEnvironment) ?? 0) + 1)
        }

        const strokeColor = getColorForEnvironment(sourceEnvironment)

        edges.push({
          id: edgeId,
          source: sourceNodeId,
          target: targetNodeId,
          type: 'smoothstep',
          zIndex: 3,
          animated: !dependency.isRequired && isActivated,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: strokeColor,
          },
          style: {
            stroke: strokeColor,
            strokeOpacity: isSelectedLane
              ? (isActivated ? EDGE_ACTIVE_OPACITY : EDGE_INACTIVE_OPACITY)
              : EDGE_DIMMED_OPACITY,
            strokeWidth: dependency.isRequired ? 2 : 1.5,
            strokeDasharray: isActivated
              ? dependency.isRequired
                ? undefined
                : '6 4'
              : '3 5',
          },
        })
      }
    }

    const nodes: Node[] = []

    for (let laneIndex = 0; laneIndex < environments.length; laneIndex += 1) {
      const environment = environments[laneIndex]
      if (!environment) {
        continue
      }

      const laneServiceIds = laneServiceIdsByEnvironment.get(environment) ?? []
      const laneRows = Math.max(1, Math.ceil(laneServiceIds.length / GROUP_SERVICE_COLUMNS))
      const laneHeight = Math.max(
        GROUP_NODE_MIN_HEIGHT,
        GROUP_HEADER_HEIGHT + GROUP_PADDING_Y + laneRows * GROUP_SERVICE_VERTICAL_GAP,
      )
      const laneX = laneIndex * (GROUP_NODE_WIDTH + GROUP_NODE_GAP)
      const laneId = `env-group::${environment}`
      const isSelectedLane = selectedEnvironment === 'all'
        || selectedEnvironment === environment
        || (selectedEnvironment === 'preview' && environment.startsWith('preview/'))

      nodes.push({
        id: laneId,
        type: 'environmentGroup',
        position: { x: laneX, y: 0 },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: -2,
        data: {
          environment,
          serviceCount: laneServiceIds.length,
          linkCount: laneLinkCount.get(environment) ?? 0,
        },
        style: {
          width: GROUP_NODE_WIDTH,
          height: laneHeight,
          borderRadius: 14,
          padding: 0,
          background: 'transparent',
          border: 'none',
          opacity: isSelectedLane ? 1 : 0.48,
        },
      })

      for (let serviceIndex = 0; serviceIndex < laneServiceIds.length; serviceIndex += 1) {
        const serviceId = laneServiceIds[serviceIndex]
        if (!serviceId) {
          continue
        }

        const service = serviceById.get(serviceId)
        if (!service) {
          continue
        }

        const column = serviceIndex % GROUP_SERVICE_COLUMNS
        const row = Math.floor(serviceIndex / GROUP_SERVICE_COLUMNS)
        const nodeId = `${environment}::${service.id}`
        const counts = nodeCounts.get(nodeId)

        nodes.push({
          id: nodeId,
          type: 'serviceNode',
          draggable: false,
          zIndex: 6,
          style: {
            opacity: isSelectedLane
              ? (service.isActive ? 1 : 0.72)
              : 0.3,
          },
          position: {
            x: laneX + GROUP_PADDING_X + column * GROUP_SERVICE_HORIZONTAL_GAP,
            y: GROUP_PADDING_Y + row * GROUP_SERVICE_VERTICAL_GAP,
          },
          data: {
            service,
            environment,
            dependencies: counts?.dependencies ?? 0,
            dependents: counts?.dependents ?? 0,
          },
        })
      }
    }

    return { nodes, edges, environments }
  }, [dependencies, dependencyRoutes, environmentOrder, selectedEnvironment, serviceEnvironments, sortedServices])

  if (sortedServices.length === 0) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur-xl">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          No services detected yet. Create services to visualize dependency topology.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur-xl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <GitBranch className="h-3.5 w-3.5" />
            {sortedServices.length} services
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Link2 className="h-3.5 w-3.5" />
            {dependencies.length} links
          </Badge>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">edge colors:</Badge>
        {graph.environments.map((environment) => (
          <Badge key={environment} variant="outline" className="gap-1 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: getColorForEnvironment(environment) }} />
            {environment}
          </Badge>
        ))}
      </div>

      {hasDependencyError ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-3.5 w-3.5" />
            Some dependency links could not be loaded.
          </span>
        </div>
      ) : null}

      <div className="h-150 w-full overflow-hidden rounded-xl border border-border/60 bg-background/70">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={{
            serviceNode: ServiceNode,
            environmentGroup: EnvironmentGroupNode,
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        </ReactFlow>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Refreshing dependency topology…</p>
      ) : null}
    </section>
  )
}
