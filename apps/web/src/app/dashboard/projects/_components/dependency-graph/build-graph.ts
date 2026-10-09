import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { ENV_NAMES } from '@repo/contracts-common'
import {
  EDGE_ACTIVE_OPACITY,
  EDGE_DIMMED_OPACITY,
  EDGE_INACTIVE_OPACITY,
  GROUP_HEADER_HEIGHT,
  GROUP_NODE_GAP,
  GROUP_NODE_MIN_HEIGHT,
  GROUP_NODE_WIDTH,
  GROUP_PADDING_X,
  GROUP_PADDING_Y,
  GROUP_SERVICE_COLUMNS,
  GROUP_SERVICE_HORIZONTAL_GAP,
  GROUP_SERVICE_VERTICAL_GAP,
  computeServiceDepths,
  getColorForEnvironment,
  isDependencyEnabledInEnvironment,
  isServiceInEnvironment,
  resolveTargetEnvironment,
} from './graph-env'
import type { DependencyRecord, ServiceGraphDependencyRoute, ServiceGraphNode } from './graph-types'

export interface BuildGraphInput {
  sortedServices: ServiceGraphNode[]
  dependencies: DependencyRecord[]
  dependencyRoutes: ServiceGraphDependencyRoute[]
  environmentOrder: string[]
  selectedEnvironment: string
  serviceEnvironments: Record<string, string[]>
  navigate: (serviceId: string) => void
}

/** Lay the services out as one lane per environment and derive the edges. Pure. */
export function buildGraph({
  sortedServices,
  dependencies,
  dependencyRoutes,
  environmentOrder,
  selectedEnvironment,
  serviceEnvironments,
  navigate,
}: BuildGraphInput): { nodes: Node[]; edges: Edge[]; environments: string[] } {
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

  const environmentsOf = (serviceId: string): string[] => {
    const own = serviceEnvironments[serviceId]
    return own && own.length > 0 ? own : [...ENV_NAMES]
  }

  for (const environment of activeEnvironments) {
    const laneServices = sortedServices
      .filter((service) => isServiceInEnvironment(
        environmentsOf(service.id),
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
}
