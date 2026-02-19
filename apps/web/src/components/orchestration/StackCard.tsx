'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { 
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  FileText,
  Settings,
  Scale,
  Activity,
  Server,
  Globe
} from 'lucide-react'
import { type StackStatus } from '@repo/api-contracts/modules/orchestration'

interface StackCardProps {
  stack: StackStatus
  onEdit?: (stackId: string) => void
  onScale?: (stackId: string) => void
  onRemove?: (stackId: string) => void
  onViewLogs?: (stackId: string) => void
  onViewDetails?: (stackId: string) => void
}

export default function StackCard({ 
  stack, 
  onEdit, 
  onScale, 
  onRemove, 
  onViewLogs, 
  onViewDetails 
}: StackCardProps) {
  const getStatusIcon = () => {
    switch (stack.status) {
      case 'running':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'stopped':
        return <X className="h-4 w-4 text-gray-400" />
      case 'pending':
      case 'deploying':
        return <Clock className="h-4 w-4 text-yellow-600 animate-pulse" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusColor = (): 'default' | 'destructive' | 'outline' | 'secondary' => {
    switch (stack.status) {
      case 'running':
        return 'default'
      case 'error':
        return 'destructive'
      case 'stopped':
        return 'outline'
      case 'pending':
      case 'deploying':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  const getRunningReplicas = () => {
    return stack.services.reduce((total, service) => total + service.replicas.current, 0)
  }

  const getDesiredReplicas = () => {
    return stack.services.reduce((total, service) => total + service.replicas.desired, 0)
  }

  const getHealthyServices = () => {
    return stack.services.filter(service => service.status === 'running').length
  }

  const hasExternalEndpoints = () => {
    return stack.services.some(service => service.endpoints && service.endpoints.length > 0)
  }

  const isActive = ['pending', 'deploying'].includes(stack.status)

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <CardTitle className="text-base">
                {stack.name}
              </CardTitle>
              <Badge variant={getStatusColor()}>
                {stack.status}
              </Badge>
            </div>
            <div className="flex items-center space-x-4 text-sm text-muted-foreground">
              <div className="flex items-center space-x-1">
                <Server className="h-3 w-3" />
                <span>{stack.projectId}</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                  {stack.environment}
                </span>
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewDetails?.(stack.id)}>
                <Activity className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onViewLogs?.(stack.id)}>
                <FileText className="h-4 w-4 mr-2" />
                View Logs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onScale?.(stack.id)}>
                <Scale className="h-4 w-4 mr-2" />
                Scale Services
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit?.(stack.id)}>
                <Settings className="h-4 w-4 mr-2" />
                Edit Stack
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!isActive && (
                <DropdownMenuItem 
                  className="text-destructive"
                  onClick={() => onRemove?.(stack.id)}
                >
                  <X className="h-4 w-4 mr-2" />
                  Remove Stack
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Service Stats */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Services</span>
              <p className="font-medium">
                {getHealthyServices()}/{stack.services.length}
                <span className="text-muted-foreground text-xs ml-1">healthy</span>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Replicas</span>
              <p className="font-medium">
                {getRunningReplicas()}/{getDesiredReplicas()}
                <span className="text-muted-foreground text-xs ml-1">running</span>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Updated</span>
              <p className="font-medium text-xs">
                {new Date(stack.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Resource Usage (if available) */}
          {stack.resourceUsage && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Resource Usage</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">CPU</span>
                    <span>{stack.resourceUsage.cpu.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div 
                      className="bg-blue-600 h-1.5 rounded-full" 
                      style={{ width: `${Math.min(stack.resourceUsage.cpu.percentage, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Memory</span>
                    <span>{stack.resourceUsage.memory.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div 
                      className="bg-green-600 h-1.5 rounded-full" 
                      style={{ width: `${Math.min(stack.resourceUsage.memory.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* External Endpoints */}
          {hasExternalEndpoints() && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Endpoints</h4>
              <div className="space-y-1">
                {stack.services.map((service) => 
                  service.endpoints?.map((endpoint, index) => (
                    <div key={`${service.name}-${index}`} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground font-mono text-xs">
                        {service.name}
                      </span>
                      <a 
                        href={endpoint} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-mono text-xs flex items-center space-x-1"
                      >
                        <Globe className="h-3 w-3" />
                        <span>{endpoint}</span>
                      </a>
                    </div>
                  )) || []
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 border-t flex space-x-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={() => onViewDetails?.(stack.id)}
            >
              <Activity className="h-3 w-3 mr-1" />
              Details
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={() => onScale?.(stack.id)}
              disabled={isActive}
            >
              <Scale className="h-3 w-3 mr-1" />
              Scale
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}