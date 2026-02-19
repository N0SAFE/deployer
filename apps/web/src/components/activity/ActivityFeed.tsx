'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import { 
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  GitBranch,
  Users,
  Settings,
  Upload,
  Activity,
  AlertCircle
} from 'lucide-react'
import { useProjectActivity } from '@/hooks/useActivity'
import type { UserActivity } from '@/hooks/useActivity'

interface ActivityFeedProps {
  projectId: string
}

export default function ActivityFeed({ projectId }: ActivityFeedProps) {
  const { data: activityData, isLoading, error } = useProjectActivity(projectId, { 
    limit: 10,
    timeRange: '7d',
    offset: 0
  })

  const activities = activityData?.data || []

  const getActivityIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case 'deployment':
      case 'deploy':
        return Zap
      case 'commit':
      case 'push':
        return GitBranch
      case 'invite':
      case 'join':
        return Users
      case 'update':
      case 'configure':
        return Settings
      case 'upload':
        return Upload
      default:
        return Activity
    }
  }

  const getStatusIcon = (action: string, details?: Record<string, unknown>) => {
    if (details?.status && typeof details.status === 'string') {
      switch (details.status.toLowerCase()) {
        case 'success':
        case 'completed':
          return CheckCircle2
        case 'failed':
        case 'error':
          return XCircle
        case 'building':
        case 'deploying':
        case 'pending':
          return Clock
        default:
          return Activity
      }
    }
    
    // Fallback based on action
    if (action.toLowerCase().includes('fail')) return XCircle
    if (action.toLowerCase().includes('success')) return CheckCircle2
    return getActivityIcon(action)
  }

  const getStatusBadge = (action: string, details?: Record<string, unknown>) => {
    const status = typeof details?.status === 'string' ? details.status.toLowerCase() : undefined
    
    switch (status) {
      case 'success':
      case 'completed':
        return { variant: 'default' as const, label: 'Success' }
      case 'failed':
      case 'error':
        return { variant: 'destructive' as const, label: 'Failed' }
      case 'building':
      case 'deploying':
        return { variant: 'secondary' as const, label: 'In Progress' }
      case 'pending':
        return { variant: 'outline' as const, label: 'Pending' }
      default:
        return { variant: 'secondary' as const, label: 'Info' }
    }
  }

  const getActivityTitle = (activity: UserActivity) => {
    const action = activity.action
    const details = activity.details
    
    switch (action.toLowerCase()) {
      case 'deployment':
      case 'deploy':
        return details?.status === 'success' ? 'Deployment completed' : 
               details?.status === 'failed' ? 'Deployment failed' : 'Deployment started'
      case 'commit':
      case 'push':
        return 'New commit pushed'
      case 'invite':
        return 'User invited to project'
      case 'join':
        return 'User joined project'
      case 'update':
        return 'Configuration updated'
      default:
        return `${action.charAt(0).toUpperCase()}${action.slice(1)} action`
    }
  }

  const getActivityDescription = (activity: UserActivity) => {
    const details = activity.details
    const resource = activity.resource
    
    if (details?.message) return details.message
    if (details?.description) return details.description
    if (details?.commitMessage) return details.commitMessage
    
    // Generate description based on action and resource
    if (resource) {
      const resourceParts = resource.split(':')
      const resourceType = resourceParts[0]
      const resourceId = resourceParts[1]
      
      switch (resourceType) {
        case 'project':
          return `Action performed on project`
        case 'service':
          return `Service ${resourceId || 'updated'}`
        case 'deployment':
          return `Deployment ${resourceId || 'processed'}`
        default:
          return `Action performed on ${resourceType}`
      }
    }
    
    return `${activity.action} completed`
  }

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date()
    const diff = now.getTime() - timestamp.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
    
    return timestamp.toLocaleDateString()
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <CardDescription>
            Project activity and updates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center space-x-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          <CardDescription>
            Project activity and updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load activity data. Please try again later.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Activity</CardTitle>
        <CardDescription>
          Project activity and updates
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activities.length > 0 ? (
          <div className="space-y-4">
            {activities.map((activity, index) => {
              const Icon = getStatusIcon(activity.action, activity.details)
              const badge = getStatusBadge(activity.action, activity.details)
              const title = getActivityTitle(activity)
              const description = getActivityDescription(activity)
              
              return (
                <div key={`${activity.userId}-${activity.timestamp.getTime()}-${index}`} className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground truncate">
                        {title}
                      </p>
                      <Badge variant={badge.variant} className="ml-2">
                        {badge.label}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-1">
                      {description}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatTimestamp(activity.timestamp)} • User {activity.userId.slice(0, 8)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No recent activity</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}