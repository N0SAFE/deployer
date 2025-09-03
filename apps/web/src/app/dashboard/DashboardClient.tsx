'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Progress } from '@repo/ui/components/shadcn/progress'
import { 
  Activity, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  FolderOpen,
  Server,
  Globe
} from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { useDeployments } from '@/hooks/useDeployments'
import { useSystemHealthOverview } from '@/hooks/useHealth'

export default function DashboardClient() {
  const { data: projectsResponse } = useProjects()
  const { data: deploymentsResponse } = useDeployments({ limit: 100 })
  const healthOverview = useSystemHealthOverview()
  
  const projects = projectsResponse?.projects || []
  const globalDeployments = deploymentsResponse?.deployments || []
  const activeDeployments = globalDeployments.filter(d => 
    ['pending', 'queued', 'building', 'deploying'].includes(d.status)
  )
  
  // Calculate deployment metrics
  const totalDeployments = globalDeployments.length
  const successfulDeployments = globalDeployments.filter(d => d.status === 'success').length
  const successRate = totalDeployments > 0 ? Math.round((successfulDeployments / totalDeployments) * 100) : 0
  
  // Recent deployments (last 5)
  const recentDeployments = globalDeployments.slice(0, 5)
  
  // Real system health data from API
  const systemHealthData = healthOverview.detailed || {
    status: 'unknown',
    database: { status: 'unknown' },
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor your deployments and system health
        </p>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects.length}</div>
            <p className="text-xs text-muted-foreground">
              Active projects
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Deployments</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeDeployments.length}</div>
            <p className="text-xs text-muted-foreground">
              Currently running
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
            <CardTitle className="text-sm font-medium">Total Deployments</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDeployments}</div>
            <p className="text-xs text-muted-foreground">
              All time
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Recent Activity */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Deployments</CardTitle>
            <CardDescription>
              Your latest deployment activity
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentDeployments.length > 0 ? (
              recentDeployments.map((deployment) => (
                <div key={deployment.id} className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    {deployment.status === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : deployment.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-600" />
                    ) : deployment.status === 'pending' || deployment.status === 'building' || deployment.status === 'deploying' ? (
                      <Clock className="h-4 w-4 text-yellow-600 animate-pulse" />
                    ) : (
                      <Clock className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      Deployment {deployment.id.slice(0, 8)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {deployment.environment} • {new Date(deployment.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <Badge 
                      variant={
                        deployment.status === 'success' ? 'default' :
                        deployment.status === 'failed' ? 'destructive' :
                        'secondary'
                      }
                    >
                      {deployment.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">No deployments yet</p>
                <Button className="mt-4" size="sm">
                  Create your first deployment
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Health */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>
              Current status of system components
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Globe className="h-4 w-4" />
                  <span className="text-sm font-medium">System</span>
                </div>
                <Badge 
                  variant="outline" 
                  className={
                    healthOverview.basic?.status === 'healthy' ? 'text-green-600' : 
                    healthOverview.isLoading ? 'text-yellow-600' : 'text-red-600'
                  }
                >
                  {healthOverview.isLoading ? 'Checking...' : 
                   healthOverview.basic?.status || 'Unknown'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Server className="h-4 w-4" />
                  <span className="text-sm font-medium">Database</span>
                </div>
                <Badge 
                  variant="outline" 
                  className={
                    systemHealthData.database.status === 'healthy' ? 'text-green-600' : 
                    healthOverview.isLoading ? 'text-yellow-600' : 'text-red-600'
                  }
                >
                  {healthOverview.isLoading ? 'Checking...' : 
                   systemHealthData.database.status || 'Unknown'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Activity className="h-4 w-4" />
                  <span className="text-sm font-medium">Memory Usage</span>
                </div>
                <Badge variant="outline" className="text-blue-600">
                  {'memory' in systemHealthData && systemHealthData.memory ? 
                    `${Math.round((systemHealthData.memory.used / systemHealthData.memory.total) * 100)}%` : 
                    'N/A'
                  }
                </Badge>
              </div>
              
              {'uptime' in systemHealthData && systemHealthData.uptime && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm font-medium">Uptime</span>
                  </div>
                  <Badge variant="outline" className="text-blue-600">
                    {'uptime' in systemHealthData ? Math.floor(systemHealthData.uptime / 3600) : 0}h
                  </Badge>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">Quick Actions</h4>
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Create Project
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Zap className="h-4 w-4 mr-2" />
                  View All Deployments
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Deployments Progress */}
      {activeDeployments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Deployments</CardTitle>
            <CardDescription>
              Deployments currently in progress
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeDeployments.map((deployment) => (
              <div key={deployment.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Deployment {deployment.id.slice(0, 8)} ({deployment.environment})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {deployment.status}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {deployment.status}
                  </Badge>
                </div>
                {['pending', 'building', 'deploying'].includes(deployment.status) && (
                  <Progress value={50} className="h-2" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}