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
  Box,
  Wrench,
  Terminal,
  FileCode,
  Clock,
  Zap,
  AlertCircle,
  CheckCircle
} from 'lucide-react'

interface BuildConfigurationClientProps {
  params: {
    id: string
    serviceId: string
  }
}

export function BuildConfigurationClient({ params }: BuildConfigurationClientProps) {
  const { data: service } = useService(params.serviceId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [autoBuildEnabled, setAutoBuildEnabled] = useState(true)
  const [cacheEnabled, setCacheEnabled] = useState(true)
  const [buildOptimization, setBuildOptimization] = useState(true)

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
        <p className="text-muted-foreground">Loading build configuration...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Build Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Box className="h-5 w-5" />
            Build Configuration
          </CardTitle>
          <CardDescription>
            Configure how your service is built and deployed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Build Tool</Label>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-sm">
                  {getBuilderLabel(service.builder)}
                </Badge>
                <Button variant="ghost" size="sm">
                  Change
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The build system used for this service
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="node-version">Runtime Version</Label>
              <Select defaultValue="18">
                <SelectTrigger>
                  <SelectValue placeholder="Select runtime version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16">Node.js 16</SelectItem>
                  <SelectItem value="18">Node.js 18</SelectItem>
                  <SelectItem value="20">Node.js 20</SelectItem>
                  <SelectItem value="21">Node.js 21</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="root-directory">Root Directory</Label>
            <Input 
              id="root-directory" 
              value="." 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="e.g., ., ./api, ./services/backend"
            />
            <p className="text-xs text-muted-foreground">
              The directory containing your application code
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-build">Automatic Builds</Label>
              <p className="text-sm text-muted-foreground">
                Automatically build when code changes are pushed
              </p>
            </div>
            <Switch 
              id="auto-build"
              checked={autoBuildEnabled}
              onCheckedChange={setAutoBuildEnabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Build Commands */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Build Commands
          </CardTitle>
          <CardDescription>
            Specify the commands to build and start your service
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="install-command">Install Command</Label>
            <Input 
              id="install-command" 
              value="npm install" 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="e.g., npm install, yarn install, bun install"
            />
            <p className="text-xs text-muted-foreground">
              Command to install dependencies
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="build-command">Build Command</Label>
            <Input 
              id="build-command" 
              value="npm run build" 
              onChange={() => setHasUnsavedChanges(true)}
              placeholder="e.g., npm run build, yarn build, make build"
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
              placeholder="e.g., npm start, node server.js, ./app"
            />
            <p className="text-xs text-muted-foreground">
              Command to start your application
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="prebuild-command">Pre-build Command</Label>
            <Textarea 
              id="prebuild-command" 
              placeholder="Optional commands to run before the build..."
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Commands to run before the build process (optional)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Docker Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            Docker Configuration
          </CardTitle>
          <CardDescription>
            Docker-specific build settings and configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dockerfile-path">Dockerfile Path</Label>
              <Input 
                id="dockerfile-path" 
                value="Dockerfile" 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., Dockerfile, docker/Dockerfile.prod"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="build-context">Build Context</Label>
              <Input 
                id="build-context" 
                value="." 
                onChange={() => setHasUnsavedChanges(true)}
                placeholder="e.g., ., ./api, ./services/backend"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="docker-args">Build Arguments</Label>
            <Textarea 
              id="docker-args" 
              placeholder="NODE_ENV=production&#10;API_VERSION=v1.0.0"
              onChange={() => setHasUnsavedChanges(true)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Docker build arguments (one per line, KEY=value format)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base-image">Base Image</Label>
            <Select defaultValue="node:18-alpine">
              <SelectTrigger>
                <SelectValue placeholder="Select base image" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="node:16-alpine">node:16-alpine</SelectItem>
                <SelectItem value="node:18-alpine">node:18-alpine</SelectItem>
                <SelectItem value="node:20-alpine">node:20-alpine</SelectItem>
                <SelectItem value="node:21-alpine">node:21-alpine</SelectItem>
                <SelectItem value="ubuntu:22.04">ubuntu:22.04</SelectItem>
                <SelectItem value="debian:12">debian:12</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Build Optimization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Build Optimization
          </CardTitle>
          <CardDescription>
            Performance and caching settings for faster builds
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="cache-enabled">Build Cache</Label>
              <p className="text-sm text-muted-foreground">
                Cache build artifacts to speed up subsequent builds
              </p>
            </div>
            <Switch 
              id="cache-enabled"
              checked={cacheEnabled}
              onCheckedChange={setCacheEnabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="build-optimization">Build Optimization</Label>
              <p className="text-sm text-muted-foreground">
                Enable production optimizations and minification
              </p>
            </div>
            <Switch 
              id="build-optimization"
              checked={buildOptimization}
              onCheckedChange={setBuildOptimization}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="build-timeout">Build Timeout (minutes)</Label>
              <Input 
                id="build-timeout" 
                type="number" 
                value="30" 
                onChange={() => setHasUnsavedChanges(true)}
                min="5"
                max="120"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-memory">Max Memory (MB)</Label>
              <Input 
                id="max-memory" 
                type="number" 
                value="2048" 
                onChange={() => setHasUnsavedChanges(true)}
                min="512"
                max="8192"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Build History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Builds
          </CardTitle>
          <CardDescription>
            History of recent build attempts and their status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Mock build history */}
            {[
              { id: '1', status: 'success', duration: '2m 34s', time: '2 hours ago', commit: 'feat: Add user auth' },
              { id: '2', status: 'success', duration: '1m 42s', time: '1 day ago', commit: 'fix: Database connection' },
              { id: '3', status: 'failed', duration: '45s', time: '2 days ago', commit: 'refactor: API endpoints' },
            ].map((build) => (
              <div key={build.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  {build.status === 'success' ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <div>
                    <p className="font-medium text-sm">{build.commit}</p>
                    <p className="text-xs text-muted-foreground">
                      {build.duration} • {build.time}
                    </p>
                  </div>
                </div>
                <Badge variant={build.status === 'success' ? 'default' : 'destructive'}>
                  {build.status}
                </Badge>
              </div>
            ))}
            
            <Button variant="outline" className="w-full">
              View All Builds
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Build Warnings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Build Configuration Tips
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-2">
                <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-800 mb-2">
                    Build Performance Tips
                  </p>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Enable build caching for faster subsequent builds</li>
                    <li>• Use multi-stage Dockerfiles to reduce final image size</li>
                    <li>• Exclude unnecessary files with .dockerignore</li>
                    <li>• Consider using alpine-based images for smaller builds</li>
                  </ul>
                </div>
              </div>
            </div>

            {service.builder === 'dockerfile' && (
              <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800 mb-2">
                      Dockerfile Detected
                    </p>
                    <p className="text-sm text-yellow-700">
                      Make sure your Dockerfile is optimized for production and includes proper health checks.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}