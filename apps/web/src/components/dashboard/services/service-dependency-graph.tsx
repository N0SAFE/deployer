'use client'

import type { JSX } from 'react'
import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { cn } from '@/lib/utils'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  type Service,
  ServiceTypeIcon,
  serviceTypeConfig,
  statusConfig,
} from './service-card'

// Service dependency types
export interface ServiceDependency {
  sourceId: string
  targetId: string
  type: 'runtime' | 'build' | 'optional'
}

interface ServiceDependencyGraphProps {
  services: Service[]
  dependencies: ServiceDependency[]
  onSelectService?: (service: Service) => void
  className?: string
  interactive?: boolean
}

// Custom node component for services
interface ServiceNodeData extends Record<string, unknown> {
  service: Service
  onSelect?: (service: Service) => void
}

function ServiceNode({ data }: { data: ServiceNodeData }): JSX.Element {
  const { service, onSelect } = data
  const typeConfig = serviceTypeConfig[service.type]
  const statusCfg = statusConfig[service.status]

  return (
    <div
      className={cn(
        'bg-card rounded-lg border-2 p-3 shadow-md transition-all',
        'min-w-[180px] cursor-pointer',
        service.status === 'running' && 'border-green-500',
        service.status === 'failed' && 'border-red-500',
        service.status === 'deploying' && 'border-amber-500',
        service.status === 'stopped' && 'border-gray-400',
        service.status === 'unknown' && 'border-gray-300'
      )}
      onClick={() => onSelect?.(service)}
    >
      {/* Input handle (for dependencies) */}
      <Handle
        type="target"
        position={Position.Top}
        className="bg-primary! h-3! w-3!"
      />

      <div className="flex items-center gap-2">
        <div className={cn('rounded p-1.5', typeConfig.color)}>
          <ServiceTypeIcon type={service.type} className="h-4 w-4" />
        </div>
        <div className="flex-1 truncate">
          <div className="truncate text-sm font-medium">{service.name}</div>
          <div className="text-muted-foreground text-xs">{service.runtime}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <Badge variant="outline" className="text-xs">
          {typeConfig.label}
        </Badge>
        <Badge variant={statusCfg.variant} className="text-xs">
          {statusCfg.label}
        </Badge>
      </div>

      {/* Output handle (for dependents) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="bg-primary! h-3! w-3!"
      />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  service: ServiceNode,
}

// Edge style configuration
const edgeTypeStyles: Record<ServiceDependency['type'], { color: string; strokeDasharray?: string }> = {
  runtime: { color: '#22c55e' }, // green for runtime
  build: { color: '#3b82f6' }, // blue for build
  optional: { color: '#a855f7', strokeDasharray: '5,5' }, // purple dashed for optional
}

// Auto-layout helper using simple layered approach
function calculateLayout(
  services: Service[],
  dependencies: ServiceDependency[]
): { nodes: Node<ServiceNodeData>[]; edges: Edge[] } {
  // Build adjacency list
  const dependsOn = new Map<string, string[]>()
  const dependedBy = new Map<string, string[]>()
  
  services.forEach((s) => {
    dependsOn.set(s.id, [])
    dependedBy.set(s.id, [])
  })
  
  dependencies.forEach((dep) => {
    dependsOn.get(dep.sourceId)?.push(dep.targetId)
    dependedBy.get(dep.targetId)?.push(dep.sourceId)
  })

  // Calculate layer for each node (topological sort with levels)
  const layers = new Map<string, number>()
  const visited = new Set<string>()
  
  function getLayer(id: string, depth = 0): number {
    if (visited.has(id)) return layers.get(id) ?? 0
    visited.add(id)
    
    const deps = dependsOn.get(id) ?? []
    const maxDepLayer = deps.length > 0 
      ? Math.max(...deps.map((d) => getLayer(d, depth + 1)))
      : -1
    
    const layer = maxDepLayer + 1
    layers.set(id, layer)
    return layer
  }
  
  services.forEach((s) => getLayer(s.id))

  // Group services by layer
  const layerGroups = new Map<number, Service[]>()
  services.forEach((s) => {
    const layer = layers.get(s.id) ?? 0
    if (!layerGroups.has(layer)) {
      layerGroups.set(layer, [])
    }
    layerGroups.get(layer)?.push(s)
  })

  // Position nodes
  const nodeWidth = 200
  const nodeHeight = 100
  const horizontalGap = 80
  const verticalGap = 120
  const maxPerRow = 4

  const nodes: Node<ServiceNodeData>[] = []
  const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => b - a)
  
  sortedLayers.forEach((layer, layerIndex) => {
    const layerServices = layerGroups.get(layer) ?? []
    layerServices.forEach((service, i) => {
      const row = Math.floor(i / maxPerRow)
      const col = i % maxPerRow
      const rowCount = Math.min(layerServices.length - row * maxPerRow, maxPerRow)
      const startX = -(rowCount - 1) * (nodeWidth + horizontalGap) / 2

      nodes.push({
        id: service.id,
        type: 'service',
        position: {
          x: startX + col * (nodeWidth + horizontalGap),
          y: layerIndex * (nodeHeight + verticalGap) + row * (nodeHeight + verticalGap / 2),
        },
        data: {
          service,
          onSelect: undefined, // Will be set in component
        },
      })
    })
  })

  // Create edges
  const edges: Edge[] = dependencies.map((dep) => {
    const style = edgeTypeStyles[dep.type]
    return {
      id: `${dep.sourceId}-${dep.targetId}`,
      source: dep.sourceId,
      target: dep.targetId,
      type: 'smoothstep',
      animated: dep.type === 'runtime',
      style: {
        stroke: style.color,
        strokeWidth: 2,
        strokeDasharray: style.strokeDasharray,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: style.color,
      },
      label: dep.type !== 'runtime' ? dep.type : undefined,
      labelStyle: { fill: style.color, fontWeight: 500, fontSize: 10 },
      labelBgStyle: { fill: 'white', fillOpacity: 0.8 },
    }
  })

  return { nodes, edges }
}

export function ServiceDependencyGraph({
  services,
  dependencies,
  onSelectService,
  className,
  interactive = true,
}: ServiceDependencyGraphProps): JSX.Element {
  // Calculate initial layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => calculateLayout(services, dependencies),
    [services, dependencies]
  )

  // Add onSelect callback to nodes
  const nodesWithCallbacks = useMemo(() => {
    return initialNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onSelect: onSelectService,
      },
    }))
  }, [initialNodes, onSelectService])

  const [nodes, , onNodesChange] = useNodesState(nodesWithCallbacks)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect: OnConnect = useCallback(
    (params) => {setEdges((eds) => addEdge(params, eds))},
    [setEdges]
  )

  if (services.length === 0) {
    return (
      <div className={cn('flex h-96 items-center justify-center rounded-lg border', className)}>
        <p className="text-muted-foreground">No services to display</p>
      </div>
    )
  }

  return (
    <div className={cn('h-[600px] w-full rounded-lg border', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={interactive ? onNodesChange : undefined}
        onEdgesChange={interactive ? onEdgesChange : undefined}
        onConnect={interactive ? onConnect : undefined}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={interactive} />
        <MiniMap
          nodeStrokeColor={(node) => {
            const service = (node.data as ServiceNodeData).service
            if (service.status === 'running') return '#22c55e'
            if (service.status === 'failed') return '#ef4444'
            if (service.status === 'deploying') return '#f59e0b'
            return '#6b7280'
          }}
          nodeColor={(node) => {
            const service = (node.data as ServiceNodeData).service
            return serviceTypeConfig[service.type].color.includes('blue')
              ? '#dbeafe'
              : serviceTypeConfig[service.type].color.includes('green')
                ? '#dcfce7'
                : serviceTypeConfig[service.type].color.includes('purple')
                  ? '#f3e8ff'
                  : '#f3f4f6'
          }}
          nodeBorderRadius={8}
        />
      </ReactFlow>

      {/* Legend */}
      <div className="bg-card/80 absolute bottom-4 left-4 rounded-lg border p-3 text-xs backdrop-blur">
        <div className="mb-2 font-medium">Legend</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-6 bg-green-500" />
            <span>Runtime (animated)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-6 bg-blue-500" />
            <span>Build</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="h-0.5 w-6 bg-purple-500"
              style={{ backgroundImage: 'repeating-linear-gradient(90deg, #a855f7 0, #a855f7 3px, transparent 3px, transparent 6px)' }}
            />
            <span>Optional</span>
          </div>
        </div>
      </div>
    </div>
  )
}

