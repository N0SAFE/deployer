'use client'

import { useState } from 'react'
import { useServices } from '@/hooks/useServices'
import { useDeployments } from '@/hooks/useDeployments'
import { Card, CardContent } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Container,
  Search,
  Filter,
  Zap,
  Loader2
} from 'lucide-react'
import DeploymentCard from '@/components/deployments/DeploymentCard'
import NewDeploymentDialog from '@/components/deployments/NewDeploymentDialog'

interface ProjectDeploymentsPageProps {
  params: {
    projectId: string
  }
}

export default function ProjectDeploymentsPage({ params }: ProjectDeploymentsPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all')
  const [showNewDeploymentDialog, setShowNewDeploymentDialog] = useState(false)

  // Get all services for this project
  const { data: servicesData } = useServices(params.projectId)
  const services = servicesData?.services || []

  // Get all deployments for all services (we'll need to modify this to get project-level deployments)
  const { data: deploymentsData, isLoading } = useDeployments({
    // For now, we'll get all deployments and filter client-side
    // In a real implementation, we'd add projectId to the API
  })
  const allDeployments = deploymentsData?.deployments || []

  // Filter deployments based on search and filters
  const filteredDeployments = allDeployments.filter((deployment) => {
    const matchesSearch = searchQuery === '' || 
      deployment.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      services.find(s => s.id === deployment.serviceId)?.name.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFilter === 'all' || deployment.status === statusFilter
    const matchesEnvironment = environmentFilter === 'all' || deployment.environment === environmentFilter

    return matchesSearch && matchesStatus && matchesEnvironment
  })

  // Get deployment statistics
  const stats = {
    total: allDeployments.length,
    success: allDeployments.filter(d => d.status === 'success').length,
    failed: allDeployments.filter(d => d.status === 'failed').length,
    pending: allDeployments.filter(d => ['pending', 'building', 'deploying'].includes(d.status)).length,
  }

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Deployment History</h3>
          <p className="text-sm text-muted-foreground">
            View deployment history across all services in this project
          </p>
        </div>
        <Button onClick={() => setShowNewDeploymentDialog(true)}>
          <Zap className="h-4 w-4 mr-2" />
          New Deployment
        </Button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <div className="text-2xl font-bold">{stats.total}</div>
              <Badge variant="outline">Total</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">All deployments</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <div className="text-2xl font-bold text-green-600">{stats.success}</div>
              <Badge variant="default">Success</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Successful deployments</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              <Badge variant="destructive">Failed</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Failed deployments</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <Badge variant="secondary">Pending</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">In progress</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search deployments or services..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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

        <Select value={environmentFilter} onValueChange={setEnvironmentFilter}>
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
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading deployments...</p>
            </div>
          </div>
        ) : filteredDeployments.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Container className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {allDeployments.length === 0 ? 'No deployments yet' : 'No deployments match your filters'}
                </h3>
                <p className="text-muted-foreground mb-6">
                  {allDeployments.length === 0 
                    ? 'Deploy services to see deployment history here'
                    : 'Try adjusting your search or filter criteria'
                  }
                </p>
                {allDeployments.length === 0 && (
                  <Button onClick={() => setShowNewDeploymentDialog(true)}>
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
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredDeployments.map((deployment) => {
                // Enhance deployment data with service information
                const service = services.find(s => s.id === deployment.serviceId)
                const enhancedDeployment = {
                  ...deployment,
                  sourceConfig: {
                    branch: 'main' // This would come from the actual deployment data
                  },
                  sourceType: 'git',
                  duration: Math.floor(Math.random() * 300000), // Mock duration - would come from API
                  url: service ? `https://${service.name}.example.com` : undefined,
                  progress: ['pending', 'building', 'deploying'].includes(deployment.status) 
                    ? Math.floor(Math.random() * 100) : undefined
                }

                return (
                  <DeploymentCard 
                    key={deployment.id} 
                    deployment={enhancedDeployment}
                  />
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* New Deployment Dialog */}
      <NewDeploymentDialog
        open={showNewDeploymentDialog}
        onOpenChange={setShowNewDeploymentDialog}
        projectId={params.projectId}
      />
    </div>
  )
}