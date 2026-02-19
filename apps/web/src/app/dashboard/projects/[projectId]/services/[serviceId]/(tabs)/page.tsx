'use client'

import { useState } from 'react'
import { useService, useServiceDeployments, useServiceLogs } from '@/hooks/useServices';
import ServiceDependencyView from '@/components/services/ServiceDependencyView'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle, Network, FileText, RotateCcw, Globe } from 'lucide-react'
import ServiceScalingCard from '@/components/orchestration/ServiceScalingCard'
import { DashboardProjectsProjectIdServicesServiceIdTabs } from '@/routes';
import { useParams } from '@/routes/hooks';
import Link from 'next/link'

export default function ServiceOverviewPage() {
  const params = useParams(DashboardProjectsProjectIdServicesServiceIdTabs)
  const [dependenciesOpen, setDependenciesOpen] = useState(false)
  
  const { data: service } = useService(params.serviceId)
  const { data: deploymentsData } = useServiceDeployments(params.serviceId)
  const { data: logsData } = useServiceLogs(params.serviceId)

  const deployments = deploymentsData?.deployments || []
  
  const getDeploymentId = (dep: unknown): string => {
    const d = dep as Record<string, unknown>
    const depId = d['deploymentId']
    if (typeof depId === 'string') return depId
    const legacy = d['id']
    if (typeof legacy === 'string') return legacy
    return ''
  }

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
          <CardDescription>Service build and deployment configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Provider</h4>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {service?.providerId ? getProviderLabel(service.providerId) : 'Loading...'}
                </Badge>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Builder</h4>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {service?.builderId ? getBuilderLabel(service.builderId) : 'Loading...'}
                </Badge>
              </div>
            </div>
          </div>

          {service?.providerConfig && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Source Repository</h4>
              <div className="text-sm bg-muted p-3 rounded space-y-1">
                {service.providerConfig.repositoryUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Repository:</span>
                    <code className="text-xs">{service.providerConfig.repositoryUrl}</code>
                  </div>
                )}
                {service.providerConfig.branch && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Branch:</span>
                    <code className="text-xs bg-background px-1 rounded">{service.providerConfig.branch}</code>
                  </div>
                )}
                {service.providerConfig.imageName && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Image:</span>
                    <code className="text-xs">{service.providerConfig.imageName}</code>
                    {service.providerConfig.tag && <Badge variant="outline" className="text-xs">{service.providerConfig.tag}</Badge>}
                  </div>
                )}
                {service.providerConfig.bucketName && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Bucket:</span>
                    <code className="text-xs">{service.providerConfig.bucketName}</code>
                    {service.providerConfig.region && <Badge variant="outline" className="text-xs">{service.providerConfig.region}</Badge>}
                  </div>
                )}
              </div>
            </div>
          )}

          {service?.builderConfig && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Build Configuration</h4>
              <div className="text-sm bg-muted p-3 rounded space-y-1">
                {service.builderConfig.dockerfilePath && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Dockerfile:</span>
                    <code className="text-xs">{service.builderConfig.dockerfilePath}</code>
                  </div>
                )}
                {service.builderConfig.buildContext && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Context:</span>
                    <code className="text-xs">{service.builderConfig.buildContext}</code>
                  </div>
                )}
                {service.builderConfig.outputDirectory && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Output:</span>
                    <code className="text-xs">{service.builderConfig.outputDirectory}</code>
                  </div>
                )}
                {service.builderConfig.buildCommand && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Build:</span>
                    <code className="text-xs">{service.builderConfig.buildCommand}</code>
                  </div>
                )}
              </div>
            </div>
          )}

          {service?.port && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Network</h4>
              <div className="text-sm bg-muted p-2 rounded">
                Port: <code className="text-xs bg-background px-1 rounded">{service.port}</code>
              </div>
            </div>
          )}

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
          stackId={params.projectId} // project ID as stack ID
          service={{
            name: service.name,
            status: latestDeployment?.status === 'success' ? 'running' : 
                    latestDeployment?.status === 'failed' ? 'failed' : 
                    latestDeployment ? 'deploying' : 'stopped',
            replicas: {
              desired: 1, // TODO: Get from actual deployment or scaling config
              current: latestDeployment?.status === 'success' ? 1 : 0,
              updated: latestDeployment?.status === 'success' ? 1 : 0
            },
            ports: service.port ? [service.port] : []
          }}
        />
      )}

      {/* Recent Deployments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Deployments</CardTitle>
              <CardDescription>
                {deployments.length > 0 
                  ? `Showing ${Math.min(3, deployments.length)} of ${deployments.length} deployments` 
                  : 'No deployments yet'}
              </CardDescription>
            </div>
            {deployments.length > 3 && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/dashboard/projects/${params.projectId}/services/${params.serviceId}/deployments`}>
                  View All
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {deployments.length > 0 ? (
            <div className="space-y-3">
              {deployments.slice(0, 3).map((deployment) => (
                <div
                  key={getDeploymentId(deployment) || JSON.stringify(deployment)}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={deployment.status === 'success' ? 'default' : 'destructive'}>
                      {deployment.status}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">
                        {deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1)} • 
                        {getDeploymentId(deployment) ? ` #${getDeploymentId(deployment).slice(0, 7)}` : ' Deployment'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(deployment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {deployment.domainUrl && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={deployment.domainUrl} target="_blank" rel="noopener noreferrer">
                          <Globe className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {deployment.status === 'success' ? 'Active' : 
                       deployment.status === 'failed' ? 'Failed' : 'In progress'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-4">
                No deployments yet. Deploy your service to see it here.
              </p>
              <Button size="sm" variant="outline">
                Create Deployment
              </Button>
            </div>
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