'use client'

import { useState } from 'react'
import { useService } from '@/hooks/useServices'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
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

interface ServiceGeneralConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceGeneralConfigPage({ params }: ServiceGeneralConfigProps) {
  const { data: service } = useService(params.serviceId)
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
      nixpack: 'Nixpack',
      railpack: 'Railpack', 
      buildpack: 'Buildpack',
      static: 'Static',
      docker_compose: 'Docker Compose'
    }
    return labels[builder as keyof typeof labels] || builder
  }

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading configuration...</p>
      </div>
    )
  }

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
            Basic service details and metadata
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Service Name</Label>
              <Input 
                id="name" 
                value={service.name} 
                onChange={() => setHasUnsavedChanges(true)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Service Type</Label>
              <Input id="type" value={service.type} readOnly />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea 
              id="description" 
              placeholder="Describe what this service does..." 
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Badge variant="default">
                running
              </Badge>
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Badge variant="outline">{getProviderLabel(service.provider)}</Badge>
            </div>
            <div className="space-y-2">
              <Label>Builder</Label>
              <Badge variant="outline">{getBuilderLabel(service.builder)}</Badge>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Service URL</Label>
            <div className="flex items-center gap-2">
              <Input value="https://service.example.com" readOnly />
              <Button variant="outline" size="sm" asChild>
                <a href="https://service.example.com" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Source Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Source Configuration
          </CardTitle>
          <CardDescription>
            Repository and source code settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repository">Repository URL</Label>
            <Input 
              id="repository" 
              value="https://github.com/example/repo" 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="Repository URL or reference"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <Input 
                id="branch" 
                value="main" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., main, master, develop"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="root-dir">Root Directory</Label>
              <Input 
                id="root-dir" 
                value="." 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., ., ./api, ./services/app"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-deploy">Auto Deploy</Label>
              <p className="text-sm text-muted-foreground">
                Automatically deploy when the branch is updated
              </p>
            </div>
            <Switch 
              id="auto-deploy"
              checked={autoDeployEnabled}
              onCheckedChange={setAutoDeployEnabled}
            />
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
            Service runtime and deployment settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="space-y-2">
              <Label htmlFor="timeout">Deploy Timeout (seconds)</Label>
              <Input 
                id="timeout" 
                type="number" 
                value="600" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="600"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="healthcheck-path">Health Check Path</Label>
            <Input 
              id="healthcheck-path" 
              value={service.healthCheckPath || '/health'} 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="/health"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="health-check-enabled">Health Check</Label>
              <p className="text-sm text-muted-foreground">
                Monitor service health status
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

          <div className="space-y-2">
            <Label htmlFor="log-level">Log Level</Label>
            <Input 
              id="log-level" 
              value="info" 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="debug, info, warn, error"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="restart-policy">Restart Policy</Label>
              <Input 
                id="restart-policy" 
                value="always" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="always, on-failure, unless-stopped"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-restarts">Max Restarts</Label>
              <Input 
                id="max-restarts" 
                type="number" 
                value="3" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="3"
              />
            </div>
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
            Advanced service configuration options
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pre-deploy">Pre-deploy Command</Label>
            <Textarea 
              id="pre-deploy" 
              placeholder="Commands to run before deployment..."
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-deploy">Post-deploy Command</Label>
            <Textarea 
              id="post-deploy" 
              placeholder="Commands to run after deployment..."
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
          </div>

          <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800">
                  Advanced Configuration
                </p>
                <p className="text-sm text-yellow-700">
                  These settings affect service deployment and runtime behavior. Make sure you understand the implications before making changes.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}