'use client'

import { useState } from 'react'
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
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
  MoreHorizontal, 
  Play, 
  Pause, 
  Settings, 
  Trash2, 
  ExternalLink,
  GitBranch,
  Clock,
  Activity,
  Network,
  ChevronRight
} from 'lucide-react'
import { 
  useServiceDependencies, 
  useToggleServiceActive, 
  useDeleteService, 
  useServiceHealth 
} from '@/hooks/useServices'
import { ServiceStatusIndicator } from './ServiceStatusIndicator'
import ServiceDependencyView from './ServiceDependencyView'
import { DashboardProjectsProjectIdServicesServiceIdTabs } from '@/routes'

interface ServiceCardProps {
  service: {
    id: string
    projectId: string
    name: string
    type: string
    provider: 'github' | 'gitlab' | 'bitbucket' | 'docker_registry' | 'gitea' | 's3_bucket' | 'manual'
    builder: 'nixpack' | 'railpack' | 'dockerfile' | 'buildpack' | 'static' | 'docker_compose'
    providerConfig: {
      repositoryUrl?: string
      branch?: string
      accessToken?: string
      deployKey?: string
      registryUrl?: string
      imageName?: string
      tag?: string
      username?: string
      password?: string
      bucketName?: string
      region?: string
      accessKeyId?: string
      secretAccessKey?: string
      objectKey?: string
      instructions?: string
      deploymentScript?: string
    } | null
    builderConfig: {
      dockerfilePath?: string
      buildContext?: string
      buildArgs?: Record<string, string>
      buildCommand?: string
      startCommand?: string
      installCommand?: string
      outputDirectory?: string
      composeFilePath?: string
      serviceName?: string
    } | null
    port: number | null
    healthCheckPath: string
    environmentVariables: Record<string, string> | null
    resourceLimits: {
      memory?: string
      cpu?: string
      storage?: string
    } | null
    isActive: boolean
    createdAt: Date
    updatedAt: Date
    _count: {
      deployments: number
      dependencies: number
    }
    latestDeployment: {
      id: string
      status: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'
      environment: 'production' | 'staging' | 'preview' | 'development'
      createdAt: Date
      domainUrl: string | null
    } | null
    project: {
      id: string
      name: string
      baseDomain: string | null
    }
  }
}

export default function ServiceCard({ service }: ServiceCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showDependencies, setShowDependencies] = useState(false)
  
  const { data: dependenciesData } = useServiceDependencies(service.id)
  const { data: healthData } = useServiceHealth(service.id)
  const toggleActive = useToggleServiceActive()
  const deleteService = useDeleteService()
  
  const dependencies = dependenciesData?.dependencies || []
  
  const getProviderLabel = (provider: string) => {
    const labels = {
      github: 'GitHub',
      gitlab: 'GitLab', 
      bitbucket: 'Bitbucket',
      docker_registry: 'Docker Registry',
      gitea: 'Gitea',
      s3_bucket: 'S3 Bucket',
      manual: 'Manual'
    }
    return labels[provider as keyof typeof labels] || provider
  }
  
  const getBuilderLabel = (builder: string) => {
    const labels = {
      dockerfile: 'Dockerfile',
      nixpack: 'Nixpack',
      railpack: 'Railpack', 
      buildpack: 'Buildpack',
      static: 'Static',
      docker_compose: 'Docker Compose'
    }
    return labels[builder as keyof typeof labels] || builder
  }
  

  
  const handleToggleActive = async () => {
    try {
      await toggleActive.mutateAsync({
        id: service.id,
        isActive: !service.isActive,
      })
    } catch (error) {
      console.error('Failed to toggle service:', error)
    }
  }
  
  const handleDelete = async () => {
    try {
      await deleteService.mutateAsync({ id: service.id })
      setShowDeleteDialog(false)
    } catch (error) {
      console.error('Failed to delete service:', error)
    }
  }

  return (
    <>
      <Card className={`transition-all hover:shadow-md ${!service.isActive ? 'opacity-60' : ''}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center space-x-2">
                <CardTitle className="text-base">{service.name}</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {service.type}
                </Badge>
              </div>
              <CardDescription className="text-sm">
                {service.port ? `Port ${service.port}` : 'No port configured'}
                {service.project.baseDomain && (
                  <span className="ml-2 text-xs">
                    • {service.project.baseDomain}
                  </span>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {getProviderLabel(service.provider)} • {getBuilderLabel(service.builder)}
                </div>
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <DashboardProjectsProjectIdServicesServiceIdTabs.Link
                    projectId={service.projectId} 
                    serviceId={service.id}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    View Details
                  </DashboardProjectsProjectIdServicesServiceIdTabs.Link>
                </DropdownMenuItem>
                {service.latestDeployment?.domainUrl && (
                  <DropdownMenuItem asChild>
                    <a 
                      href={service.latestDeployment.domainUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Service
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Settings className="h-4 w-4 mr-2" />
                  Configure
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <GitBranch className="h-4 w-4 mr-2" />
                  Deploy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleToggleActive}>
                  {service.isActive ? (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Activate
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-4">
          {/* Service Status */}
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center space-x-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Service Status</span>
            </div>
            <div className="flex items-center space-x-2">
              <ServiceStatusIndicator
                isActive={service.isActive}
                deploymentStatus={service.latestDeployment?.status}
                healthStatus={healthData?.status}
                containerStatus={healthData?.containerStatus}
                variant="badge"
                showText={true}
                size="sm"
              />
              {service.latestDeployment && (
                <span className="text-xs text-muted-foreground">
                  {service.latestDeployment.environment}
                </span>
              )}
            </div>
          </div>

          {/* Service Stats */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1">
                <GitBranch className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {service._count.deployments} deploys
                </span>
              </div>
              <div className="flex items-center space-x-1">
                <Network className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {dependencies.length} deps
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="text-xs">
                {new Date(service.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Dependencies Preview */}
          {dependencies.length > 0 && (
            <div 
              className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              onClick={() => setShowDependencies(true)}
            >
              <div className="flex items-center space-x-2">
                <Network className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  {dependencies.length} Dependenc{dependencies.length === 1 ? 'y' : 'ies'}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          )}

          {/* Status Indicator */}
          <div className="flex items-center justify-between">
            <ServiceStatusIndicator
              isActive={service.isActive}
              deploymentStatus={service.latestDeployment?.status}
              healthStatus={healthData?.status}
              containerStatus={healthData?.containerStatus}
              variant="detailed"
              size="sm"
            />
            <Button asChild size="sm" variant="outline">
              <DashboardProjectsProjectIdServicesServiceIdTabs.Link 
                projectId={service.projectId} 
                serviceId={service.id}
              >
                <ChevronRight className="h-4 w-4 mr-1" />
                View Details
              </DashboardProjectsProjectIdServicesServiceIdTabs.Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dependencies Dialog */}
      <ServiceDependencyView
        serviceId={service.id}
        serviceName={service.name}
        open={showDependencies}
        onOpenChange={setShowDependencies}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{service.name}&rdquo;? This action cannot be undone.
              All deployments and configurations for this service will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteService.isPending ? 'Deleting...' : 'Delete Service'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}