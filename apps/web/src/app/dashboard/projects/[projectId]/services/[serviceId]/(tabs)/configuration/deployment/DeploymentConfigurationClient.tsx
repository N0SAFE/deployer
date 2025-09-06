'use client'

import { useState } from 'react'
import { useService } from '@/hooks/useServices'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { 
  Rocket,
  Github,
  PlayCircle,
  Settings,
  Clock,
  CheckCircle,
  FileText,
  GitBranch,
  Zap
} from 'lucide-react'

interface DeploymentConfigurationClientProps {
    projectId: string
    serviceId: string
  
}

export function DeploymentConfigurationClient({ projectId, serviceId }: DeploymentConfigurationClientProps) {
  const { data: service } = useService(serviceId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [autoDeployEnabled, setAutoDeployEnabled] = useState(true)
  const [buildCacheEnabled, setBuildCacheEnabled] = useState(true)
  const [previewDeploysEnabled, setPreviewDeploysEnabled] = useState(false)

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading deployment configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Repository Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Repository Configuration
          </CardTitle>
          <CardDescription>
            Configure repository settings and deployment source
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input 
              id="repo-url" 
              value="https://github.com/user/my-app"
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="https://github.com/username/repository"
            />
            <p className="text-xs text-muted-foreground">
              Git repository URL to deploy from
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="branch">Deploy Branch</Label>
              <Select defaultValue="main">
                <SelectTrigger>
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">main</SelectItem>
                  <SelectItem value="master">master</SelectItem>
                  <SelectItem value="develop">develop</SelectItem>
                  <SelectItem value="production">production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="root-dir">Root Directory</Label>
              <Input 
                id="root-dir" 
                value="./"
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="./ or path/to/app"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-deploy">Auto Deploy</Label>
              <p className="text-sm text-muted-foreground">
                Automatically deploy when changes are pushed to the branch
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

      {/* Build Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Build Configuration
          </CardTitle>
          <CardDescription>
            Configure how your application is built and deployed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="build-command">Build Command</Label>
            <Input 
              id="build-command" 
              value="npm run build"
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="npm run build, yarn build, etc."
            />
            <p className="text-xs text-muted-foreground">
              Command to build your application
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="start-command">Start Command</Label>
            <Input 
              id="start-command" 
              value="npm start"
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="npm start, node server.js, etc."
            />
            <p className="text-xs text-muted-foreground">
              Command to start your application
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-directory">Publish Directory</Label>
            <Input 
              id="publish-directory" 
              value="dist"
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="dist, build, public, etc."
            />
            <p className="text-xs text-muted-foreground">
              Directory containing the built application
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="build-cache">Enable Build Cache</Label>
              <p className="text-sm text-muted-foreground">
                Cache dependencies and build artifacts to speed up deployments
              </p>
            </div>
            <Switch 
              id="build-cache"
              checked={buildCacheEnabled}
              onCheckedChange={setBuildCacheEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Environment Variables */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Build Environment Variables
          </CardTitle>
          <CardDescription>
            Environment variables available during the build process
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="build-env">Build Environment Variables</Label>
            <Textarea 
              id="build-env"
              value={`NODE_ENV=production
API_URL=https://api.example.com
CDN_URL=https://cdn.example.com`}
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="KEY=value (one per line)"
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              One variable per line in KEY=value format
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Deploy Hooks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Deploy Hooks
          </CardTitle>
          <CardDescription>
            Custom scripts to run during deployment lifecycle
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pre-build">Pre-build Hook</Label>
            <Textarea 
              id="pre-build"
              value=""
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="Commands to run before building (e.g., npm install, setup scripts)"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-build">Post-build Hook</Label>
            <Textarea 
              id="post-build"
              value=""
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="Commands to run after building (e.g., cleanup, notifications)"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pre-deploy">Pre-deploy Hook</Label>
            <Textarea 
              id="pre-deploy"
              value=""
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="Commands to run before deployment"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview Deployments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Preview Deployments
          </CardTitle>
          <CardDescription>
            Configure preview deployments for pull requests and branches
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="preview-deploys">Enable Preview Deployments</Label>
              <p className="text-sm text-muted-foreground">
                Create temporary deployments for pull requests and feature branches
              </p>
            </div>
            <Switch 
              id="preview-deploys"
              checked={previewDeploysEnabled}
              onCheckedChange={setPreviewDeploysEnabled}
            />
          </div>

          {previewDeploysEnabled && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="space-y-2">
                <Label htmlFor="preview-branches">Preview Branches</Label>
                <Input 
                  id="preview-branches" 
                  value="develop, feature/*, hotfix/*"
                  onChange={() => setHasUnsavedChanges(true)}
                  placeholder="develop, feature/*, release/*"
                />
                <p className="text-xs text-muted-foreground">
                  Branch patterns that trigger preview deployments
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="preview-retention">Preview Retention Period</Label>
                <Select defaultValue="7d">
                  <SelectTrigger>
                    <SelectValue placeholder="Select retention period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1d">1 day</SelectItem>
                    <SelectItem value="3d">3 days</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="14d">14 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deployment Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Current Deployment Status
          </CardTitle>
          <CardDescription>
            Overview of the current deployment configuration and recent activity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">Auto Deploy</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {autoDeployEnabled ? 'Enabled for main branch' : 'Disabled'}
                </p>
              </div>

              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">Last Deploy</span>
                </div>
                <p className="text-xs text-muted-foreground">2 hours ago</p>
              </div>

              <div className="p-3 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Rocket className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-medium">Build Time</span>
                </div>
                <p className="text-xs text-muted-foreground">Average: 2m 15s</p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="bg-green-100 text-green-800">
                    <PlayCircle className="h-3 w-3 mr-1" />
                    Live
                  </Badge>
                  <span className="text-sm font-medium">main branch</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  commit abc123f • 2 hours ago
                </span>
              </div>
              <Button variant="outline" size="sm">
                <Rocket className="h-4 w-4 mr-2" />
                Trigger Deploy
              </Button>
            </div>

            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <Settings className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    Deployment Configuration Tips
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Enable build cache to speed up deployments</li>
                    <li>• Use preview deployments for testing changes</li>
                    <li>• Set up proper environment variables for production</li>
                    <li>• Configure deploy hooks for custom deployment logic</li>
                    <li>• Monitor build times and optimize as needed</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}