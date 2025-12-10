'use client'

import { useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Server,
  Globe,
  Database,
  HardDrive,
  Box,
  Zap,
  Play,
  Pause,
  RefreshCw,
  Settings,
  Trash2,
  MoreHorizontal,
  ExternalLink,
  Clock,
  Cpu,
  HardDrive as Memory,
  Activity,
  Network,
  FileText,
  Link2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Timer,
  GitBranch,
  Terminal,
} from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
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
import { ScrollArea } from '@repo/ui/components/shadcn/scroll-area'
import {
  useService,
  useServiceDeployments,
  useServiceDependencies,
  useServiceLogs,
  useServiceMetrics,
  useServiceHealth,
  useDeleteService,
  useToggleServiceActive,
} from '@/hooks/useServices'
import { useProject } from '@/hooks/useProjects'
import { formatRelativeTime } from '@/lib/format'
import { DeploymentStatusBadge } from '@/components/dashboard'

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
const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  running: { label: 'Running', color: 'bg-green-500/10 text-green-600 border-green-500/20', icon: CheckCircle },
  stopped: { label: 'Stopped', color: 'bg-muted text-muted-foreground', icon: Pause },
  deploying: { label: 'Deploying', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: RefreshCw },
  failed: { label: 'Failed', color: 'bg-red-500/10 text-red-600 border-red-500/20', icon: XCircle },
  unknown: { label: 'Unknown', color: 'bg-muted text-muted-foreground', icon: AlertTriangle },
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

// Log level colors
const logLevelColors: Record<string, string> = {
  info: 'text-blue-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
  debug: 'text-gray-500',
}

