'use client'

import { useState } from 'react'
import { useService, useServiceDeployments, useServiceLogs } from '@/hooks/useServices';
import ServiceDependencyView from '@/components/services/ServiceDependencyView'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle, Network, FileText, RotateCcw } from 'lucide-react'
import ServiceScalingCard from '@/components/orchestration/ServiceScalingCard'

interface ServiceOverviewPageProps {
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceOverviewPage({ params }: ServiceOverviewPageProps) {
  const [dependenciesOpen, setDependenciesOpen] = useState(false)
  
  const { data: service } = useService(params.serviceId)
  const { data: deploymentsData } = useServiceDeployments(params.serviceId)
  const { data: logsData } = useServiceLogs(params.serviceId)

  const deployments = deploymentsData?.deployments || []
  const recentLogs = logsData?.logs?.slice(0, 5) || []
  const latestDeployment = deployments[0]

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-green-600'
      case 'failed': return 'text-red-600'
      case 'building':
      case 'deploying': return 'text-blue-600'
      case 'pending':
      case 'queued': return 'text-yellow-600'
      default: return 'text-gray-600'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="h-4 w-4" />
      case 'failed': return <XCircle className="h-4 w-4" />
      case 'building':
      case 'deploying': return <Loader2 className="h-4 w-4 animate-spin" />
      case 'pending':
      case 'queued': return <Clock className="h-4 w-4" />
      default: return <AlertCircle className="h-4 w-4" />
    }
  }

  return (
    <>
      <div className="space-y-6">
      {/* Latest Deployment */}
      <Card>
        <CardHeader>
          <CardTitle>Latest Deployment</CardTitle>
          <CardDescription>Current deployment status and information</CardDescription>
        </CardHeader>
        <CardContent>
          {latestDeployment ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={getStatusColor(latestDeployment.status)}>
                    {getStatusIcon(latestDeployment.status)}
                  </div>
                  <span className="font-medium capitalize">{latestDeployment.status}</span>
                </div>
                <Badge variant="outline">
                  {latestDeployment.environment}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                Deployed {new Date(latestDeployment.createdAt).toLocaleString()}
              </div>
              <div className="flex space-x-2">
                <Button size="sm" variant="outline">
                  <FileText className="h-4 w-4 mr-2" />
                  View Logs
                </Button>
                <Button size="sm" variant="outline">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Rollback
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">
                No deployments yet
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Service configuration and settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Provider</h4>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{service ? getProviderLabel(service.provider) : 'Loading...'}</Badge>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Builder</h4>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{service ? getBuilderLabel(service.builder) : 'Loading...'}</Badge>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Source</h4>
            <p className="text-sm bg-muted p-2 rounded">
              Managed via {service ? getProviderLabel(service.provider) : 'Loading...'}
            </p>
          </div>

          {service && (
            <div className="pt-2">
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setDependenciesOpen(true)}
              >
                <Network className="h-4 w-4 mr-2" />
                Manage Dependencies
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service Scaling */}
      {service && (
        <ServiceScalingCard 
          stackId={params.id} // project ID as stack ID
          service={{
            name: service.name,
            status: 'running',
            replicas: {
              desired: 1,
              current: 1,
              updated: 1
            },
            ports: []
          }}
        />
      )}

      {/* Recent Deployments */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Deployments</CardTitle>
          <CardDescription>Latest deployment activity</CardDescription>
        </CardHeader>
        <CardContent>
          {deployments.length > 0 ? (
            <div className="space-y-3">
              {deployments.slice(0, 3).map((deployment) => (
                <div
                  key={deployment.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={deployment.status === 'success' ? 'default' : 'destructive'}>
                      {deployment.status}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">Deployment {deployment.id.slice(0, 7)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(deployment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {deployment.status === 'success' ? 'Completed' : 'In progress'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No deployments yet</p>
          )}
        </CardContent>
      </Card>

      {/* Service Dependencies */}
      <Card>
        <CardHeader>
          <CardTitle>Dependencies</CardTitle>
          <CardDescription>Services that this service depends on</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Click &ldquo;Manage Dependencies&rdquo; in the Configuration section above to view and manage dependencies.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest service activity and logs</CardDescription>
        </CardHeader>
        <CardContent>
          {recentLogs.length > 0 ? (
            <div className="space-y-2">
              {recentLogs.map((log, index) => (
                <div key={log.id || index} className="text-sm font-mono bg-muted p-2 rounded">
                  <span className="text-muted-foreground">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>{' '}
                  {log.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No recent activity</p>
          )}
        </CardContent>
      </Card>
    </div>

      <ServiceDependencyView 
        open={dependenciesOpen}
        onOpenChange={setDependenciesOpen}
        serviceId={params.serviceId}
        serviceName={service?.name || 'Service'}
      />
    </>
  )
}