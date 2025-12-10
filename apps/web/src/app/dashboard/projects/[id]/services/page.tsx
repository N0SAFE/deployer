'use client'

import { useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Grid3X3,
  Network,
  Filter,
  Search,
  Server,
  Globe,
  Database,
  HardDrive,
  Box,
  Zap,
  MoreHorizontal,
  Play,
  Pause,
  Settings,
  Trash2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@repo/ui/components/shadcn/alert-dialog'
import {
  useServices,
  useProjectDependencyGraph,
  useCreateService,
  useDeleteService,
  useToggleServiceActive,
  type Service,
} from '@/hooks/useServices'
import { useProject } from '@/hooks/useProjects'
import { formatRelativeTime } from '@/lib/format'
import { ServiceDependencyGraph } from '@/components/dashboard/services/service-dependency-graph'

// Service type configuration
const serviceTypeConfig: Record<string, { label: string; icon: typeof Server; color: string }> = {
  web: { label: 'Web', icon: Globe, color: 'bg-blue-500/10 text-blue-600' },
  api: { label: 'API', icon: Server, color: 'bg-green-500/10 text-green-600' },
  worker: { label: 'Worker', icon: Zap, color: 'bg-purple-500/10 text-purple-600' },
  database: { label: 'Database', icon: Database, color: 'bg-amber-500/10 text-amber-600' },
  cache: { label: 'Cache', icon: HardDrive, color: 'bg-orange-500/10 text-orange-600' },
  queue: { label: 'Queue', icon: Box, color: 'bg-pink-500/10 text-pink-600' },
}

// Status configuration
const statusConfig: Record<string, { label: string; color: string; dotColor: string }> = {
  running: { label: 'Running', color: 'bg-green-500/10 text-green-600 border-green-500/20', dotColor: 'bg-green-500' },
  stopped: { label: 'Stopped', color: 'bg-muted text-muted-foreground', dotColor: 'bg-muted-foreground' },
  deploying: { label: 'Deploying', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20', dotColor: 'bg-amber-500' },
  failed: { label: 'Failed', color: 'bg-red-500/10 text-red-600 border-red-500/20', dotColor: 'bg-red-500' },
  unknown: { label: 'Unknown', color: 'bg-muted text-muted-foreground', dotColor: 'bg-muted-foreground' },
}

// Runtime configuration
const runtimeConfig: Record<string, { label: string }> = {
  node: { label: 'Node.js' },
  python: { label: 'Python' },
  go: { label: 'Go' },
  rust: { label: 'Rust' },
  docker: { label: 'Docker' },
  static: { label: 'Static' },
}

export default function ProjectServicesPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.id as string

  // State
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>(searchParams.get('type') ?? 'all')
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') ?? 'all')
  const [viewMode, setViewMode] = useState<'grid' | 'graph'>('grid')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  // Queries
  const { data: project, isLoading: isProjectLoading } = useProject(projectId)
  const { data: services, isLoading: isServicesLoading } = useServices(projectId)
  const { data: dependencyGraph, isLoading: isGraphLoading } = useProjectDependencyGraph(projectId)

  // Mutations
  const createService = useCreateService()
  const deleteService = useDeleteService()
  const toggleActive = useToggleServiceActive()

  // Form state for create dialog
  const [newService, setNewService] = useState({
    name: '',
    description: '',
    type: 'api' as 'web' | 'api' | 'worker' | 'database' | 'cache' | 'queue',
    runtime: 'node' as 'node' | 'python' | 'go' | 'rust' | 'docker' | 'static',
  })

  // Filter services
  const filteredServices = useMemo(() => {
    if (!services) return [] as Service[]
    return services.services.filter((service: Service) => {
      const matchesSearch = !searchQuery || 
        service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (service.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      const matchesType = typeFilter === 'all' || service.type === typeFilter
      const matchesStatus = statusFilter === 'all' || service.status === statusFilter
      return matchesSearch && matchesType && matchesStatus
    })
  }, [services, searchQuery, typeFilter, statusFilter])

  // Stats
  const stats = useMemo(() => {
    if (!services) return { total: 0, running: 0, stopped: 0, failed: 0 }
    return {
      total: services.services.length,
      running: services.services.filter((s: Service) => s.status === 'running').length,
      stopped: services.services.filter((s: Service) => s.status === 'stopped').length,
      failed: services.services.filter((s: Service) => s.status === 'failed').length,
    }
  }, [services])

  // Handlers
  const handleCreateService = () => {
    createService.mutate(
      {
        projectId,
        name: newService.name,
        description: newService.description || undefined,
        type: newService.type,
        runtime: newService.runtime,
      },
      {
        onSuccess: () => {
          setIsCreateDialogOpen(false)
          setNewService({ name: '', description: '', type: 'api', runtime: 'node' })
        },
      }
    )
  }

  const handleDeleteService = () => {
    if (!selectedService) return
    deleteService.mutate(
      { id: selectedService.id },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false)
          setSelectedService(null)
        },
      }
    )
  }

  const handleToggleActive = (service: Service) => {
    toggleActive.mutate({ id: service.id, isActive: service.status !== 'running' })
  }

  const handleServiceSelect = (service: Service) => {
    setSelectedService(service)
  }

  // Transform graph data for ServiceDependencyGraph component
  const graphData = useMemo(() => {
    if (!dependencyGraph || !services) return { services: [], dependencies: [] }
    
    // Map nodes to Service format
    const graphServices = dependencyGraph.nodes.map((node) => {
      const service = services.services.find((s: Service) => s.id === node.id)
      return service ?? {
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.status,
        runtime: 'node',
        description: null,
        projectId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    })

    // Map edges to dependency format
    const dependencies = dependencyGraph.edges.map((edge) => ({
      sourceId: edge.source,
      targetId: edge.target,
      type: edge.isRequired ? 'runtime' : 'optional' as 'runtime' | 'optional',
    }))

    return { services: graphServices, dependencies }
  }, [dependencyGraph, services, projectId])

  const isLoading = isProjectLoading || isServicesLoading

  if (isLoading) {
    return <ProjectServicesPageSkeleton />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Services</h1>
            <p className="text-muted-foreground">
              {project?.name} &middot; {stats.total} service{stats.total !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Service
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Service</DialogTitle>
                <DialogDescription>
                  Add a new service to {project?.name}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g., api-server"
                    value={newService.name}
                    onChange={(e) => {setNewService({ ...newService, name: e.target.value })}}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Optional description..."
                    value={newService.description}
                    onChange={(e) => {setNewService({ ...newService, description: e.target.value })}}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={newService.type}
                      onValueChange={(value) => {setNewService({ ...newService, type: value as typeof newService.type })}}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(serviceTypeConfig).map(([key, config]) => (
                          <SelectItem key={key} value={key}>
                            <div className="flex items-center gap-2">
                              <config.icon className="h-4 w-4" />
                              {config.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="runtime">Runtime</Label>
                    <Select
                      value={newService.runtime}
                      onValueChange={(value) => {setNewService({ ...newService, runtime: value as typeof newService.runtime })}}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(runtimeConfig).map(([key, config]) => (
                          <SelectItem key={key} value={key}>
                            {config.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => {setIsCreateDialogOpen(false)}}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateService}
                  disabled={!newService.name || createService.isPending}
                >
                  {createService.isPending ? 'Creating...' : 'Create Service'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-muted p-3">
                <Server className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-green-500/10 p-3">
                <Play className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Running</p>
                <p className="text-2xl font-bold text-green-600">{stats.running}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-muted p-3">
                <Pause className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stopped</p>
                <p className="text-2xl font-bold">{stats.stopped}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-red-500/10 p-3">
                <Server className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* View Toggle & Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Search and Filters */}
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search services..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => {setSearchQuery(e.target.value)}}
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(serviceTypeConfig).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {Object.entries(statusConfig).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* View Mode Toggle */}
        <Tabs value={viewMode} onValueChange={(v) => {setViewMode(v as 'grid' | 'graph')}}>
          <TabsList>
            <TabsTrigger value="grid" className="gap-2">
              <Grid3X3 className="h-4 w-4" />
              Grid
            </TabsTrigger>
            <TabsTrigger value="graph" className="gap-2">
              <Network className="h-4 w-4" />
              Graph
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      {viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredServices.length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Server className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">No Services Found</h3>
                <p className="text-muted-foreground text-center mt-2">
                  {services?.length === 0
                    ? 'Create your first service to get started'
                    : 'Try adjusting your search or filters'}
                </p>
                {services?.length === 0 && (
                  <Button className="mt-4" onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Service
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            filteredServices.map((service: Service) => {
              const typeConfig = serviceTypeConfig[service.type] ?? serviceTypeConfig.api
              const status = statusConfig[service.status] ?? statusConfig.unknown
              const TypeIcon = typeConfig.icon

              return (
                <Card key={service.id} className="group relative overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`rounded-lg p-2 ${typeConfig.color}`}>
                          <TypeIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{service.name}</CardTitle>
                          <CardDescription className="text-xs">
                            {runtimeConfig[service.runtime]?.label ?? service.runtime}
                          </CardDescription>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleToggleActive(service)}>
                            {service.status === 'running' ? (
                              <>
                                <Pause className="h-4 w-4 mr-2" />
                                Stop
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4 mr-2" />
                                Start
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Redeploy
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/dashboard/projects/${projectId}/services/${service.id}`}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Settings className="h-4 w-4 mr-2" />
                            Settings
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setSelectedService(service)
                              setIsDeleteDialogOpen(true)
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {service.description && (
                      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                        {service.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{typeConfig.label}</Badge>
                        <Badge variant="outline" className={status.color}>
                          <span className={`h-1.5 w-1.5 rounded-full ${status.dotColor} mr-1.5`} />
                          {status.label}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(service.updatedAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Service Dependencies</CardTitle>
            <CardDescription>
              Visual representation of how your services are connected
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isGraphLoading ? (
              <div className="h-[600px] flex items-center justify-center">
                <div className="text-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">Loading dependency graph...</p>
                </div>
              </div>
            ) : graphData.services.length === 0 ? (
              <div className="h-[600px] flex items-center justify-center">
                <div className="text-center">
                  <Network className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Services</h3>
                  <p className="text-muted-foreground mt-2">
                    Add services to visualize their dependencies
                  </p>
                </div>
              </div>
            ) : (
              <ServiceDependencyGraph
                services={graphData.services as Service[]}
                dependencies={graphData.dependencies}
                onSelectService={handleServiceSelect}
                interactive
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedService?.name}&quot;? This action cannot
              be undone. All deployments and logs for this service will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteService}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteService.isPending}
            >
              {deleteService.isPending ? 'Deleting...' : 'Delete Service'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ProjectServicesPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10" />
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48 mt-1" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-8 w-12 mt-1" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-10 w-48" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-3 w-16 mt-1" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full mb-4" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
