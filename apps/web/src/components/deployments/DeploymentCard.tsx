'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { 
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  RotateCcw,
  X,
  FileText,
  GitBranch,
  Calendar
} from 'lucide-react'
import { type Deployment } from '@/state/deploymentStore'

interface DeploymentCardProps {
  deployment: Deployment
}

export default function DeploymentCard({ deployment }: DeploymentCardProps) {
  const getStatusIcon = () => {
    switch (deployment.status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'cancelled':
        return <X className="h-4 w-4 text-gray-400" />
      case 'pending':
      case 'building':
      case 'deploying':
        return <Clock className="h-4 w-4 text-yellow-600 animate-pulse" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusColor = () => {
    switch (deployment.status) {
      case 'success':
        return 'default'
      case 'failed':
        return 'destructive'
      case 'cancelled':
        return 'outline'
      case 'pending':
      case 'building':
      case 'deploying':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  const formatDuration = (duration?: number) => {
    if (!duration) return 'N/A'
    const seconds = Math.floor(duration / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  const isActive = ['pending', 'building', 'deploying'].includes(deployment.status)

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <CardTitle className="text-base">
                Deployment {deployment.id.slice(0, 8)}
              </CardTitle>
              <Badge variant={getStatusColor() as "default" | "destructive" | "outline" | "secondary"}>
                {deployment.status}
              </Badge>
            </div>
            <div className="flex items-center space-x-4 text-sm text-muted-foreground">
              <div className="flex items-center space-x-1">
                <Calendar className="h-3 w-3" />
                <span>{new Date(deployment.createdAt).toLocaleString()}</span>
              </div>
              {deployment.sourceConfig.branch && (
                <div className="flex items-center space-x-1">
                  <GitBranch className="h-3 w-3" />
                  <span className="font-mono text-xs">{deployment.sourceConfig.branch}</span>
                </div>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem>
                <FileText className="h-4 w-4 mr-2" />
                View Logs
              </DropdownMenuItem>
              {deployment.status === 'success' && (
                <DropdownMenuItem>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Rollback
                </DropdownMenuItem>
              )}
              {isActive && (
                <DropdownMenuItem className="text-destructive">
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Environment</span>
              <p className="font-medium capitalize">{deployment.environment}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Source</span>
              <p className="font-medium capitalize">{deployment.sourceType}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Duration</span>
              <p className="font-medium">{formatDuration(deployment.duration)}</p>
            </div>
          </div>

          {deployment.url && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">URL</span>
              <a 
                href={deployment.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline font-mono text-xs flex items-center space-x-1"
              >
                <ExternalLink className="h-3 w-3" />
                <span>{deployment.url}</span>
              </a>
            </div>
          )}

          {isActive && deployment.progress !== undefined && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="text-xs font-medium">{deployment.progress}%</span>
              </div>
              <Progress value={deployment.progress} className="h-2" />
            </div>
          )}

          <div className="pt-2 border-t flex space-x-2">
            {deployment.url && (
              <Button variant="outline" size="sm" asChild className="flex-1">
                <a href={deployment.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Visit
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" className="flex-1">
              <FileText className="h-3 w-3 mr-1" />
              Logs
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}