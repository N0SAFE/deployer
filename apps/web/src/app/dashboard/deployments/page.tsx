'use client'

import type React from 'react'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@repo/ui/lib/utils'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { useDeployments } from '@/hooks/useDeployments'
import { formatRelativeTime } from '@/lib/format'
import { DeploymentStatusBadge, EmptyState, TriggerDeploymentDialog, SearchFilter, Pagination } from '@/components/dashboard'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Globe,
  Plus,
  RefreshCcw,
  Rocket,
  Server,
  ShieldCheck,
  TrafficCone,
  Trash2,
} from 'lucide-react'

const statusConfig: Record<
  string,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  success: {
    label: 'Succeeded',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    icon: AlertTriangle,
  },
  building: {
    label: 'Building',
    icon: Activity,
  },
  deploying: {
    label: 'Deploying',
    icon: Server,
  },
  pending: {
    label: 'Pending',
    icon: Clock3,
  },
  queued: {
    label: 'Queued',
    icon: Clock3,
  },
  cancelled: {
    label: 'Cancelled',
    icon: AlertTriangle,
  },
}

const statusOptions = [
  { value: 'success', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'building', label: 'Building' },
  { value: 'deploying', label: 'Deploying' },
  { value: 'pending', label: 'Pending' },
  { value: 'queued', label: 'Queued' },
  { value: 'cancelled', label: 'Cancelled' },
]

const environmentOptions = [
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
]

// Environment tab configuration
const envTabConfig: Record<string, { label: string; color: string; description: string }> = {
  all: { label: 'All Environments', color: '', description: 'All deployments across environments' },
  production: { label: 'Production', color: 'bg-green-500', description: 'Live production deployments' },
  staging: { label: 'Staging', color: 'bg-amber-500', description: 'Staging environment deployments' },
  development: { label: 'Development', color: 'bg-blue-500', description: 'Development deployments' },
  preview: { label: 'Preview', color: 'bg-purple-500', description: 'PR and branch previews' },
}

// Preview deployment interface
interface PreviewDeployment {
  id: string
  deploymentId: string
  serviceId: string
  pullRequestId?: number
  pullRequestTitle?: string
  branchName: string
  url: string
  status: 'building' | 'deploying' | 'active' | 'inactive' | 'failed'
  createdAt: string
  expiresAt?: string
  createdBy: string
}

