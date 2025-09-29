'use client'

import { useProjects } from '@/hooks/useProjects'
import { useDeployments } from '@/hooks/useDeployments'
import { Card, CardContent } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { 
  Container,
  Search,
  Filter,
  Zap,
  TrendingUp,
  Activity,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react'
import DeploymentCard from '@/components/deployments/DeploymentCard'
import { DeploymentListSkeleton, StatsSkeleton } from '@/components/loading/skeletons'
import { useSearchParamState } from '@/routes/hooks'
import { GlobalDeployments } from '@/routes'

export function DeploymentsClient() {
  // Use RouteBuilder for search parameter state management
  const [searchParams, setSearchParams] = useSearchParamState(GlobalDeployments)

  // Extract values from search params with defaults
  const searchQuery = searchParams.project || ''
  const statusFilter = searchParams.status || 'all'
  const environmentFilter = searchParams.environment || 'all'
  const projectFilter = searchParams.project || 'all'
  const activeTab = searchParams.tab || 'all'

  // Get all projects for filtering
  const { data: projectsData } = useProjects()
  const projects = projectsData?.projects || []

  // Get all deployments across all projects
  const { data: deploymentsData, isLoading } = useDeployments({
    // This would fetch all deployments across all projects the user has access to
  })
  const allDeployments = deploymentsData?.deployments || []

  // Filter deployments based on search and filters
  const filteredDeployments = allDeployments.filter((deployment) => {
    const id = getDeploymentId(deployment)
    const matchesSearch = searchQuery === '' || 
      (id && id.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (typeof deployment.serviceId === 'string' && deployment.serviceId.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesStatus = statusFilter === 'all' || deployment.status === statusFilter
    const matchesEnvironment = environmentFilter === 'all' || deployment.environment === environmentFilter
    
    // For now, we'll filter by project through the service relationship
    // In a real implementation, we'd need to get service-to-project mappings
    const matchesProject = projectFilter === 'all' // TODO: Implement proper project filtering

    // Tab filtering
    const matchesTab = activeTab === 'all' || 
      (activeTab === 'active' && ['pending', 'building', 'deploying'].includes(deployment.status)) ||
      (activeTab === 'completed' && ['success', 'failed', 'cancelled'].includes(deployment.status)) ||
      (activeTab === 'failed' && deployment.status === 'failed')

    return matchesSearch && matchesStatus && matchesEnvironment && matchesProject && matchesTab
  })

  // Get deployment statistics
  const stats = {
    total: allDeployments.length,
    success: allDeployments.filter(d => d.status === 'success').length,
    failed: allDeployments.filter(d => d.status === 'failed').length,
    active: allDeployments.filter(d => ['pending', 'building', 'deploying'].includes(d.status)).length,
  }

  // Calculate success rate
  const completedDeployments = stats.success + stats.failed
  const successRate = completedDeployments > 0 ? Math.round((stats.success / completedDeployments) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Deployments</h1>
          <p className="text-muted-foreground">
            Monitor deployment activity across all your projects
          </p>
        </div>
        <Button>
          <Zap className="h-4 w-4 mr-2" />
          New Deployment
        </Button>
      </div>

      {/* Statistics Overview */}
      {isLoading ? (
        <StatsSkeleton />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Activity className="h-5 w-5 text-blue-600" />
                <div className="text-2xl font-bold">{stats.total}</div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Total Deployments</p>
              <p className="text-xs text-blue-600 mt-2">All time</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div className="text-2xl font-bold text-green-600">{stats.success}</div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Successful</p>
              <p className="text-xs text-green-600 mt-2">{successRate}% success rate</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Failed</p>
              <p className="text-xs text-red-600 mt-2">
                {completedDeployments > 0 ? Math.round((stats.failed / completedDeployments) * 100) : 0}% failure rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Clock className="h-5 w-5 text-yellow-600" />
                <div className="text-2xl font-bold text-yellow-600">{stats.active}</div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Active</p>
              <p className="text-xs text-yellow-600 mt-2">In progress</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Tabs */}
      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab: tab as 'all' | 'active' | 'completed' | 'failed' })} className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Deployments</TabsTrigger>
          <TabsTrigger value="active" className="relative">
            Active
            {stats.active > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 w-5 rounded-full p-0 text-xs">
                {stats.active}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="failed">
            Failed
            {stats.failed > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 rounded-full p-0 text-xs">
                {stats.failed}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Filter Controls */}
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search deployments or services..."
              value={searchQuery}
              onChange={(e) => setSearchParams({ project: e.target.value || undefined })}
              className="pl-9"
            />
          </div>
          
          <Select value={projectFilter} onValueChange={(value) => setSearchParams({ project: value === 'all' ? undefined : value })}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={statusFilter} onValueChange={(value) => setSearchParams({ status: value === 'all' ? undefined : value as 'success' | 'failed' | 'pending' | 'building' | 'deploying' | 'cancelled' })}>
            <SelectTrigger className="w-48">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="building">Building</SelectItem>
              <SelectItem value="deploying">Deploying</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Select value={environmentFilter} onValueChange={(value) => setSearchParams({ environment: value === 'all' ? undefined : value as 'production' | 'staging' | 'preview' | 'development' })}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Environments</SelectItem>
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="staging">Staging</SelectItem>
              <SelectItem value="preview">Preview</SelectItem>
              <SelectItem value="development">Development</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Deployment List */}
        <TabsContent value={activeTab} className="mt-6">
        <div className="space-y-4">
          {isLoading ? (
            <DeploymentListSkeleton />
          ) : filteredDeployments.length === 0 ? (
            <Card>
              <CardContent className="py-16">
                <div className="text-center">
                  <Container className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">
                    {allDeployments.length === 0 ? 'No deployments yet' : 'No deployments match your filters'}
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    {allDeployments.length === 0 
                      ? 'Start deploying services to see deployment activity here'
                      : 'Try adjusting your search or filter criteria'
                    }
                  </p>
                  {allDeployments.length === 0 && (
                    <Button>
                      <Zap className="h-4 w-4 mr-2" />
                      Deploy Service
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {filteredDeployments.length} of {allDeployments.length} deployments
                </p>
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {successRate}% success rate
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {filteredDeployments.map((deployment) => {
                  const id = getDeploymentId(deployment)
                  return (
                    <DeploymentCard 
                      key={id || JSON.stringify(deployment)} 
                      deployment={deployment}
                       // If you can resolve projectId/serviceId from serviceId mapping, pass them here.
                       // Left undefined to disable navigation in this global view for now.
                     />
                   )
                 })}
              </div>
            </>
          )}
        </div>
        </TabsContent>
      </Tabs>
    </div>
  )
  
  // Helper to extract deployment id (new contract key `deploymentId` or legacy `id`)
  function getDeploymentId(dep: unknown): string {
    const d = dep as Record<string, unknown>
    const depId = d['deploymentId']
    if (typeof depId === 'string') return depId
    const legacy = d['id']
    if (typeof legacy === 'string') return legacy
    return ''
  }
}