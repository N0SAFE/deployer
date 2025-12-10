'use client'

import type { JSX } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Globe,
  Server,
  Cog,
  Database,
  HardDrive,
  ListTodo,
  MoreHorizontal,
  Settings,
  Trash2,
  GitBranch,
  ExternalLink,
  Activity,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { cn } from '@/lib/utils'

// Service types
export type ServiceType = 'web' | 'api' | 'worker' | 'database' | 'cache' | 'queue'
export type ServiceStatus = 'running' | 'stopped' | 'deploying' | 'failed' | 'unknown'
export type ServiceRuntime = 'node' | 'python' | 'go' | 'rust' | 'docker' | 'static'

export interface Service {
  id: string
  name: string
  slug: string
  projectId: string
  type: ServiceType
  runtime: ServiceRuntime
  status: ServiceStatus
  repository?: string
  branch: string
  url?: string
  healthCheckPath?: string
  lastDeployedAt?: Date
  createdAt: Date
  updatedAt: Date
  _count?: {
    dependencies?: number
    dependents?: number
    environments?: number
  }
}

const serviceTypeConfig: Record<
  ServiceType,
  { icon: typeof Server; label: string; color: string }
> = {
  web: { icon: Globe, label: 'Web', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100' },
  api: { icon: Server, label: 'API', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' },
  worker: { icon: Cog, label: 'Worker', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100' },
  database: { icon: Database, label: 'Database', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100' },
  cache: { icon: HardDrive, label: 'Cache', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100' },
  queue: { icon: ListTodo, label: 'Queue', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100' },
}

const statusConfig: Record<
  ServiceStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  running: { label: 'Running', variant: 'default' },
  stopped: { label: 'Stopped', variant: 'secondary' },
  deploying: { label: 'Deploying', variant: 'outline' },
  failed: { label: 'Failed', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
}

interface ServiceCardProps {
  service: Service
  onSelect?: (service: Service) => void
  onSettings?: (service: Service) => void
  onDelete?: (service: Service) => void
  onViewUrl?: (service: Service) => void
  className?: string
}

export function ServiceCard({
  service,
  onSelect,
  onSettings,
  onDelete,
  onViewUrl,
  className,
}: ServiceCardProps): JSX.Element {
  const typeConfig = serviceTypeConfig[service.type]
  const statusCfg = statusConfig[service.status]
  const TypeIcon = typeConfig.icon

  return (
    <Card
      className={cn(
        'relative transition-all hover:shadow-md',
        onSelect && 'cursor-pointer',
        className
      )}
      onClick={() => onSelect?.(service)}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <div className={cn('rounded-lg p-2', typeConfig.color)}>
            <TypeIcon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">{service.name}</CardTitle>
            <CardDescription className="text-muted-foreground flex items-center gap-1 text-xs">
              <GitBranch className="h-3 w-3" />
              {service.branch}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusCfg.variant} className="text-xs">
            {service.status === 'running' && (
              <Activity className="mr-1 h-3 w-3 animate-pulse" />
            )}
            {statusCfg.label}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => {e.stopPropagation()}}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {service.url && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onViewUrl?.(service)
                  }}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open URL
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onSettings?.(service)
                }}
              >
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete?.(service)
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-xs">
              {typeConfig.label}
            </Badge>
            <span>{service.runtime}</span>
          </div>
          <div className="flex items-center gap-3">
            {service._count?.dependencies !== undefined && service._count.dependencies > 0 && (
              <span>{service._count.dependencies} deps</span>
            )}
            {service._count?.environments !== undefined && (
              <span>{service._count.environments} envs</span>
            )}
          </div>
        </div>
        {service.lastDeployedAt && (
          <p className="text-muted-foreground mt-2 text-xs">
            Last deployed: {new Date(service.lastDeployedAt).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Export ServiceTypeIcon for use in graphs
export function ServiceTypeIcon({
  type,
  className,
}: {
  type: ServiceType
  className?: string
}): JSX.Element {
  const config = serviceTypeConfig[type]
  const Icon = config.icon
  return <Icon className={className} />
}

export { serviceTypeConfig, statusConfig }