export default function ServiceDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.id as string
  const serviceId = params.serviceId as string
  const defaultTab = searchParams.get('tab') ?? 'overview'

  // State
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  // Queries
  const { data: project, isLoading: isProjectLoading } = useProject(projectId)
  const { data: service, isLoading: isServiceLoading } = useService(serviceId)
  const { data: deployments, isLoading: isDeploymentsLoading } = useServiceDeployments(serviceId, {
    limit: 10,
    enabled: activeTab === 'deployments' || activeTab === 'overview',
  })
  const { data: dependencies, isLoading: isDependenciesLoading } = useServiceDependencies(serviceId, {
    enabled: activeTab === 'dependencies' || activeTab === 'overview',
  })
  const { data: logs, isLoading: isLogsLoading } = useServiceLogs(serviceId, {
    limit: 100,
    enabled: activeTab === 'logs',
  })
  const { data: metrics, isLoading: isMetricsLoading } = useServiceMetrics(serviceId, {
    period: '1h',
    enabled: activeTab === 'overview',
  })
  const { data: health, isLoading: isHealthLoading } = useServiceHealth(serviceId, {
    enabled: activeTab === 'overview',
  })

  // Mutations
  const deleteService = useDeleteService()
  const toggleActive = useToggleServiceActive()

  // Handlers
  const handleDeleteService = () => {
    deleteService.mutate(
      { id: serviceId },
      {
        onSuccess: () => {
          // Navigate back to services list
          window.location.href = `/dashboard/projects/${projectId}/services`
        },
      }
    )
  }

  const handleToggleActive = () => {
    if (!service) return
    toggleActive.mutate({ id: serviceId, isActive: service.status !== 'running' })
  }

  const isLoading = isProjectLoading || isServiceLoading

  if (isLoading) {
    return <ServiceDetailPageSkeleton />
  }

  if (!service) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}/services`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Services
            </Button>
          </Link>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">
              Service not found or you don&apos;t have access.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const typeConfig = serviceTypeConfig[service.type] ?? serviceTypeConfig.api
  const status = statusConfig[service.status] ?? statusConfig.unknown
  const TypeIcon = typeConfig.icon
  const StatusIcon = status.icon

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <Link href={`/dashboard/projects/${projectId}/services`}>
            <Button variant="ghost" size="icon" className="mt-1">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-start gap-4">
            <div className={`rounded-xl p-3 ${typeConfig.color}`}>
              <TypeIcon className="h-8 w-8" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{service.name}</h1>
                <Badge variant="outline" className={status.color}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {status.label}
                </Badge>
              </div>
              {service.description && (
                <p className="text-muted-foreground mt-1">{service.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Server className="h-4 w-4" />
                  {typeConfig.label}
                </span>
                <span className="flex items-center gap-1">
                  <Terminal className="h-4 w-4" />
                  {runtimeConfig[service.runtime]?.label ?? service.runtime}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Updated {formatRelativeTime(service.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-12 md:ml-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleActive}
            disabled={toggleActive.isPending}
          >
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
          </Button>
          <Button size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Redeploy
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Live
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Service
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deployments">
            Deployments
            {deployments && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {deployments.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="dependencies">
            Dependencies
            {dependencies && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                {dependencies.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Health & Metrics Grid */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className={`rounded-full p-3 ${service.status === 'running' ? 'bg-green-500/10' : 'bg-muted'}`}>
                    <Activity className={`h-5 w-5 ${service.status === 'running' ? 'text-green-600' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Health</p>
                    <p className="text-2xl font-bold">
                      {isHealthLoading ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        health?.status ?? 'Unknown'
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-blue-500/10 p-3">
                    <Cpu className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">CPU</p>
                    <p className="text-2xl font-bold">
                      {isMetricsLoading ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        `${metrics?.cpu?.current ?? 0}%`
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-purple-500/10 p-3">
                    <Memory className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Memory</p>
                    <p className="text-2xl font-bold">
                      {isMetricsLoading ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        `${metrics?.memory?.current ?? 0} MB`
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-amber-500/10 p-3">
                    <Timer className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Response Time</p>
                    <p className="text-2xl font-bold">
                      {isMetricsLoading ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        `${metrics?.responseTime?.avg ?? 0} ms`
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Deployments & Dependencies */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent Deployments */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Recent Deployments</CardTitle>
                  <CardDescription>Last 5 deployments</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab('deployments')}>
                  View All
                </Button>
              </CardHeader>
              <CardContent>
                {isDeploymentsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !deployments || deployments.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No deployments yet</p>
                ) : (
                  <div className="space-y-3">
                    {deployments.slice(0, 5).map((deployment) => (
                      <div key={deployment.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center gap-3">
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">
                              {deployment.version ?? 'latest'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {deployment.environment}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <DeploymentStatusBadge status={deployment.status} />
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(deployment.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Dependencies */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Dependencies</CardTitle>
                  <CardDescription>Services this depends on</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab('dependencies')}>
                  Manage
                </Button>
              </CardHeader>
              <CardContent>
                {isDependenciesLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !dependencies || dependencies.length === 0 ? (
                  <div className="text-center py-4">
                    <Link2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">No dependencies</p>
                    <Button variant="outline" size="sm" className="mt-2">
                      Add Dependency
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dependencies.map((dep) => {
                      const depTypeConfig = serviceTypeConfig[dep.type] ?? serviceTypeConfig.api
                      const DepIcon = depTypeConfig.icon
                      return (
                        <div key={dep.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div className="flex items-center gap-3">
                            <div className={`rounded p-1.5 ${depTypeConfig.color}`}>
                              <DepIcon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{dep.name}</p>
                              <p className="text-xs text-muted-foreground">{depTypeConfig.label}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className={statusConfig[dep.status]?.color ?? ''}>
                            {dep.status}
                          </Badge>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Deployments Tab */}
        <TabsContent value="deployments">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Deployments</CardTitle>
                <CardDescription>Deployment history for this service</CardDescription>
              </div>
              <Button size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Deploy Now
              </Button>
            </CardHeader>
            <CardContent>
              {isDeploymentsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : !deployments || deployments.length === 0 ? (
                <div className="text-center py-12">
                  <RefreshCw className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Deployments</h3>
                  <p className="text-muted-foreground mt-2">
                    Deploy this service to see the deployment history
                  </p>
                  <Button className="mt-4">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Create Deployment
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Deployed</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deployments.map((deployment) => (
                      <TableRow key={deployment.id}>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {deployment.version ?? 'latest'}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{deployment.environment}</Badge>
                        </TableCell>
                        <TableCell>
                          <DeploymentStatusBadge status={deployment.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {deployment.duration ? `${Math.round(deployment.duration / 1000)}s` : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatRelativeTime(deployment.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Link href={`/dashboard/deployments/${deployment.id}`}>
                            <Button variant="ghost" size="icon">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dependencies Tab */}
        <TabsContent value="dependencies">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Dependencies</CardTitle>
                <CardDescription>
                  Services that this service depends on
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isDependenciesLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : !dependencies || dependencies.length === 0 ? (
                  <div className="text-center py-8">
                    <Network className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold">No Dependencies</h3>
                    <p className="text-muted-foreground mt-2">
                      Add dependencies to define service relationships
                    </p>
                    <Button variant="outline" className="mt-4">
                      <Link2 className="h-4 w-4 mr-2" />
                      Add Dependency
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dependencies.map((dep) => {
                      const depTypeConfig = serviceTypeConfig[dep.type] ?? serviceTypeConfig.api
                      const DepIcon = depTypeConfig.icon
                      return (
                        <div key={dep.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div className="flex items-center gap-3">
                            <div className={`rounded-lg p-2 ${depTypeConfig.color}`}>
                              <DepIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="font-medium">{dep.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {depTypeConfig.label} &middot; {dep.status}
                              </p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" className="text-destructive">
                            Remove
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dependents</CardTitle>
                <CardDescription>
                  Services that depend on this service
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <Network className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Dependents</h3>
                  <p className="text-muted-foreground mt-2">
                    No services currently depend on this service
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Logs</CardTitle>
                <CardDescription>Real-time logs from this service</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <Button variant="outline" size="sm">
                  <FileText className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLogsLoading ? (
                <div className="p-6 space-y-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : !logs || logs.length === 0 ? (
                <div className="text-center py-12">
                  <Terminal className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Logs Available</h3>
                  <p className="text-muted-foreground mt-2">
                    Logs will appear here once the service starts
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[600px] font-mono text-sm">
                  <div className="p-4 space-y-1">
                    {logs.map((log, index) => (
                      <div key={index} className="flex gap-4 py-0.5 hover:bg-muted/50 px-2 rounded">
                        <span className="text-muted-foreground shrink-0 w-[180px]">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                        <span className={`shrink-0 w-[50px] ${logLevelColors[log.level] ?? 'text-muted-foreground'}`}>
                          [{log.level.toUpperCase()}]
                        </span>
                        <span className="text-foreground break-all">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>
                  Configure basic service settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Service Name</label>
                  <p className="text-sm text-muted-foreground">{service.name}</p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Description</label>
                  <p className="text-sm text-muted-foreground">
                    {service.description ?? 'No description'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Type</label>
                    <p className="text-sm text-muted-foreground">{typeConfig.label}</p>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Runtime</label>
                    <p className="text-sm text-muted-foreground">
                      {runtimeConfig[service.runtime]?.label ?? service.runtime}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>
                  Irreversible actions for this service
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/30">
                  <div>
                    <p className="font-medium">Delete Service</p>
                    <p className="text-sm text-muted-foreground">
                      Permanently delete this service and all its data
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setIsDeleteDialogOpen(true)}
                  >
                    Delete Service
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{service.name}&quot;? This action cannot
              be undone. All deployments, logs, and configurations will be permanently deleted.
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

function ServiceDetailPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10" />
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-4 w-64" />
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
                  <Skeleton className="h-8 w-20 mt-1" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}