export default function DeploymentsPage() {
  // Filter and pagination state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [envFilter, setEnvFilter] = useState('all')
  const [activeEnvTab, setActiveEnvTab] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const deployments = useDeployments({ limit: 100 }) // Fetch more for client-side filtering

  const allDeployments = deployments.data?.deployments ?? []
  
  // Mock preview deployments (in real app, this would come from API)
  // For demo purposes, we treat 'github' source deployments as potential preview deployments
  const previewDeployments: PreviewDeployment[] = useMemo(() => {
    // Simulate some preview deployments from PR branches
    return allDeployments
      .filter((d) => d.environment === 'preview' || (d.sourceType === 'github' && d.environment === 'development'))
      .slice(0, 6)
      .map((d, idx) => ({
        id: `preview-${d.deploymentId}`,
        deploymentId: d.deploymentId,
        serviceId: d.serviceId,
        pullRequestId: idx % 2 === 0 ? 100 + idx : undefined,
        pullRequestTitle: idx % 2 === 0 ? `feat: Add new feature #${100 + idx}` : undefined,
        branchName: idx % 2 === 0 ? `feat/new-feature-${idx}` : `fix/bug-${idx}`,
        url: `https://preview-${d.deploymentId.slice(0, 8)}.app.example.com`,
        status: d.status === 'success' ? 'active' : d.status as PreviewDeployment['status'],
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : d.createdAt.toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdBy: d.deployedBy,
      }))
  }, [allDeployments])
  
  // Apply filters including environment tab
  const filteredList = useMemo(() => {
    return allDeployments.filter((d) => {
      // Environment tab filter (takes precedence)
      if (activeEnvTab !== 'all') {
        if (activeEnvTab === 'preview') {
          // Show preview/PR deployments (preview env or github source in dev)
          if (d.environment !== 'preview' && !(d.sourceType === 'github' && d.environment === 'development')) return false
        } else {
          if (d.environment !== activeEnvTab) return false
        }
      }
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        const matchesSearch = 
          d.serviceId.toLowerCase().includes(searchLower) ||
          d.deployedBy.toLowerCase().includes(searchLower) ||
          d.environment.toLowerCase().includes(searchLower)
        if (!matchesSearch) return false
      }
      // Status filter
      if (statusFilter !== 'all' && d.status !== statusFilter) return false
      // Environment filter (additional to tab)
      if (envFilter !== 'all' && d.environment !== envFilter) return false
      return true
    })
  }, [allDeployments, search, statusFilter, envFilter, activeEnvTab])

  // Paginate
  const totalFiltered = filteredList.length
  const paginatedList = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredList.slice(start, start + pageSize)
  }, [filteredList, page, pageSize])

  const totalDeployments = deployments.data?.total ?? allDeployments.length
  const activeCount = allDeployments.filter((d) => d.status === 'building' || d.status === 'deploying').length
  const failedCount = allDeployments.filter((d) => d.status === 'failed').length
  const succeededCount = allDeployments.filter((d) => d.status === 'success').length
  
  // Environment counts for tabs
  const envCounts = useMemo(() => ({
    all: allDeployments.length,
    production: allDeployments.filter((d) => d.environment === 'production').length,
    staging: allDeployments.filter((d) => d.environment === 'staging').length,
    development: allDeployments.filter((d) => d.environment === 'development').length,
    preview: allDeployments.filter((d) => d.environment === 'preview' || (d.sourceType === 'github' && d.environment === 'development')).length,
  }), [allDeployments])

  const isLoading = deployments.isLoading
  const isFetching = deployments.isFetching

  // Active filters for display
  const activeFilters = useMemo(() => {
    const filters: { key: string; label: string; value: string; onRemove: () => void }[] = []
    if (statusFilter !== 'all') {
      const option = statusOptions.find((o) => o.value === statusFilter)
      filters.push({
        key: 'status',
        label: 'Status',
        value: option?.label ?? statusFilter,
        onRemove: () => { setStatusFilter('all'); },
      })
    }
    if (envFilter !== 'all') {
      const option = environmentOptions.find((o) => o.value === envFilter)
      filters.push({
        key: 'environment',
        label: 'Environment',
        value: option?.label ?? envFilter,
        onRemove: () => { setEnvFilter('all'); },
      })
    }
    return filters
  }, [statusFilter, envFilter])

  const clearAllFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setEnvFilter('all')
    setActiveEnvTab('all')
    setPage(1)
  }
  
  // Handle tab change
  const handleEnvTabChange = (value: string) => {
    setActiveEnvTab(value)
    setEnvFilter('all') // Reset env filter when changing tabs
    setPage(1)
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Deployments</h1>
          <p className="text-muted-foreground">
            Track deployment activity across services and environments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void deployments.refetch()}
            disabled={isFetching}
          >
            {isFetching && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
            Refresh
          </Button>
          <TriggerDeploymentDialog
            trigger={
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Trigger Deployment
              </Button>
            }
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total deployments</CardTitle>
            <Rocket className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : totalDeployments}</div>
            <p className="text-muted-foreground text-sm">All recorded deployments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <Server className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : activeCount}</div>
            <p className="text-muted-foreground text-sm">Currently running</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Succeeded</CardTitle>
            <ShieldCheck className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : succeededCount}</div>
            <p className="text-muted-foreground text-sm">Latest successes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <TrafficCone className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : failedCount}</div>
            <p className="text-muted-foreground text-sm">Needs attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Environment Tabs */}
      <Tabs value={activeEnvTab} onValueChange={handleEnvTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          {Object.entries(envTabConfig).map(([key, config]) => (
            <TabsTrigger key={key} value={key} className="relative">
              {config.label}
              <Badge 
                variant="secondary" 
                className={cn(
                  "ml-2 h-5 min-w-5 rounded-full px-1.5 text-xs",
                  activeEnvTab === key && config.color
                )}
              >
                {envCounts[key as keyof typeof envCounts]}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        
        <div className="text-muted-foreground text-sm">
          {envTabConfig[activeEnvTab as keyof typeof envTabConfig]?.description}
        </div>
        
        <TabsContent value={activeEnvTab} className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle>
                  {activeEnvTab === 'all' ? 'All Deployments' : `${envTabConfig[activeEnvTab as keyof typeof envTabConfig]?.label} Deployments`}
                </CardTitle>
                <CardDescription>
                  {activeEnvTab === 'preview' 
                    ? 'Preview deployments from pull requests and branches' 
                    : 'Latest deployment status across projects'}
                </CardDescription>
              </div>
              {isFetching && <RefreshCcw className="text-muted-foreground h-4 w-4 animate-spin" />}
            </CardHeader>
            <CardContent className="space-y-4">
              <SearchFilter
                searchValue={search}
                onSearchChange={(value) => {
                  setSearch(value)
                  setPage(1)
                }}
                searchPlaceholder="Search by service, user, or environment..."
                filters={[
                  {
                    key: 'status',
                    label: 'Status',
                    value: statusFilter,
                    options: statusOptions,
                    onChange: (value) => {
                      setStatusFilter(value)
                      setPage(1)
                    },
                  },
                  ...(activeEnvTab === 'all' ? [{
                    key: 'environment',
                    label: 'Environment',
                    value: envFilter,
                    options: environmentOptions,
                    onChange: (value: string) => {
                      setEnvFilter(value)
                      setPage(1)
                    },
                  }] : []),
                ]}
                activeFilters={activeFilters}
                onClearAll={clearAllFilters}
              />
              
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-14 w-full" />
                  ))}
                </div>
              ) : paginatedList.length === 0 ? (
                <EmptyState
                  icon={Rocket}
                  title={totalFiltered === 0 && allDeployments.length > 0 ? "No matching deployments" : "No deployments yet"}
                  description={totalFiltered === 0 && allDeployments.length > 0 
                    ? "Try adjusting your search or filter criteria." 
                    : "Deployments will appear here once you trigger your first deployment."}
                  actionElement={
                    totalFiltered === 0 && allDeployments.length > 0 ? (
                      <Button size="sm" variant="outline" onClick={clearAllFilters}>
                        Clear Filters
                      </Button>
                    ) : (
                      <TriggerDeploymentDialog
                        trigger={
                          <Button size="sm">
                            <Plus className="mr-2 h-4 w-4" />
                            Trigger Deployment
                          </Button>
                        }
                      />
                    )
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Environment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedList.map((deployment) => {
                        const config = statusConfig[deployment.status] ?? statusConfig.pending
                        const StatusIcon = config?.icon ?? Clock3
                        return (
                          <TableRow
                            key={deployment.deploymentId}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => {
                              window.location.href = `/dashboard/deployments/${deployment.deploymentId}`
                            }}
                          >
                            <TableCell className="font-medium">
                              <Link
                                href={`/dashboard/deployments/${deployment.deploymentId}`}
                                className="flex flex-col hover:text-primary"
                                onClick={(e) => { e.stopPropagation(); }}
                              >
                                <span>{deployment.serviceId}</span>
                                <span className="text-muted-foreground text-xs">
                                  by {deployment.deployedBy}
                                </span>
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {deployment.environment}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <DeploymentStatusBadge status={deployment.status} />
                                <StatusIcon className="text-muted-foreground h-4 w-4" />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize">
                                {deployment.sourceType}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <Clock3 className="text-muted-foreground h-4 w-4" />
                                <span>{formatRelativeTime(deployment.createdAt)}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              
              {paginatedList.length > 0 && (
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={totalFiltered}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size)
                    setPage(1)
                  }}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Preview Deployments Section */}
      {previewDeployments.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GitPullRequest className="h-5 w-5" />
                  Preview Deployments
                </CardTitle>
                <CardDescription>
                  Active preview environments from pull requests and branches
                </CardDescription>
              </div>
              <Badge variant="secondary">{previewDeployments.length} active</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {previewDeployments.map((preview) => {
                const statusColors: Record<PreviewDeployment['status'], string> = {
                  building: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
                  deploying: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
                  active: 'bg-green-500/10 text-green-600 border-green-500/30',
                  inactive: 'bg-gray-500/10 text-gray-600 border-gray-500/30',
                  failed: 'bg-red-500/10 text-red-600 border-red-500/30',
                }
                
                return (
                  <Card key={preview.id} className="border-dashed">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          {preview.pullRequestId && preview.pullRequestTitle ? (
                            <CardTitle className="flex items-center gap-2 text-sm font-medium">
                              <GitPullRequest className="h-4 w-4 text-purple-500" />
                              PR #{preview.pullRequestId}
                            </CardTitle>
                          ) : (
                            <CardTitle className="flex items-center gap-2 text-sm font-medium">
                              <GitBranch className="h-4 w-4 text-blue-500" />
                              Branch Deploy
                            </CardTitle>
                          )}
                          <CardDescription className="text-xs line-clamp-1">
                            {preview.pullRequestTitle || preview.branchName}
                          </CardDescription>
                        </div>
                        <Badge variant="outline" className={cn("text-xs", statusColors[preview.status])}>
                          {preview.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <GitBranch className="h-3 w-3" />
                        <code className="bg-muted px-1 py-0.5 rounded text-xs">
                          {preview.branchName}
                        </code>
                      </div>
                      
                      {preview.url && preview.status === 'active' && (
                        <a
                          href={preview.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-primary hover:underline"
                        >
                          <Globe className="h-3 w-3" />
                          {preview.url.replace('https://', '')}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>by {preview.createdBy}</span>
                        <span>{formatRelativeTime(preview.createdAt)}</span>
                      </div>
                      
                      {preview.expiresAt && (
                        <div className="flex items-center gap-1 text-xs text-orange-600">
                          <Clock3 className="h-3 w-3" />
                          Expires {formatRelativeTime(preview.expiresAt)}
                        </div>
                      )}
                      
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" asChild>
                          <Link href={`/dashboard/deployments/${preview.deploymentId}`}>
                            View Details
                          </Link>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Recent Activity - In Progress Deployments */}
      {allDeployments.filter(d => d.status === 'building' || d.status === 'deploying').length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-500 animate-pulse" />
                  Active Deployments
                </CardTitle>
                <CardDescription>
                  Deployments currently in progress
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {allDeployments
                .filter(d => d.status === 'building' || d.status === 'deploying')
                .slice(0, 4)
                .map((deployment) => {
                  const config = statusConfig[deployment.status] ?? statusConfig.pending
                  const StatusIcon = config?.icon ?? Clock3

                  return (
                    <Link key={deployment.deploymentId} href={`/dashboard/deployments/${deployment.deploymentId}`}>
                      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30 border-blue-500/30">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <div className="space-y-1">
                            <CardTitle className="text-lg">
                              {deployment.serviceId}
                            </CardTitle>
                            <CardDescription>by {deployment.deployedBy}</CardDescription>
                          </div>
                          <DeploymentStatusBadge status={deployment.status} />
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Environment</span>
                            <Badge variant="outline" className="capitalize font-medium">
                              {deployment.environment}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Source</span>
                            <span className="font-medium capitalize">{deployment.sourceType}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Started</span>
                            <span className="font-medium">{formatRelativeTime(deployment.createdAt)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Status</span>
                            <div className="flex items-center gap-2">
                              <StatusIcon className="h-4 w-4 animate-spin" />
                              <span className="capitalize">{config?.label ?? deployment.status}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
