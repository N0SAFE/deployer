'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  GitBranch,
  Users,
  Settings,
  Upload
} from 'lucide-react'

interface ActivityFeedProps {
  projectId: string
}

// Mock activity data - will be replaced with real data from the API
const mockActivities = [
  {
    id: '1',
    type: 'deployment',
    title: 'Deployment completed',
    description: 'Successfully deployed web service to production',
    status: 'success',
    timestamp: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
    user: 'John Doe'
  },
  {
    id: '2',
    type: 'deployment',
    title: 'Deployment started',
    description: 'Building and deploying API service to staging',
    status: 'building',
    timestamp: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
    user: 'Jane Smith'
  },
  {
    id: '3',
    type: 'git',
    title: 'New commit pushed',
    description: 'feat: add user authentication system',
    status: 'info',
    timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    user: 'John Doe'
  },
  {
    id: '4',
    type: 'team',
    title: 'Team member invited',
    description: 'Invited alice@example.com as developer',
    status: 'info',
    timestamp: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
    user: 'Admin'
  },
  {
    id: '5',
    type: 'deployment',
    title: 'Deployment failed',
    description: 'Build failed for web service - missing dependencies',
    status: 'failed',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    user: 'Bot'
  },
  {
    id: '6',
    type: 'upload',
    title: 'File upload deployment',
    description: 'Deployed from uploaded ZIP file',
    status: 'success',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3), // 3 hours ago
    user: 'Jane Smith'
  }
]

export default function ActivityFeed({ projectId }: ActivityFeedProps) {
  // TODO: Use projectId for real API calls to fetch activity
  console.log('Loading activity feed for project:', projectId)
  
  const getActivityIcon = (type: string, status: string) => {
    switch (type) {
      case 'deployment':
        if (status === 'success') {
          return <CheckCircle2 className="h-4 w-4 text-green-600" />
        } else if (status === 'failed') {
          return <XCircle className="h-4 w-4 text-red-600" />
        } else {
          return <Clock className="h-4 w-4 text-yellow-600" />
        }
      case 'git':
        return <GitBranch className="h-4 w-4 text-blue-600" />
      case 'team':
        return <Users className="h-4 w-4 text-purple-600" />
      case 'settings':
        return <Settings className="h-4 w-4 text-gray-600" />
      case 'upload':
        return <Upload className="h-4 w-4 text-indigo-600" />
      default:
        return <Zap className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'default'
      case 'failed':
        return 'destructive'
      case 'building':
      case 'deploying':
        return 'secondary'
      case 'info':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) {
      return `${diffInSeconds}s ago`
    } else if (diffInSeconds < 3600) {
      return `${Math.floor(diffInSeconds / 60)}m ago`
    } else if (diffInSeconds < 86400) {
      return `${Math.floor(diffInSeconds / 3600)}h ago`
    } else {
      return `${Math.floor(diffInSeconds / 86400)}d ago`
    }
  }

  // Filter activities by projectId (in real implementation)
  const activities = mockActivities
  
  // TODO: Implement real-time activity feed using _projectId

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Activity Feed</CardTitle>
          <CardDescription>
            Recent activity and events for this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activities.map((activity, index) => (
              <div key={activity.id} className="flex items-start space-x-4">
                <div className="flex-shrink-0 mt-1">
                  {getActivityIcon(activity.type, activity.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <p className="text-sm font-medium">{activity.title}</p>
                    <Badge 
                      variant={getStatusColor(activity.status) as "default" | "destructive" | "outline" | "secondary"}
                      className="text-xs"
                    >
                      {activity.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {activity.description}
                  </p>
                  <div className="flex items-center space-x-3 text-xs text-muted-foreground">
                    <span>{formatTimeAgo(activity.timestamp)}</span>
                    <span>•</span>
                    <span>by {activity.user}</span>
                  </div>
                </div>
                {index < activities.length - 1 && (
                  <div className="absolute left-6 mt-8 h-8 w-px bg-border" 
                       style={{ marginLeft: '1.5rem' }} />
                )}
              </div>
            ))}
          </div>
          
          {activities.length === 0 && (
            <div className="text-center py-8">
              <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No recent activity</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}