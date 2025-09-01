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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { 
  Server,
  GitBranch,
  Clock,
  RotateCcw,
  PlayCircle,
  PauseCircle,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Zap
} from 'lucide-react'

interface ServiceDeploymentConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default function ServiceDeploymentConfigPage({ params }: ServiceDeploymentConfigProps) {
  const { data: service } = useService(params.serviceId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [autoDeployEnabled, setAutoDeployEnabled] = useState(true)
  const [rollbackEnabled, setRollbackEnabled] = useState(true)
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(true)
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('production')

  // Mock environments data - in real implementation, this would come from an API
  const environments = [
    { id: 'production', name: 'Production', status: 'healthy' },
    { id: 'staging', name: 'Staging', status: 'healthy' },
    { id: 'development', name: 'Development', status: 'updating' },
    { id: 'preview-pr-123', name: 'Preview: PR #123', status: 'pending' },
  ]

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading deployment configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Environment Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Environment Configuration
          </CardTitle>
          <CardDescription>
            Select environment to configure deployment settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="environment">Target Environment</Label>
            <Select value={selectedEnvironment} onValueChange={setSelectedEnvironment}>
              <SelectTrigger>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env.id} value={env.id}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        env.status === 'healthy' ? 'bg-green-500' :
                        env.status === 'updating' ? 'bg-yellow-500' :
                        env.status === 'error' ? 'bg-red-500' :
                        'bg-gray-500'
                      }`} />
                      {env.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {selectedEnvironment && (
            <div className="p-3 border border-blue-200 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">
                <strong>Selected:</strong> {environments.find(e => e.id === selectedEnvironment)?.name}
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Configuration below applies to this environment only
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deployment Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Deployment Settings for {environments.find(e => e.id === selectedEnvironment)?.name}
          </CardTitle>
          <CardDescription>
            Configure how and when your service is deployed to this environment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-deploy">Automatic Deployment</Label>
              <p className="text-sm text-muted-foreground">
                Deploy automatically when changes are pushed to the configured branch
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
              <Label htmlFor="deploy-branch">Deploy Branch</Label>
              <Input 
                id="deploy-branch" 
                value={
                  selectedEnvironment === 'production' ? 'main' :
                  selectedEnvironment === 'staging' ? 'staging' :
                  selectedEnvironment === 'development' ? 'develop' :
                  selectedEnvironment.startsWith('preview-') ? 'pr-123' : 'main'
                } 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., main, staging, develop"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deploy-strategy">Deployment Strategy</Label>
              <Select defaultValue={
                selectedEnvironment === 'production' ? 'blue-green' :
                selectedEnvironment === 'staging' ? 'rolling' :
                'recreate'
              }>
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rolling">Rolling Update</SelectItem>
                  <SelectItem value="blue-green">Blue-Green</SelectItem>
                  <SelectItem value="canary">Canary</SelectItem>
                  <SelectItem value="recreate">Recreate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="deploy-timeout">Deploy Timeout (minutes)</Label>
              <Input 
                id="deploy-timeout" 
                type="number" 
                value={
                  selectedEnvironment === 'production' ? '15' :
                  selectedEnvironment === 'staging' ? '10' :
                  '5'
                } 
                onChange={() => setHasUnsavedChanges(true)}
                min="1"
                max="60"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instances">Number of Instances</Label>
              <Input 
                id="instances" 
                type="number" 
                value={
                  selectedEnvironment === 'production' ? '3' :
                  selectedEnvironment === 'staging' ? '2' :
                  '1'
                } 
                onChange={() => setHasUnsavedChanges(true)}
                min="1"
                max="10"
              />
            </div>
          </div>

          {selectedEnvironment.startsWith('preview-') && (
            <div className="p-3 border border-purple-200 bg-purple-50 rounded-lg">
              <div className="flex items-start gap-2">
                <GitBranch className="h-4 w-4 text-purple-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-purple-800 mb-1">
                    Preview Environment Settings
                  </p>
                  <ul className="text-sm text-purple-700 space-y-1">
                    <li>• Temporary environment for PR testing</li>
                    <li>• Automatically cleaned up when PR is merged/closed</li>
                    <li>• Limited resources and simplified deployment</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Environment Variables */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Environment Variables
          </CardTitle>
          <CardDescription>
            Configure environment-specific variables for {environments.find(e => e.id === selectedEnvironment)?.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {/* Mock environment variables */}
            {[
              { key: 'NODE_ENV', value: selectedEnvironment === 'production' ? 'production' : selectedEnvironment === 'staging' ? 'staging' : 'development', dynamic: false },
              { key: 'API_URL', value: '${services.api.url}', dynamic: true },
              { key: 'DATABASE_URL', value: selectedEnvironment === 'production' ? '${databases.prod.connectionString}' : '${databases.staging.connectionString}', dynamic: true },
              { key: 'REDIS_URL', value: '${services.redis.url}', dynamic: true },
              { key: 'LOG_LEVEL', value: selectedEnvironment === 'production' ? 'error' : 'debug', dynamic: false }
            ].map((envVar, index) => (
              <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{envVar.key}</p>
                    {envVar.dynamic && (
                      <Badge variant="secondary" className="text-xs">
                        Dynamic
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground font-mono">
                    {envVar.value}
                  </p>
                </div>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              </div>
            ))}
            
            <Button variant="outline" className="w-full">
              <Zap className="h-4 w-4 mr-2" />
              Add Environment Variable
            </Button>
            
            <div className="p-3 border border-blue-200 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <Zap className="h-4 w-4 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800 mb-1">
                    Dynamic Variables
                  </p>
                  <p className="text-sm text-blue-700">
                    Use <code className="bg-blue-100 px-1 rounded text-xs">{'${service.name}'}</code> syntax to reference other services and projects. 
                    Variables are resolved at deployment time based on the target environment.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Health Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Health Checks
          </CardTitle>
          <CardDescription>
            Configure health monitoring for deployment validation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="health-check">Enable Health Checks</Label>
              <p className="text-sm text-muted-foreground">
                Monitor service health during and after deployment
              </p>
            </div>
            <Switch 
              id="health-check"
              checked={healthCheckEnabled}
              onCheckedChange={setHealthCheckEnabled}
            />
          </div>

          {healthCheckEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="health-path">Health Check Path</Label>
                  <Input 
                    id="health-path" 
                    value="/health" 
                    onChange={() => setHasUnsavedChanges(true)}
                    placeholder="/health, /api/health, /status"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="health-interval">Check Interval (seconds)</Label>
                  <Input 
                    id="health-interval" 
                    type="number" 
                    value="30" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="10"
                    max="300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="health-timeout">Timeout (seconds)</Label>
                  <Input 
                    id="health-timeout" 
                    type="number" 
                    value="5" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="1"
                    max="30"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="health-retries">Max Failures</Label>
                  <Input 
                    id="health-retries" 
                    type="number" 
                    value="3" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="1"
                    max="10"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rollback Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Rollback Configuration
          </CardTitle>
          <CardDescription>
            Automatic rollback settings for failed deployments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-rollback">Auto Rollback</Label>
              <p className="text-sm text-muted-foreground">
                Automatically rollback to previous version if deployment fails
              </p>
            </div>
            <Switch 
              id="auto-rollback"
              checked={rollbackEnabled}
              onCheckedChange={setRollbackEnabled}
            />
          </div>

          {rollbackEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rollback-threshold">Failure Threshold</Label>
                  <Select defaultValue="health-check-fail">
                    <SelectTrigger>
                      <SelectValue placeholder="Select threshold" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="health-check-fail">Health Check Failure</SelectItem>
                      <SelectItem value="startup-fail">Startup Failure</SelectItem>
                      <SelectItem value="high-error-rate">High Error Rate</SelectItem>
                      <SelectItem value="manual">Manual Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rollback-timeout">Rollback Timeout (minutes)</Label>
                  <Input 
                    id="rollback-timeout" 
                    type="number" 
                    value="5" 
                    onChange={() => setHasUnsavedChanges(true)}
                    min="1"
                    max="30"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deployment Hooks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Deployment Hooks
          </CardTitle>
          <CardDescription>
            Custom commands to run during deployment process
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pre-deploy">Pre-deployment Commands</Label>
            <Textarea 
              id="pre-deploy" 
              placeholder="Commands to run before deployment starts..."
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Run database migrations, clear caches, etc.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-deploy">Post-deployment Commands</Label>
            <Textarea 
              id="post-deploy" 
              placeholder="Commands to run after successful deployment..."
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Send notifications, warm up caches, update external services, etc.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rollback-commands">Rollback Commands</Label>
            <Textarea 
              id="rollback-commands" 
              placeholder="Commands to run during rollback..."
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Restore database, revert configuration changes, etc.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recent Deployments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Deployments to {environments.find(e => e.id === selectedEnvironment)?.name}
          </CardTitle>
          <CardDescription>
            History of recent deployment attempts to this environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Mock deployment history - environment specific */}
            {[
              { 
                id: '1', 
                status: selectedEnvironment === 'production' ? 'success' : selectedEnvironment === 'staging' ? 'success' : 'pending',
                version: selectedEnvironment === 'production' ? 'v1.2.3' : selectedEnvironment === 'staging' ? 'v1.2.4-staging' : 'v1.3.0-dev',
                time: selectedEnvironment === 'production' ? '2 hours ago' : selectedEnvironment === 'staging' ? '30 minutes ago' : '5 minutes ago',
                commit: selectedEnvironment === 'production' ? 'feat: Add user auth' : selectedEnvironment === 'staging' ? 'test: User auth improvements' : 'dev: WIP user management',
                duration: selectedEnvironment === 'production' ? '8m 42s' : selectedEnvironment === 'staging' ? '5m 15s' : '2m 30s',
                environment: selectedEnvironment
              },
              { 
                id: '2', 
                status: 'success', 
                version: selectedEnvironment === 'production' ? 'v1.2.2' : selectedEnvironment === 'staging' ? 'v1.2.3-staging' : 'v1.2.9-dev',
                time: selectedEnvironment === 'production' ? '1 day ago' : selectedEnvironment === 'staging' ? '2 hours ago' : '1 hour ago',
                commit: selectedEnvironment === 'production' ? 'fix: Database connection' : selectedEnvironment === 'staging' ? 'test: DB optimization' : 'dev: Database experiments',
                duration: selectedEnvironment === 'production' ? '6m 15s' : selectedEnvironment === 'staging' ? '3m 45s' : '1m 50s',
                environment: selectedEnvironment
              },
              { 
                id: '3', 
                status: selectedEnvironment === 'production' ? 'success' : selectedEnvironment.startsWith('preview-') ? 'failed' : 'success',
                version: selectedEnvironment === 'production' ? 'v1.2.1' : selectedEnvironment === 'staging' ? 'v1.2.2-staging' : 'v1.2.8-dev',
                time: selectedEnvironment === 'production' ? '2 days ago' : selectedEnvironment === 'staging' ? '4 hours ago' : '2 hours ago',
                commit: selectedEnvironment === 'production' ? 'refactor: API endpoints' : selectedEnvironment === 'staging' ? 'test: API refactoring' : 'dev: API experiments',
                duration: selectedEnvironment === 'production' ? '5m 23s' : selectedEnvironment === 'staging' ? '4m 10s' : '1m 15s',
                environment: selectedEnvironment
              },
            ].map((deployment) => (
              <div key={deployment.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {deployment.status === 'success' && (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  )}
                  {deployment.status === 'failed' && (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  {deployment.status === 'pending' && (
                    <Clock className="h-5 w-5 text-blue-600" />
                  )}
                  {deployment.status === 'rolled_back' && (
                    <RotateCcw className="h-5 w-5 text-yellow-600" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{deployment.commit}</p>
                      <Badge variant="outline" className="text-xs">
                        {deployment.version}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {environments.find(e => e.id === deployment.environment)?.name}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {deployment.duration} • {deployment.time}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant={
                      deployment.status === 'success' 
                        ? 'default' 
                        : deployment.status === 'failed'
                        ? 'destructive'
                        : deployment.status === 'pending'
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {deployment.status.replace('_', ' ')}
                  </Badge>
                  {deployment.status !== 'success' && (
                    <Button variant="ghost" size="sm">
                      {deployment.status === 'failed' ? (
                        <>
                          <PlayCircle className="h-4 w-4 mr-1" />
                          Retry
                        </>
                      ) : deployment.status === 'pending' ? (
                        <>
                          <XCircle className="h-4 w-4 mr-1" />
                          Cancel
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Rollback
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            
            <Button variant="outline" className="w-full">
              View All Deployments
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Deployment Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Deployment Actions for {environments.find(e => e.id === selectedEnvironment)?.name}
          </CardTitle>
          <CardDescription>
            Manual deployment controls and emergency actions for this environment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Button>
              <PlayCircle className="h-4 w-4 mr-2" />
              Deploy to {environments.find(e => e.id === selectedEnvironment)?.name}
            </Button>
            <Button variant="outline">
              <PauseCircle className="h-4 w-4 mr-2" />
              Pause Deployments
            </Button>
            <Button variant="outline" className="text-yellow-600 hover:text-yellow-700">
              <RotateCcw className="h-4 w-4 mr-2" />
              Rollback
            </Button>
            <Button variant="outline" className="text-red-600 hover:text-red-700">
              <XCircle className="h-4 w-4 mr-2" />
              Emergency Stop
            </Button>
          </div>

          {/* Environment-specific promotion actions */}
          {selectedEnvironment !== 'production' && (
            <div className="p-3 border border-green-200 bg-green-50 rounded-lg mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-800">
                    Promote to Next Environment
                  </p>
                  <p className="text-xs text-green-600">
                    {selectedEnvironment === 'development' ? 'Promote to Staging' : 
                     selectedEnvironment === 'staging' ? 'Promote to Production' : 
                     'Deploy to higher environment'}
                  </p>
                </div>
                <Button size="sm" className="bg-green-600 hover:bg-green-700">
                  <Zap className="h-4 w-4 mr-2" />
                  Promote
                </Button>
              </div>
            </div>
          )}

          {/* Preview environment cleanup */}
          {selectedEnvironment.startsWith('preview-') && (
            <div className="p-3 border border-purple-200 bg-purple-50 rounded-lg mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-purple-800">
                    Preview Environment Management
                  </p>
                  <p className="text-xs text-purple-600">
                    This preview environment will be automatically cleaned up when the PR is closed
                  </p>
                </div>
                <Button size="sm" variant="outline" className="text-purple-600 hover:text-purple-700 border-purple-200">
                  <XCircle className="h-4 w-4 mr-2" />
                  Cleanup Now
                </Button>
              </div>
            </div>
          )}

          <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800 mb-2">
                  Environment-Specific Safety Guidelines
                </p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  {selectedEnvironment === 'production' ? (
                    <>
                      <li>• Ensure changes have been tested in staging environment</li>
                      <li>• Schedule deployments during maintenance windows</li>
                      <li>• Use blue-green deployment for zero-downtime updates</li>
                      <li>• Have rollback plan ready before deploying</li>
                    </>
                  ) : selectedEnvironment === 'staging' ? (
                    <>
                      <li>• Test all features before promoting to production</li>
                      <li>• Validate integrations with external services</li>
                      <li>• Run full test suite before promotion</li>
                      <li>• Verify performance under load</li>
                    </>
                  ) : selectedEnvironment.startsWith('preview-') ? (
                    <>
                      <li>• Preview environments are temporary and resource-limited</li>
                      <li>• Test core functionality and visual changes</li>
                      <li>• Share preview URL with stakeholders for feedback</li>
                      <li>• Environment will auto-cleanup when PR is closed</li>
                    </>
                  ) : (
                    <>
                      <li>• Development environment is for rapid iteration</li>
                      <li>• Test new features and breaking changes</li>
                      <li>• Debug and troubleshoot issues</li>
                      <li>• Validate before moving to staging</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}