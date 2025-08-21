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
import { useServiceDependencies, useToggleServiceActive, useDeleteService } from '@/hooks/useServices'
import ServiceDependencyView from './ServiceDependencyView'

interface ServiceCardProps {
  service: {
    id: string
    projectId: string
    name: string
    type: string
    dockerfilePath: string
    buildContext: string
    port: number | null
    healthCheckPath: string
    environmentVariables: Record<string, string> | null
    buildArguments: Record<string, string> | null
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
  const toggleActive = useToggleServiceActive()
  const deleteService = useDeleteService()
  
  const dependencies = dependenciesData?.dependencies || []
  
  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { variant: 'secondary' as const, label: 'Pending' },
      queued: { variant: 'secondary' as const, label: 'Queued' },
      building: { variant: 'default' as const, label: 'Building' },
      deploying: { variant: 'default' as const, label: 'Deploying' },
      success: { variant: 'default' as const, label: 'Success' },
      failed: { variant: 'destructive' as const, label: 'Failed' },
      cancelled: { variant: 'secondary' as const, label: 'Cancelled' },
    }
    
    return statusConfig[status as keyof typeof statusConfig] || statusConfig.pending
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
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {service.latestDeployment?.domainUrl && (
                  <>
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
                    <DropdownMenuSeparator />
                  </>
                )}
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
          {/* Latest Deployment Status */}
          {service.latestDeployment && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center space-x-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Latest Deploy</span>
              </div>
              <div className="flex items-center space-x-2">
                <Badge 
                  variant={getStatusBadge(service.latestDeployment.status).variant}
                  className="text-xs"
                >
                  {getStatusBadge(service.latestDeployment.status).label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {service.latestDeployment.environment}
                </span>
              </div>
            </div>
          )}

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
            <div className="flex items-center space-x-2">
              <div className={`h-2 w-2 rounded-full ${
                service.isActive 
                  ? 'bg-green-500' 
                  : 'bg-gray-400'
              }`} />
              <span className="text-sm text-muted-foreground">
                {service.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
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