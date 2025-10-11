'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@repo/ui/components/shadcn/tooltip'
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  Pause,
  HelpCircle,
  Activity,
  Square
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'

// Service health status types
export type ServiceHealth = 'healthy' | 'unhealthy' | 'unknown' | 'starting'
export type ContainerStatus = 'running' | 'stopped' | 'restarting' | 'paused' | 'exited'
export type DeploymentStatus = 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'

interface ServiceStatusIndicatorProps {
  // Core service status
  isActive: boolean
  deploymentStatus?: DeploymentStatus
  healthStatus?: ServiceHealth
  containerStatus?: ContainerStatus
  
  // Display options
  variant?: 'dot' | 'badge' | 'detailed'
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
  className?: string
}

export function ServiceStatusIndicator({
  isActive,
  deploymentStatus,
  healthStatus,
  containerStatus,
  variant = 'badge',
  size = 'md',
  showText = false,
  className
}: ServiceStatusIndicatorProps) {
  // Determine overall service state
  const getOverallStatus = () => {
    // If service is inactive, show as inactive
    if (!isActive) {
      return {
        status: 'inactive' as const,
        icon: Pause,
        color: 'text-gray-500',
        bgColor: 'bg-gray-100',
        borderColor: 'border-gray-200',
        label: 'Inactive',
        description: 'Service is deactivated'
      }
    }

    // If deployment is in progress, show deployment status
    if (deploymentStatus && ['pending', 'queued', 'building', 'deploying'].includes(deploymentStatus)) {
      return {
        status: 'deploying' as const,
        icon: Loader2,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        label: getDeploymentLabel(deploymentStatus),
        description: `Deployment ${deploymentStatus}`,
        spin: true
      }
    }

    // If deployment failed, show error
    if (deploymentStatus === 'failed') {
      return {
        status: 'error' as const,
        icon: XCircle,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        label: 'Deploy Failed',
        description: 'Latest deployment failed'
      }
    }

    // If deployment was cancelled
    if (deploymentStatus === 'cancelled') {
      return {
        status: 'cancelled' as const,
        icon: Square,
        color: 'text-gray-600',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200',
        label: 'Cancelled',
        description: 'Deployment was cancelled'
      }
    }

    // Check container status
    if (containerStatus === 'stopped' || containerStatus === 'exited') {
      return {
        status: 'stopped' as const,
        icon: Square,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        label: 'Stopped',
        description: 'Container is not running'
      }
    }

    if (containerStatus === 'restarting') {
      return {
        status: 'restarting' as const,
        icon: Loader2,
        color: 'text-orange-600',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
        label: 'Restarting',
        description: 'Container is restarting',
        spin: true
      }
    }

    if (containerStatus === 'paused') {
      return {
        status: 'paused' as const,
        icon: Pause,
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        label: 'Paused',
        description: 'Container is paused'
      }
    }

    // Check health status
    if (healthStatus === 'unhealthy') {
      return {
        status: 'unhealthy' as const,
        icon: XCircle,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        label: 'Unhealthy',
        description: 'Health checks failing'
      }
    }

    if (healthStatus === 'starting') {
      return {
        status: 'starting' as const,
        icon: Loader2,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        label: 'Starting',
        description: 'Service is starting up',
        spin: true
      }
    }

    if (healthStatus === 'unknown') {
      return {
        status: 'unknown' as const,
        icon: HelpCircle,
        color: 'text-gray-600',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200',
        label: 'Unknown',
        description: 'Health status unknown'
      }
    }

    // If everything looks good
    if (healthStatus === 'healthy' || (deploymentStatus === 'success' && containerStatus === 'running')) {
      return {
        status: 'healthy' as const,
        icon: CheckCircle2,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        label: 'Healthy',
        description: 'Service is running normally'
      }
    }

    // Default running state
    if (containerStatus === 'running' || deploymentStatus === 'success') {
      return {
        status: 'running' as const,
        icon: Activity,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        label: 'Running',
        description: 'Service is running'
      }
    }

    // Fallback to unknown
    return {
      status: 'unknown' as const,
      icon: HelpCircle,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      borderColor: 'border-gray-200',
      label: 'Unknown',
      description: 'Status unknown'
    }
  }

  const getDeploymentLabel = (status: DeploymentStatus) => {
    switch (status) {
      case 'pending': return 'Pending'
      case 'queued': return 'Queued'
      case 'building': return 'Building'
      case 'deploying': return 'Deploying'
      case 'success': return 'Success'
      case 'failed': return 'Failed'
      case 'cancelled': return 'Cancelled'
      default: return 'Unknown'
    }
  }

  const status = getOverallStatus()
  const Icon = status.icon

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return variant === 'dot' 
          ? 'h-2 w-2' 
          : 'h-4 w-4'
      case 'lg':
        return variant === 'dot' 
          ? 'h-4 w-4' 
          : 'h-6 w-6'
      default: // md
        return variant === 'dot' 
          ? 'h-3 w-3' 
          : 'h-5 w-5'
    }
  }

  const getTextSize = () => {
    switch (size) {
      case 'sm': return 'text-xs'
      case 'lg': return 'text-sm'
      default: return 'text-xs'
    }
  }

  // Dot variant - minimal status indicator
  if (variant === 'dot') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'rounded-full border-2',
                getSizeClasses(),
                status.bgColor,
                status.borderColor,
                className
              )}
              role="status"
              aria-label={status.description}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>{status.description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Badge variant - icon with optional text
  if (variant === 'badge') {
    const badgeVariant = 
      status.status === 'healthy' || status.status === 'running' ? 'default' :
      status.status === 'error' || status.status === 'unhealthy' || status.status === 'stopped' ? 'destructive' :
      status.status === 'deploying' || status.status === 'starting' || status.status === 'restarting' ? 'secondary' :
      'outline'

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={badgeVariant} className={cn('flex items-center gap-1', className)}>
              <Icon 
                className={cn(
                  getSizeClasses(),
                  status.spin && 'animate-spin'
                )}
              />
              {showText && (
                <span className={getTextSize()}>
                  {status.label}
                </span>
              )}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{status.description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Detailed variant - full status display
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('flex items-center justify-center rounded-full p-1', status.bgColor)}>
        <Icon 
          className={cn(
            getSizeClasses(),
            status.color,
            status.spin && 'animate-spin'
          )}
        />
      </div>
      <div className="flex flex-col">
        <span className={cn('font-medium', status.color, getTextSize())}>
          {status.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {status.description}
        </span>
      </div>
    </div>
  )
}

// Component for aggregated project status
interface ProjectStatusIndicatorProps {
  services: Array<{
    isActive: boolean
    latestDeployment?: {
      status: DeploymentStatus
    } | null
  }>
  variant?: 'dot' | 'badge' | 'detailed'
  size?: 'sm' | 'md' | 'lg'
  showCounts?: boolean
  className?: string
}

export function ProjectStatusIndicator({
  services,
  variant = 'badge',
  size = 'md',
  showCounts = false,
  className
}: ProjectStatusIndicatorProps) {
  const getProjectStatus = () => {
    const activeServices = services.filter(s => s.isActive)
    
    if (activeServices.length === 0) {
      return {
        status: 'no-services' as const,
        icon: HelpCircle,
        color: 'text-gray-500',
        bgColor: 'bg-gray-50',
        label: 'No Active Services',
        description: 'No active services in project',
        counts: { total: services.length, healthy: 0, errors: 0, deploying: 0 }
      }
    }

    let healthy = 0
    let errors = 0
    let deploying = 0
    let unknown = 0

    activeServices.forEach(service => {
      const deploymentStatus = service.latestDeployment?.status
      
      if (!deploymentStatus) {
        unknown++
      } else if (['pending', 'queued', 'building', 'deploying'].includes(deploymentStatus)) {
        deploying++
      } else if (deploymentStatus === 'failed') {
        errors++
      } else if (deploymentStatus === 'success') {
        healthy++
      } else {
        unknown++
      }
    })

    const counts = { 
      total: activeServices.length, 
      healthy, 
      errors, 
      deploying: deploying + unknown // Group deploying and unknown together
    }

    // Determine overall project status
    if (errors > 0) {
      return {
        status: 'errors' as const,
        icon: XCircle,
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        label: `${errors} Error${errors > 1 ? 's' : ''}`,
        description: `${errors} service${errors > 1 ? 's' : ''} with errors`,
        counts
      }
    }

    if (deploying > 0) {
      return {
        status: 'deploying' as const,
        icon: Loader2,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        label: `${deploying} Deploying`,
        description: `${deploying} service${deploying > 1 ? 's' : ''} deploying`,
        counts,
        spin: true
      }
    }

    if (healthy === activeServices.length) {
      return {
        status: 'healthy' as const,
        icon: CheckCircle2,
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        label: 'All Healthy',
        description: `All ${healthy} services healthy`,
        counts
      }
    }

    return {
      status: 'mixed' as const,
      icon: AlertCircle,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      label: 'Mixed Status',
      description: `${healthy} healthy, ${unknown} unknown`,
      counts
    }
  }

  const projectStatus = getProjectStatus()
  const Icon = projectStatus.icon

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return variant === 'dot' ? 'h-2 w-2' : 'h-4 w-4'
      case 'lg':
        return variant === 'dot' ? 'h-4 w-4' : 'h-6 w-6'
      default:
        return variant === 'dot' ? 'h-3 w-3' : 'h-5 w-5'
    }
  }

  if (variant === 'dot') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'rounded-full border-2',
                getSizeClasses(),
                projectStatus.bgColor,
                'border-current',
                projectStatus.color,
                className
              )}
              role="status"
              aria-label={projectStatus.description}
            />
          </TooltipTrigger>
          <TooltipContent>
            <div>
              <p className="font-medium">{projectStatus.description}</p>
              {showCounts && (
                <p className="text-xs text-muted-foreground">
                  {projectStatus.counts.healthy} healthy • {projectStatus.counts.errors} errors • {projectStatus.counts.deploying} deploying
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (variant === 'badge') {
    const badgeVariant = 
      projectStatus.status === 'healthy' ? 'default' :
      projectStatus.status === 'errors' ? 'destructive' :
      projectStatus.status === 'deploying' ? 'secondary' :
      'outline'

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={badgeVariant} className={cn('flex items-center gap-1', className)}>
              <Icon 
                className={cn(
                  getSizeClasses(),
                  projectStatus.spin && 'animate-spin'
                )}
              />
              <span className="text-xs">
                {showCounts ? (
                  `${projectStatus.counts.total} services`
                ) : (
                  projectStatus.label
                )}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div>
              <p className="font-medium">{projectStatus.description}</p>
              <p className="text-xs text-muted-foreground">
                {projectStatus.counts.healthy} healthy • {projectStatus.counts.errors} errors • {projectStatus.counts.deploying} deploying
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Detailed variant
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className={cn('flex items-center justify-center rounded-full p-2', projectStatus.bgColor)}>
        <Icon 
          className={cn(
            getSizeClasses(),
            projectStatus.color,
            projectStatus.spin && 'animate-spin'
          )}
        />
      </div>
      <div className="flex flex-col">
        <span className={cn('font-medium', projectStatus.color)}>
          {projectStatus.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {projectStatus.description}
        </span>
        {showCounts && (
          <div className="flex gap-3 mt-1 text-xs">
            <span className="text-green-600">{projectStatus.counts.healthy} healthy</span>
            {projectStatus.counts.errors > 0 && (
              <span className="text-red-600">{projectStatus.counts.errors} errors</span>
            )}
            {projectStatus.counts.deploying > 0 && (
              <span className="text-blue-600">{projectStatus.counts.deploying} deploying</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}