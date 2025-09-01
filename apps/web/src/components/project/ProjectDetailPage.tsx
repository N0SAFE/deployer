'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { 
  Settings, 
  Users, 
  GitBranch, 
  Zap,
  Plus,
  ExternalLink,
  Globe,
  AlertCircle
} from 'lucide-react'
import ServiceCard from '../services/ServiceCard'
import DeploymentCard from '../deployments/DeploymentCard'
import ActivityFeed from '../activity/ActivityFeed'

import { useProject, useProjectCollaborators } from '@/hooks/useProjects'
import { useServices } from '@/hooks/useServices'
import { useDeployments } from '@/hooks/useDeployments'

interface ProjectDetailPageProps {
  projectId: string
}

export default function ProjectDetailPage({ projectId }: ProjectDetailPageProps) {
  // Fetch real project data using hooks
  const { data: project, isLoading: isProjectLoading, error: projectError } = useProject(projectId)
  const { data: collaboratorsData } = useProjectCollaborators(projectId)
  const { data: servicesData } = useServices(projectId)
  const { data: deploymentsData } = useDeployments({ 
    serviceId: servicesData?.services?.[0]?.id || undefined, // Get deployments for first service if available
    limit: 5 
  })

  // Loading states
  if (isProjectLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="flex space-x-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <Separator />
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error states
  if (projectError || !project) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {projectError?.message || 'Project not found'} 
            Please check the project ID and try again.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Extract data with fallbacks
  const services = servicesData?.services || []
  const collaborators = collaboratorsData?.collaborators || []
  const deployments = deploymentsData?.deployments || []

  // Type adapter function to convert API service data to ServiceCard expected format
  const adaptServiceForCard = (apiService: typeof services[0]) => {
    // Flatten the builderConfig to match what ServiceCard expects
    const flatBuilderConfig: Record<string, string | number | boolean> | null = 
      apiService.builderConfig ? 
        Object.fromEntries(
          Object.entries(apiService.builderConfig).map(([key, value]) => {
            // Handle nested objects like buildArgs by stringifying them
            if (typeof value === 'object' && value !== null) {
              return [key, JSON.stringify(value)]
            }
            return [key, value]
          })
        ) : null

    return {
      ...apiService,
      builderConfig: flatBuilderConfig
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Project Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center space-x-3">
            <h1 className="text-3xl font-bold">{project.name}</h1>
            <Badge variant="default">
              Active
            </Badge>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            {project.description}
          </p>
          <div className="flex items-center space-x-4 text-sm text-muted-foreground">
            <div className="flex items-center space-x-1">
              <GitBranch className="h-4 w-4" />
              <span className="text-muted-foreground">Repository</span>
            </div>
            {project.baseDomain && (
              <div className="flex items-center space-x-1">
                <Globe className="h-4 w-4" />
                <a 
                  href={`https://${project.baseDomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground"
                >
                  {project.baseDomain}
                  <ExternalLink className="h-3 w-3 ml-1 inline" />
                </a>
              </div>
            )}
          </div>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
          <Button size="sm">
            <Zap className="h-4 w-4 mr-2" />
            Deploy
          </Button>
        </div>
      </div>

      <Separator />

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="services">Services ({services.length})</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="team">Team ({collaborators.length})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Services Overview */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Services</h2>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Service
                </Button>
              </div>
              <div className="grid gap-4">
                {services.map((service) => (
                  <ServiceCard key={service.id} service={adaptServiceForCard(service)} />
                ))}
                {services.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No services found. Add a service to get started.
                  </div>
                )}
              </div>
            </div>

            {/* Activity Feed */}
            <div className="space-y-4">
              <ActivityFeed projectId={project.id} />
            </div>
          </div>

          {/* Recent Deployments */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Recent Deployments</h2>
            <div className="grid gap-4">
              {deployments.slice(0, 3).map((deployment) => (
                <DeploymentCard 
                  key={deployment.id} 
                  deployment={deployment} 
                  // We don't have a specific service context here; logs button will be disabled
                />
              ))}
              {deployments.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No deployments found
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Project Services</h2>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Service
            </Button>
          </div>
          <div className="grid gap-4">
            {services.map((service) => (
              <ServiceCard key={service.id} service={adaptServiceForCard(service)} />
            ))}
            {services.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No services found. Add a service to get started.
              </div>
            )}
          </div>
        </TabsContent>

        {/* Deployments Tab */}
        <TabsContent value="deployments" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Deployment History</h2>
            <Button>
              <Zap className="h-4 w-4 mr-2" />
              New Deployment
            </Button>
          </div>
          <div className="grid gap-4">
            {deployments.map((deployment) => (
              <DeploymentCard 
                key={deployment.id} 
                deployment={deployment} 
                // No explicit params; navigation to logs disabled in this context
              />
            ))}
            {deployments.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No deployments found
              </div>
            )}
          </div>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Team Members</h2>
            <Button>
              <Users className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </div>
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                {collaborators.map((collaborator) => (
                  <div key={collaborator.id} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium">
                          {collaborator.userId.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">User {collaborator.userId.slice(0, 8)}</p>
                        <p className="text-sm text-muted-foreground">ID: {collaborator.userId}</p>
                      </div>
                    </div>
                    <Badge variant="outline">{collaborator.role}</Badge>
                  </div>
                ))}
                {collaborators.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground">
                    No team members found
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <h2 className="text-xl font-semibold">Project Settings</h2>
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>General</CardTitle>
                <CardDescription>Basic project configuration</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Project settings interface will be implemented here
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Environment Variables</CardTitle>
                <CardDescription>Manage project environment variables</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Environment variables management interface will be implemented here
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}