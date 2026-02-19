'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  addEdge,
  BackgroundVariant,
  MarkerType,
  NodeMouseHandler,
  Handle,
  Position,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Network, Server, AlertTriangle, Plus, RefreshCw, Trash2, Eye, Edit, Link2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@repo/ui/components/shadcn/context-menu'
import { useProjectDependencyGraph, useAddServiceDependency, useRemoveServiceDependency } from '@/hooks/useServices'
import { toast } from 'sonner'

// Types for service node data
interface ServiceNodeData extends Record<string, unknown> {
  service: {
    id: string
    name: string
    type: string
    status: 'healthy' | 'unhealthy' | 'unknown' | 'starting' | 'deploying' | 'failed'
    isActive: boolean
    port: number | null
    latestDeployment?: {
      id: string
      status: string
      environment: string
      createdAt: Date
      domainUrl: string | null
    }
  }
  onAddDependency?: (serviceId: string) => void
}

// Custom Service Node Component with Context Menu
function ServiceNode({ data }: { data: ServiceNodeData }) {
  const { service } = data

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500'
      case 'deploying': return 'bg-blue-500'
      case 'failed': return 'bg-red-500'
      case 'unhealthy': return 'bg-orange-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'healthy': return 'Healthy'
      case 'deploying': return 'Deploying'
      case 'failed': return 'Failed'
      case 'unhealthy': return 'Unhealthy'
      default: return 'Unknown'
    }
  }

  const handleViewDetails = () => {
    const event = new CustomEvent('service-view-details', { detail: { service } })
    window.dispatchEvent(event)
  }

  const handleEditService = () => {
    const event = new CustomEvent('service-edit', { detail: { service } })
    window.dispatchEvent(event)
  }

  const handleAddDependencyFrom = () => {
    const event = new CustomEvent('service-add-dependency-from', { detail: { serviceId: service.id } })
    window.dispatchEvent(event)
  }

  const handleAddDependencyTo = () => {
    const event = new CustomEvent('service-add-dependency-to', { detail: { serviceId: service.id } })
    window.dispatchEvent(event)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative">
          {/* Source handles (top and right) */}
          <Handle
            type="source"
            position={Position.Top}
            id="source-top"
            style={{ background: '#555' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="source-right"
            style={{ background: '#555' }}
          />
          
          {/* Target handles (bottom and left) */}
          <Handle
            type="target"
            position={Position.Bottom}
            id="target-bottom"
            style={{ background: '#555' }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="target-left"
            style={{ background: '#555' }}
          />

          <Card className="w-64 shadow-md hover:shadow-lg transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={`h-3 w-3 rounded-full ${getStatusColor(service.status)}`} />
                  <CardTitle className="text-sm font-medium truncate">{service.name}</CardTitle>
                </div>
                <Badge variant="outline" className="text-xs">
                  {service.type}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`font-medium ${
                    service.status === 'healthy' ? 'text-green-600' :
                    service.status === 'deploying' ? 'text-blue-600' :
                    service.status === 'failed' ? 'text-red-600' :
                    service.status === 'unhealthy' ? 'text-orange-600' :
                    'text-gray-600'
                  }`}>
                    {getStatusText(service.status)}
                  </span>
                </div>
                {service.port && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Port</span>
                    <span className="font-mono">{service.port}</span>
                  </div>
                )}
                {service.latestDeployment && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Environment</span>
                    <span className="font-medium">{service.latestDeployment.environment}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </ContextMenuTrigger>
      
      <ContextMenuContent>
        <ContextMenuItem onClick={handleViewDetails}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </ContextMenuItem>
        <ContextMenuItem onClick={handleEditService}>
          <Edit className="mr-2 h-4 w-4" />
          Edit Service
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleAddDependencyFrom}>
          <Link2 className="mr-2 h-4 w-4" />
          Add Dependency From
        </ContextMenuItem>
        <ContextMenuItem onClick={handleAddDependencyTo}>
          <Plus className="mr-2 h-4 w-4" />
          Add Dependency To
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Custom Edge Component with Context Menu
function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const handleViewDetails = () => {
    const event = new CustomEvent('edge-view-details', { detail: { edgeId: id } })
    window.dispatchEvent(event)
  }

  const handleDeleteEdge = () => {
    const event = new CustomEvent('edge-delete', { detail: { edgeId: id } })
    window.dispatchEvent(event)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <g>
          <path
            id={id}
            style={style}
            className="react-flow__edge-path"
            d={edgePath}
            markerEnd={markerEnd}
            strokeWidth={2}
          />
          {/* Invisible wider path for easier clicking */}
          <path
            d={edgePath}
            fill="none"
            strokeOpacity={0}
            strokeWidth={20}
            className="react-flow__edge-interaction"
          />
        </g>
      </ContextMenuTrigger>
      
      <ContextMenuContent>
        <ContextMenuItem onClick={handleViewDetails}>
          <Eye className="mr-2 h-4 w-4" />
          View Details
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDeleteEdge} className="text-red-600">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Dependency
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface DependencyGraphClientProps {
  projectId: string
}

export default function DependencyGraphClient({ projectId }: DependencyGraphClientProps) {
  const { data, isLoading, error, refetch } = useProjectDependencyGraph(projectId)
  const addDependencyMutation = useAddServiceDependency()
  const removeDependencyMutation = useRemoveServiceDependency()
  
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean
    edge: {
      id: string
      sourceId: string
      targetId: string
      sourceName: string
      targetName: string
    } | null
  }>({ isOpen: false, edge: null })

  // Tree-based layout algorithm
  const calculateTreeLayout = useCallback((services: Array<{ id: string, name: string }>, edges: Array<{ sourceId: string, targetId: string }>) => {
    const nodeSpacing = {
      horizontal: 350, // Increased horizontal spacing between nodes at same level
      vertical: 300    // Increased vertical spacing between dependency levels
    }

    // Build dependency graph
    const dependents = new Map<string, Set<string>>()
    const dependencies = new Map<string, Set<string>>()
    
    // Initialize sets for all services
    services.forEach(service => {
      dependents.set(service.id, new Set())
      dependencies.set(service.id, new Set())
    })
    
    // Build dependency relationships
    edges.forEach(edge => {
      const { sourceId, targetId } = edge
      dependents.get(targetId)?.add(sourceId) // targetId is depended on by sourceId
      dependencies.get(sourceId)?.add(targetId) // sourceId depends on targetId
    })

    // Find root nodes (nodes with no dependencies)
    const rootNodes = services.filter(service => 
      dependencies.get(service.id)?.size === 0
    )

    // Calculate depth for each node using BFS
    const nodeDepths = new Map<string, number>()
    const queue: Array<{ id: string, depth: number }> = []
    
    // Start with root nodes at depth 0
    rootNodes.forEach(service => {
      nodeDepths.set(service.id, 0)
      queue.push({ id: service.id, depth: 0 })
    })
    
    // BFS to calculate depths
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      const serviceDependents = dependents.get(id) || new Set()
      
      serviceDependents.forEach(dependentId => {
        const currentDepth = nodeDepths.get(dependentId)
        const newDepth = depth + 1
        
        if (currentDepth === undefined || newDepth > currentDepth) {
          nodeDepths.set(dependentId, newDepth)
          queue.push({ id: dependentId, depth: newDepth })
        }
      })
    }

    // Handle nodes that might not have been reached (isolated components)
    services.forEach(service => {
      if (!nodeDepths.has(service.id)) {
        nodeDepths.set(service.id, 0)
      }
    })

    // Group nodes by depth
    const nodesByDepth = new Map<number, string[]>()
    nodeDepths.forEach((depth, serviceId) => {
      if (!nodesByDepth.has(depth)) {
        nodesByDepth.set(depth, [])
      }
      nodesByDepth.get(depth)!.push(serviceId)
    })

    // Calculate positions
    const positions = new Map<string, { x: number, y: number }>()
    
    nodesByDepth.forEach((nodesAtDepth, depth) => {
      const totalWidth = (nodesAtDepth.length - 1) * nodeSpacing.horizontal
      const startX = -totalWidth / 2
      
      nodesAtDepth.forEach((serviceId, index) => {
        positions.set(serviceId, {
          x: startX + (index * nodeSpacing.horizontal),
          y: depth * nodeSpacing.vertical
        })
      })
    })

    return positions
  }, [])

  // Convert API data to React Flow format with tree-based layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] }

    console.log('🔍 [DEBUG] Raw API data:', data)
    console.log('🔍 [DEBUG] API edges:', data.edges)

    // Calculate tree-based positions
    const positions = calculateTreeLayout(data.nodes, data.edges)

    const nodes: Node[] = data.nodes.map((service) => {
      const position = positions.get(service.id) ?? { x: 0, y: 0 }
      
      return {
        id: service.id,
        type: 'service',
        position,
        data: { 
          service,
          onAddDependency: (serviceId: string) => setSelectedService(serviceId),
        } as ServiceNodeData,
      }
    })

    console.log('🔍 [DEBUG] Generated nodes with tree layout:', nodes)
    console.log('🔍 [DEBUG] Node IDs:', nodes.map(n => n.id))

    const edges: Edge[] = data.edges.map((edge) => {
      console.log('🔍 [DEBUG] Processing edge:', edge)
      console.log('🔍 [DEBUG] Edge source:', edge.sourceId, 'target:', edge.targetId)
      
      // Validate that source and target nodes exist
      const sourceExists = nodes.find(n => n.id === edge.sourceId)
      const targetExists = nodes.find(n => n.id === edge.targetId)
      
      console.log('🔍 [DEBUG] Source exists:', !!sourceExists, 'Target exists:', !!targetExists)
      
      if (!sourceExists || !targetExists) {
        console.warn('⚠️ [WARNING] Edge with missing node:', {
          edgeId: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          sourceExists: !!sourceExists,
          targetExists: !!targetExists
        })
      }
      
      return {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: 'custom',
        animated: false,
        style: {
          stroke: edge.isRequired ? '#ef4444' : '#64748b',
          strokeWidth: 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.isRequired ? '#ef4444' : '#64748b',
        },
        label: edge.isRequired ? 'Required' : 'Optional',
        labelStyle: {
          fontSize: 10,
          fontWeight: 500,
          fill: edge.isRequired ? '#ef4444' : '#64748b',
        },
        deletable: true
      }
    })

    console.log('🔍 [DEBUG] Generated edges:', edges)
    console.log('🔍 [DEBUG] Edges count:', edges.length)

    return { nodes, edges }
  }, [data, calculateTreeLayout])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Node and edge types
  const nodeTypes = useMemo(() => ({
    service: ServiceNode,
  }), [])

  const edgeTypes = useMemo(() => ({
    custom: CustomEdge,
  }), [])

  // Update nodes and edges when data changes
  useEffect(() => {
    console.log('🔄 [DEBUG] useEffect triggered - updating nodes and edges')
    console.log('🔄 [DEBUG] Initial nodes:', initialNodes)
    console.log('🔄 [DEBUG] Initial edges:', initialEdges)
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return
    
    // Add dependency
    addDependencyMutation.mutate({
      id: params.source,
      dependsOnServiceId: params.target,
      isRequired: true,
    }, {
      onSuccess: () => {
        setEdges((eds) => addEdge(params, eds))
        toast.success('Dependency added successfully')
      }
    })
  }, [addDependencyMutation, setEdges])

  const handleAddDependency = (targetServiceId: string) => {
    if (!selectedService || selectedService === targetServiceId) {
      setSelectedService(null)
      return
    }

    addDependencyMutation.mutate({
      id: selectedService,
      dependsOnServiceId: targetServiceId,
      isRequired: true,
    }, {
      onSuccess: () => {
        setSelectedService(null)
        refetch()
        toast.success('Dependency added successfully')
      }
    })
  }

  const handleNodeClick: NodeMouseHandler = useCallback((_, node: Node) => {
    if (selectedService) {
      handleAddDependency(node.id)
    }
  }, [selectedService, handleAddDependency])

  const openDeleteConfirmation = useCallback((edge: Edge) => {
    const sourceNode = nodes.find(n => n.id === edge.source)
    const targetNode = nodes.find(n => n.id === edge.target)
    
    setDeleteConfirmation({
      isOpen: true,
      edge: {
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        sourceName: (sourceNode?.data as ServiceNodeData)?.service?.name || edge.source,
        targetName: (targetNode?.data as ServiceNodeData)?.service?.name || edge.target
      }
    })
  }, [nodes])

  const handleDeleteDependency = useCallback(async () => {
    if (!deleteConfirmation.edge) return
    
    try {
      await removeDependencyMutation.mutateAsync({
        id: deleteConfirmation.edge.sourceId,
        dependencyId: deleteConfirmation.edge.id
      })
      
      // Close dialog and refresh data
      setDeleteConfirmation({ isOpen: false, edge: null })
      refetch()
      toast.success('Dependency deleted successfully')
    } catch (error) {
      console.error('Failed to delete dependency:', error)
      toast.error('Failed to delete dependency')
    }
  }, [deleteConfirmation.edge, removeDependencyMutation, refetch])

  const handleEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    openDeleteConfirmation(edge)
  }, [openDeleteConfirmation])

  // Event listeners for context menu actions
  useEffect(() => {
    const handleServiceViewDetails = (event: CustomEvent) => {
      const { service } = event.detail
      toast.info(`Service: ${service.name}\nType: ${service.type}\nStatus: ${service.status}\nPort: ${service.port || 'N/A'}`)
    }

    const handleServiceEdit = (event: CustomEvent) => {
      const { service } = event.detail
      toast.info(`Edit service functionality coming soon for ${service.name}`)
    }

    const handleServiceAddDependencyFrom = (event: CustomEvent) => {
      const { serviceId } = event.detail
      setSelectedService(serviceId)
      toast.info('Select another service to create a dependency')
    }

    const handleServiceAddDependencyTo = (event: CustomEvent) => {
      const { serviceId } = event.detail
      handleAddDependency(serviceId)
    }

    const handleEdgeViewDetails = (event: CustomEvent) => {
      const { edgeId } = event.detail
      const edge = edges.find(e => e.id === edgeId)
      if (edge) {
        const sourceNode = nodes.find(n => n.id === edge.source)
        const targetNode = nodes.find(n => n.id === edge.target)
        const sourceName = (sourceNode?.data as ServiceNodeData)?.service?.name || edge.source
        const targetName = (targetNode?.data as ServiceNodeData)?.service?.name || edge.target
        
        toast.info(`Dependency: ${sourceName} → ${targetName}\nType: ${edge.label || 'Unknown'}`)
      }
    }

    const handleEdgeDelete = (event: CustomEvent) => {
      const { edgeId } = event.detail
      const edge = edges.find(e => e.id === edgeId)
      if (edge) {
        openDeleteConfirmation(edge)
      }
    }

    window.addEventListener('service-view-details', handleServiceViewDetails as EventListener)
    window.addEventListener('service-edit', handleServiceEdit as EventListener)
    window.addEventListener('service-add-dependency-from', handleServiceAddDependencyFrom as EventListener)
    window.addEventListener('service-add-dependency-to', handleServiceAddDependencyTo as EventListener)
    window.addEventListener('edge-view-details', handleEdgeViewDetails as EventListener)
    window.addEventListener('edge-delete', handleEdgeDelete as EventListener)

    return () => {
      window.removeEventListener('service-view-details', handleServiceViewDetails as EventListener)
      window.removeEventListener('service-edit', handleServiceEdit as EventListener)
      window.removeEventListener('service-add-dependency-from', handleServiceAddDependencyFrom as EventListener)
      window.removeEventListener('service-add-dependency-to', handleServiceAddDependencyTo as EventListener)
      window.removeEventListener('edge-view-details', handleEdgeViewDetails as EventListener)
      window.removeEventListener('edge-delete', handleEdgeDelete as EventListener)
    }
  }, [handleAddDependency, edges, nodes, openDeleteConfirmation])

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            <span>Failed to Load Dependencies</span>
          </CardTitle>
          <CardDescription>
            Unable to fetch the service dependency graph
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <p className="text-muted-foreground mb-4">
              {error.message || 'Unknown error occurred'}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Network className="h-5 w-5" />
            <span>Service Dependencies Graph</span>
          </CardTitle>
          <CardDescription>
            Loading service dependency visualization...
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading dependencies...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.nodes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Network className="h-5 w-5" />
            <span>Service Dependencies Graph</span>
          </CardTitle>
          <CardDescription>
            No services found in this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Server className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Services</h3>
            <p className="text-muted-foreground">
              Create services in this project to see their dependency relationships
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className="h-[600px]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <Network className="h-5 w-5" />
                <span>Service Dependencies Graph</span>
              </CardTitle>
              <CardDescription>
                Interactive visualization of service relationships in {data.project.name}
                <br />
                <span className="text-xs text-muted-foreground">
                  Right-click for context menu • Double-click edge to delete
                </span>
              </CardDescription>
            </div>
            <div className="flex space-x-2">
              <Button 
                onClick={() => refetch()} 
                variant="outline" 
                size="sm"
                disabled={isLoading}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              {selectedService && (
                <Button 
                  onClick={() => setSelectedService(null)} 
                  variant="outline" 
                  size="sm"
                >
                  Cancel Selection
                </Button>
              )}
            </div>
          </div>
          {selectedService && (
            <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-blue-800">
              Click on another service to create a dependency from the selected service
            </div>
          )}
        </CardHeader>
        <CardContent className="h-[calc(100%-120px)] p-0">
          <div className="h-full w-full relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              onEdgeDoubleClick={handleEdgeDoubleClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{
                padding: 50,
              }}
            >
              <Controls />
              <MiniMap />
              <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
            </ReactFlow>
            
            {/* Legend */}
            <div className="absolute bottom-4 left-4 bg-background rounded-lg shadow-md p-3 border">
              <h4 className="text-sm font-medium mb-2">Legend</h4>
              <div className="space-y-1 text-xs">
                <div className="flex items-center space-x-2">
                  <div className="h-3 w-3 rounded-full bg-green-500"></div>
                  <span>Healthy</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                  <span>Deploying</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-3 w-3 rounded-full bg-red-500"></div>
                  <span>Failed</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-3 w-3 rounded-full bg-orange-500"></div>
                  <span>Unhealthy</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-2 w-6 bg-red-500 rounded"></div>
                  <span>Required</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-2 w-6 bg-gray-500 rounded"></div>
                  <span>Optional</span>
                </div>
                <hr className="my-2" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>💡 Right-click for context menu</div>
                  <div>💡 Double-click edge to delete</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmation.isOpen} onOpenChange={(open) => {
        if (!open) setDeleteConfirmation({ isOpen: false, edge: null })
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Dependency</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this dependency? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {deleteConfirmation.edge && (
            <div className="my-4 p-4 bg-gray-50 rounded-lg">
              <div className="text-sm">
                <div className="font-medium text-gray-900">
                  {deleteConfirmation.edge.sourceName}
                </div>
                <div className="text-gray-500 text-xs mb-1">depends on</div>
                <div className="font-medium text-gray-900">
                  {deleteConfirmation.edge.targetName}
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setDeleteConfirmation({ isOpen: false, edge: null })}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteDependency}
              disabled={removeDependencyMutation.isPending}
            >
              {removeDependencyMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Dependency
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}