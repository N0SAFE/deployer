'use client'

import { useState } from 'react'
import { useService } from '@/hooks/useServices'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { 
  Info,
  GitBranch,
  Zap,
  Shield,
  Clock,
  AlertCircle,
  ExternalLink
} from 'lucide-react'

interface GeneralConfigurationClientProps {
  serviceId: string
}

export function GeneralConfigurationClient({ serviceId }: GeneralConfigurationClientProps) {
  const { data: service } = useService(serviceId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [autoDeployEnabled, setAutoDeployEnabled] = useState(true)
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(true)
  const [loggingEnabled, setLoggingEnabled] = useState(true)

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
      buildpack: 'Buildpack',
      nixpacks: 'Nixpacks',
      static: 'Static',
      manual: 'Manual'
    }
    return labels[builder as keyof typeof labels] || builder
  }

  if (!service) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted rounded-md animate-pulse" />
        <div className="h-32 bg-muted rounded-md animate-pulse" />
      </div>
    )
  }

  const repositoryUrl = service.providerConfig?.repositoryUrl || ''
  const branch = service.providerConfig?.branch || 'main'
  const dockerfilePath = service.builderConfig?.dockerfilePath || 'Dockerfile'
  const buildContext = service.builderConfig?.buildContext || '.'
  const buildCommand = service.builderConfig?.buildCommand || ''
  const startCommand = service.builderConfig?.startCommand || ''

  return (
    <div className="space-y-6">
      {/* Service Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Service Information
          </CardTitle>
          <CardDescription>
            Basic information and metadata about your service
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="service-name">Service Name</Label>
              <Input 
                id="service-name" 
                value={service.name} 
                onChange={() => setHasUnsavedChanges(true)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-type">Service Type</Label>
              <Input 
                id="service-type" 
                value={service.type} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="web, worker, database"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="service-url">Repository URL</Label>
            <div className="flex">
              <Input 
                id="service-url" 
                value={repositoryUrl} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="https://github.com/user/repo"
                className="flex-1"
              />
              {repositoryUrl && (
                <Button variant="outline" size="icon" className="ml-2" asChild>
                  <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{getProviderLabel(service.providerId)}</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Builder</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{getBuilderLabel(service.builderId)}</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <div className="flex items-center gap-2">
                <Badge variant={service.isActive ? 'default' : 'secondary'}>
                  {service.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Build Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Build Configuration
          </CardTitle>
          <CardDescription>
            Build settings and deployment configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <Input 
                id="branch" 
                value={branch} 
                onChange={() => setHasUnsavedChanges(true)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="build-context">Build Context</Label>
              <Input 
                id="build-context" 
                value={buildContext} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="./"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dockerfile">Dockerfile Path</Label>
              <Input 
                id="dockerfile" 
                value={dockerfilePath} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="Dockerfile"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input 
                id="port" 
                type="number" 
                value={service.port || 3000} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="3000"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="build-command">Build Command</Label>
              <Input 
                id="build-command" 
                value={buildCommand}
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="npm run build"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-command">Start Command</Label>
              <Input 
                id="start-command" 
                value={startCommand}
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="npm start"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Runtime Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Runtime Configuration
          </CardTitle>
          <CardDescription>
            Service runtime behavior and deployment settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="health-check-path">Health Check Path</Label>
            <Input 
              id="health-check-path" 
              value={service.healthCheckPath || '/health'} 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="/health"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-deploy">Auto Deploy</Label>
              <p className="text-sm text-muted-foreground">
                Automatically deploy when changes are detected
              </p>
            </div>
            <Switch 
              id="auto-deploy"
              checked={autoDeployEnabled}
              onCheckedChange={setAutoDeployEnabled}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="instances">Instances</Label>
              <Input 
                id="instances" 
                type="number" 
                value="1" 
                onChange={() => setHasUnsavedChanges(true)}
                min="1"
                max="10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy">Deployment Strategy</Label>
              <Input 
                id="strategy" 
                value="rolling" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="rolling, recreate"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="health-check-enabled">Health Checks</Label>
              <p className="text-sm text-muted-foreground">
                Enable automatic health monitoring
              </p>
            </div>
            <Switch 
              id="health-check-enabled"
              checked={healthCheckEnabled}
              onCheckedChange={setHealthCheckEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Resource Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Resource Configuration
          </CardTitle>
          <CardDescription>
            Resource limits and constraints for the service
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="memory-limit">Memory Limit</Label>
              <Input 
                id="memory-limit" 
                value={service.resourceLimits?.memory || ''} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="512m"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpu-limit">CPU Limit</Label>
              <Input 
                id="cpu-limit" 
                value={service.resourceLimits?.cpu || ''} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="0.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="storage-limit">Storage Limit</Label>
              <Input 
                id="storage-limit" 
                value={service.resourceLimits?.storage || ''} 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="1g"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monitoring & Logging */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Monitoring & Logging
          </CardTitle>
          <CardDescription>
            Service monitoring, logging, and observability settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="logging-enabled">Application Logging</Label>
              <p className="text-sm text-muted-foreground">
                Collect and store application logs
              </p>
            </div>
            <Switch 
              id="logging-enabled"
              checked={loggingEnabled}
              onCheckedChange={setLoggingEnabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="service-active">Service Active</Label>
              <p className="text-sm text-muted-foreground">
                Enable or disable the service
              </p>
            </div>
            <Switch 
              id="service-active"
              checked={service.isActive}
              onCheckedChange={() => setHasUnsavedChanges(true)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Advanced Settings
          </CardTitle>
          <CardDescription>
            Advanced service configuration and metadata
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Created</Label>
            <p className="text-sm text-muted-foreground">
              {new Date(service.createdAt).toLocaleDateString()} at {new Date(service.createdAt).toLocaleTimeString()}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Last Updated</Label>
            <p className="text-sm text-muted-foreground">
              {new Date(service.updatedAt).toLocaleDateString()} at {new Date(service.updatedAt).toLocaleTimeString()}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Service ID</Label>
            <Input value={service.id} readOnly />
          </div>

          <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800">
                  Configuration Changes
                </p>
                <p className="text-sm text-yellow-700">
                  Changes to service configuration may require a deployment to take effect. 
                  Some settings like resource limits require container restart.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}