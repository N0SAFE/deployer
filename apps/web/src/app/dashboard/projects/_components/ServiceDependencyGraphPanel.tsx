'use client'

import { useCallback, useMemo } from 'react'
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
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import '@/assets/css/xyflow.css'
import { AlertCircle, GitBranch, Link2, FolderTree, Layers } from 'lucide-react'
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
import { StatusBadge, statusMeta } from '@/components/dashboard'
import { cn } from '@/lib/utils'

export interface ServiceGraphNode {
  id: string
  name: string
  type: string
  projectId: string
  isActive: boolean
  /** Non-null when this service is a sub-service of another (hierarchy). */
  parentId?: string | null
  status?: string
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
  onNavigate?: (serviceId: string) => void
}

type EnvironmentGroupNodeData = {
  environment: string
  serviceCount: number
  linkCount: number
}

type SubserviceGroupNodeData = {
  service: ServiceGraphNode
  childCount: number
  environment: string
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

/** Status-aware node card — status badge replaces the plain active/inactive. */
function ServiceNode({ data }: NodeProps) {
  const nodeData = data as ServiceNodeData
  const projectIdLabel = nodeData.service.projectId.slice(0, 8)
  const status = nodeData.service.status ?? (nodeData.service.isActive ? 'active' : 'inactive')
  const isSubService = Boolean(nodeData.service.parentId)

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

      <Card
        className={cn(
          'border-border/70 bg-card/85 shadow-md backdrop-blur-xl transition-all hover:border-primary/35 hover:shadow-lg',
          isSubService && 'border-dashed',
        )}
      >
        <CardHeader className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="truncate text-sm font-semibold">{nodeData.service.name}</CardTitle>
            <StatusBadge status={status} showDot />
          </div>
          <CardDescription className="text-xs">
            type: <span className="font-medium text-foreground">{nodeData.service.type}</span>
            {isSubService ? <span className="text-muted-foreground"> · sub-service</span> : null}
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

/**
 * Group node that wraps the sub-services of a parent service (react-flow
 * `parentId`-style group). Renders a header band with the parent identity
 * and a child-count badge; children are positioned inside it.
 */
function SubserviceGroupNode({ data }: NodeProps) {
  const nodeData = data as SubserviceGroupNodeData
  const status = nodeData.service.status ?? (nodeData.service.isActive ? 'active' : 'inactive')
  const meta = statusMeta(status)

  return (
    <div className="h-full w-full rounded-xl border border-border/60 bg-card/30 p-2 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/75 px-2 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className={cn('inline-block size-2 rounded-full', meta.dotClass)} />
          <p className="truncate text-xs font-semibold">{nodeData.service.name}</p>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <FolderTree className="size-2.5" /> {nodeData.childCount} sub
          </Badge>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{nodeData.environment}</span>
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
  onServiceClick,
  title = 'Service dependency graph',
  description = 'Dependency flow runs left-to-right (dependency → service). Required links are solid, optional links are dashed. Sub-services nest inside their parent.',
}: {
  services: ServiceGraphNode[]
  dependencies?: ServiceGraphDependency[]
  dependencyRoutes?: ServiceGraphDependencyRoute[]
  serviceEnvironments?: Record<string, string[]>
  environmentOrder?: string[]
  selectedEnvironment?: 'all' | string
  /** Called when a service node is clicked (drill-down). */
  onServiceClick?: (serviceId: string) => void
  title?: string
  description?: string
}) {
  const sortedServices = useMemo(() => {
    return [...services].sort((a, b) => a.name.localeCompare(b.name))
  }, [services])

  // When the parent already provides dependency data, skip our own queries
  const skipOwnQueries = providedDependencies !== undefined

  // Only fetch for real UUID service ids — never a `:id` template placeholder.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  const dependencyQueries = useQueries({
    queries: skipOwnQueries
      ? []
      : sortedServices
          .filter((service) => UUID_RE.test(service.id))
          .map((service) =>
            serviceEndpoints.dependencies.list.queryOptions({
              input: {
                params: { id: service.id },
                id: service.id,
              },
            }),
          ),
  })

  const loading = skipOwnQueries ? false : dependencyQueries.some((query) => query.isLoading)
  const hasDependencyError = skipOwnQueries ? false : dependencyQueries.some((query) => query.error)

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

  // Stable navigation callback so node renders don't thrash.
  const navigate = useCallback(
    (serviceId: string) => {
      onServiceClick?.(serviceId)
    },
    [onServiceClick],
  )

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

    const isEnvironmentSelected = (environment: string): boolean => {
      if (selectedEnvironment === 'all') return true
      if (selectedEnvironment === environment) return true
      if (selectedEnvironment === 'preview' && environment.startsWith('preview/')) return true
      return false
    }
    const activeEnvironments = environments.filter(isEnvironmentSelected)

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

    // ── Hierarchy: build parent → children map (only for real parents in view) ──
    const childrenByParentId = new Map<string, ServiceGraphNode[]>()
    for (const service of sortedServices) {
      if (!service.parentId) continue
      const list = childrenByParentId.get(service.parentId) ?? []
      list.push(service)
      childrenByParentId.set(service.parentId, list)
    }
    const parentServices = sortedServices.filter((s) => childrenByParentId.has(s.id))
    const parentIdSet = new Set(parentServices.map((p) => p.id))

    for (const environment of activeEnvironments) {
      const laneServices = sortedServices
        .filter((service) => isServiceInEnvironment(
          serviceEnvironments[service.id]?.length ? serviceEnvironments[service.id]! : [...ENV_NAMES],
          environment,
        ))
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

      const sourceEnvironments = activeEnvironments.filter((environment) => {
        const sourceNodeId = `${environment}::${dependency.dependsOnServiceId}`
        return nodeExistsByEnvironmentService.has(sourceNodeId)
          && isDependencyEnabledInEnvironment(dependency, environment)
      })

      const targetEnvironments = activeEnvironments.filter((environment) => {
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
          label: dependency.isRequired ? undefined : 'optional',
          labelStyle: { fill: '#9ca3af', fontSize: 9 },
          labelBgStyle: { fill: 'rgba(255,255,255,0.85)', fillOpacity: 0.7 },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 4,
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

    for (let laneIndex = 0; laneIndex < activeEnvironments.length; laneIndex += 1) {
      const environment = activeEnvironments[laneIndex]
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
      const isSelectedLane = isEnvironmentSelected(environment)

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

      // ── Per-lane placement: parents first, their children after ──
      const laneParents = laneServiceIds.filter((id) => parentIdSet.has(id))
      const laneChildren = laneServiceIds.filter((id) => !parentIdSet.has(id))
      const laneParentsWithChildren = laneParents.filter((id) =>
        (childrenByParentId.get(id) ?? []).some((child) => laneServiceIds.includes(child.id)),
      )
      const laneParentsAlone = laneParents.filter((id) => !laneParentsWithChildren.includes(id))
      const laneOrderedIds = [...laneParentsAlone, ...laneParentsWithChildren, ...laneChildren]

      let column = 0
      let row = 0
      const groupSlotByParentId = new Map<string, number>()

      const bump = () => {
        column += 1
        if (column >= GROUP_SERVICE_COLUMNS) {
          column = 0
          row += 1
        }
      }

      for (const serviceId of laneOrderedIds) {
        const service = serviceById.get(serviceId)
        if (!service) continue

        const isGroupParent = laneParentsWithChildren.includes(serviceId)
        const childCount = isGroupParent
          ? (childrenByParentId.get(serviceId) ?? []).filter((c) => laneServiceIds.includes(c.id)).length
          : 0

        if (isGroupParent) {
          // Reserve one grid cell for the group header + its children below.
          const groupNodeId = `${environment}::group::${serviceId}`
          const groupX = laneX + GROUP_PADDING_X + column * GROUP_SERVICE_HORIZONTAL_GAP
          const groupY = GROUP_PADDING_Y + row * GROUP_SERVICE_VERTICAL_GAP
          groupSlotByParentId.set(serviceId, laneOrderedIds.indexOf(serviceId))

          nodes.push({
            id: groupNodeId,
            type: 'subserviceGroup',
            position: { x: groupX, y: groupY },
            draggable: false,
            selectable: false,
            connectable: false,
            zIndex: 4,
            data: {
              service,
              childCount,
              environment,
            },
            style: {
              width: GROUP_SERVICE_HORIZONTAL_GAP - 40,
              height: GROUP_SERVICE_VERTICAL_GAP - 40,
              borderRadius: 12,
              padding: 0,
              opacity: isSelectedLane ? 1 : 0.3,
            },
          })

          // Children positioned just below the group header.
          const childrenInLane = (childrenByParentId.get(serviceId) ?? []).filter((c) => laneServiceIds.includes(c.id))
          childrenInLane.forEach((child, childIndex) => {
            const childNodeId = `${environment}::${child.id}`
            const counts = nodeCounts.get(childNodeId)
            nodes.push({
              id: childNodeId,
              type: 'serviceNode',
              draggable: false,
              zIndex: 6,
              style: { opacity: isSelectedLane ? (child.isActive ? 1 : 0.72) : 0.3 },
              position: {
                x: groupX + 14,
                y: groupY + 46 + childIndex * 118,
              },
              data: {
                service: child,
                environment,
                dependencies: counts?.dependencies ?? 0,
                dependents: counts?.dependents ?? 0,
                onNavigate: navigate,
              },
            })
            nodeExistsByEnvironmentService.add(childNodeId)
          })

          bump()
          continue
        }

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
            onNavigate: navigate,
          },
        })
        bump()
      }
    }

    return { nodes, edges, environments: activeEnvironments }
  }, [dependencies, dependencyRoutes, environmentOrder, selectedEnvironment, serviceEnvironments, sortedServices, navigate])

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as ServiceNodeData | undefined
      if (data?.service?.id) {
        navigate(data.service.id)
      }
    },
    [navigate],
  )

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
        <span className="mx-1 h-3 w-px bg-border" />
        <Badge variant="outline" className="gap-1 text-[10px]"><span className="inline-block h-0.5 w-4 bg-foreground/70" /> required</Badge>
        <Badge variant="outline" className="gap-1 text-[10px]"><span className="inline-block h-0.5 w-4 border-t border-dashed border-foreground/70" /> optional</Badge>
        <Badge variant="outline" className="gap-1 text-[10px]"><Layers className="size-2.5" /> dashed border = sub-service</Badge>
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
            subserviceGroup: SubserviceGroupNode,
          }}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          onNodeClick={handleNodeClick}
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
