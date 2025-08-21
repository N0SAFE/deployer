'use client'

import { useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { 
  Activity,
  Settings,
  MoreHorizontal,
  ExternalLink,
  GitBranch,
  Zap,
  Users,
  Globe,
  CheckCircle2,
  Server,
  Container,
  Loader2
} from 'lucide-react'
import { useProject } from '@/hooks/useProjects'
import ActivityFeed from '@/components/activity/ActivityFeed'
import OrganizationTeamManagement from '@/components/organization/OrganizationTeamManagement'
import ServiceList from '@/components/services/ServiceList'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  
  const { data: project, isLoading, error } = useProject(projectId)
  
  const [activeTab, setActiveTab] = useState('overview')

  // Mock data for now - will be replaced with proper hooks later
  const services: unknown[] = []
  const deployments: unknown[] = []
  
  // Memoize deployment calculations to prevent infinite loops
  const { activeDeployments, successRate } = useMemo(() => {
    const active = deployments.filter((d: unknown) => {
      const deployment = d as { status?: string }
      return ['pending', 'queued', 'building', 'deploying'].includes(deployment.status || '')
    })
    
    const successful = deployments.filter((d: unknown) => {
      const deployment = d as { status?: string }
      return deployment.status === 'success'
    })
    const rate = deployments.length > 0 
      ? Math.round((successful.length / deployments.length) * 100) 
      : 0

    return {
      activeDeployments: active,
      successRate: rate
    }
  }, [deployments])

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Failed to load project</p>
          <p className="text-sm text-muted-foreground">
            {error?.message || 'Project not found'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
            <Badge variant="default">
              Active
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {project.description || 'No description provided'}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Domain
              </DropdownMenuItem>
              <DropdownMenuItem>
                <GitBranch className="h-4 w-4 mr-2" />
                Git Settings
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Users className="h-4 w-4 mr-2" />
                Manage Team
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Project Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Services</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{services.length}</div>
            <p className="text-xs text-muted-foreground">
              0 active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deployments</CardTitle>
            <Container className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deployments.length}</div>
            <p className="text-xs text-muted-foreground">
              {activeDeployments.length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successRate}%</div>
            <p className="text-xs text-muted-foreground">
              Last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">99.9%</div>
            <p className="text-xs text-muted-foreground">
              Last 7 days
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Project Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="previews">Preview Environments</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Recent Deployments */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Deployments</CardTitle>
                <CardDescription>
                  Latest deployment activity for this project
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {deployments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No deployments yet
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Deployment history will be shown here
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Service Health */}
            <Card>
              <CardHeader>
                <CardTitle>Service Health</CardTitle>
                <CardDescription>
                  Current status of all services
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {services.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No services configured
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Service health status will be shown here
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <ServiceList projectId={projectId} />
        </TabsContent>

        <TabsContent value="deployments" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Deployments</h3>
              <p className="text-sm text-muted-foreground">
                View and manage all deployments for this project
              </p>
            </div>
            <Button>
              <Zap className="h-4 w-4 mr-2" />
              New Deployment
            </Button>
          </div>

          <div className="space-y-4">
            {deployments.length === 0 ? (
              <div className="text-center py-12">
                <Container className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No deployments yet</h3>
                <p className="text-muted-foreground mb-6">
                  Deploy your services to see them here
                </p>
                <Button>
                  <Zap className="h-4 w-4 mr-2" />
                  Start Deployment
                </Button>
              </div>
            ) : (
              <div className="text-center py-12">
                <Container className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Deployments will be shown here</h3>
                <p className="text-muted-foreground">
                  Deployment history will be implemented with proper hooks
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="previews">
          <Card>
            <CardHeader>
              <CardTitle>Preview Environments</CardTitle>
              <CardDescription>
                Manage temporary environments for testing and reviews
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Preview environments coming soon</h3>
                <p className="text-muted-foreground">
                  Automatic preview deployments for pull requests and branches
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team">
          <OrganizationTeamManagement />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityFeed projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}