'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@repo/ui/components/shadcn/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import {
  Plus,
  Globe,
  Settings,
  Trash2,
  Copy,
  ExternalLink,
  MoreHorizontal,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  Activity,
  GitBranch,
  Calendar,
} from 'lucide-react'
import { cn } from '@repo/ui/lib/utils'
import { CreatePreviewEnvironmentDialog } from '@/components/environment/CreatePreviewEnvironmentDialog'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabsConfigurationEnvironments } from '@/routes'

// Mock data - replace with actual API calls
const mockEnvironments = [
  {
    id: '1',
    name: 'Production',
    type: 'production' as const,
    url: 'https://myapp.com',
    branch: 'main',
    isActive: true,
    autoDeloy: false,
    status: 'healthy' as const,
    deploymentCount: 47,
    lastDeployment: {
      id: 'dep-1',
      status: 'success' as const,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 5 * 60 * 1000), // completed 5 minutes later
    },
    variables: [
      { key: 'DATABASE_URL', value: 'postgres://...', isSecret: true },
      { key: 'API_KEY', value: 'pk_live_...', isSecret: true },
    ],
    services: [
      { id: 's1', name: 'api', status: 'running' as const, url: 'https://api.myapp.com' },
      { id: 's2', name: 'web', status: 'running' as const, url: 'https://myapp.com' },
    ],
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
  },
  {
    id: '2',
    name: 'Staging',
    type: 'staging' as const,
    url: 'https://staging.myapp.com',
    branch: 'develop',
    isActive: true,
    autoDeloy: true,
    status: 'healthy' as const,
    deploymentCount: 123,
    lastDeployment: {
      id: 'dep-2',
      status: 'success' as const,
      createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      completedAt: new Date(Date.now() - 25 * 60 * 1000), // completed 5 minutes later
    },
    variables: [
      { key: 'DATABASE_URL', value: 'postgres://staging...', isSecret: true },
      { key: 'API_KEY', value: 'pk_test_...', isSecret: true },
    ],
    services: [
      { id: 's3', name: 'api', status: 'running' as const, url: 'https://api.staging.myapp.com' },
      { id: 's4', name: 'web', status: 'running' as const, url: 'https://staging.myapp.com' },
    ],
    createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
  },
  {
    id: '3',
    name: 'Feature: Auth Redesign',
    type: 'preview' as const,
    url: 'https://auth-redesign.preview.myapp.com',
    branch: 'feature/auth-redesign',
    isActive: true,
    autoDeloy: true,
    status: 'deploying' as const,
    deploymentCount: 8,
    lastDeployment: {
      id: 'dep-3',
      status: 'building' as const,
      createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      completedAt: undefined,
    },
    variables: [
      { key: 'DATABASE_URL', value: 'postgres://preview...', isSecret: true },
      { key: 'FEATURE_AUTH_V2', value: 'true', isSecret: false },
    ],
    services: [
      { id: 's5', name: 'api', status: 'deploying' as const },
      { id: 's6', name: 'web', status: 'deploying' as const },
    ],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  },
]

type Environment = typeof mockEnvironments[0]
type EnvironmentType = 'production' | 'staging' | 'preview'

const environmentTypeConfig = {
  production: {
    label: 'Production',
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: Globe,
    description: 'Live production environment',
  },
  staging: {
    label: 'Staging',
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: Activity,
    description: 'Pre-production testing environment',
  },
  preview: {
    label: 'Preview',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: GitBranch,
    description: 'Dynamic preview environment',
  },
}

const statusConfig = {
  healthy: { label: 'Healthy', color: 'text-green-600', icon: CheckCircle },
  unhealthy: { label: 'Unhealthy', color: 'text-red-600', icon: XCircle },
  deploying: { label: 'Deploying', color: 'text-blue-600', icon: Clock },
  failed: { label: 'Failed', color: 'text-red-600', icon: AlertCircle },
  unknown: { label: 'Unknown', color: 'text-gray-600', icon: AlertCircle },
}

function CreateEnvironmentDialog({ projectId: _projectId }: { projectId: string }) {
  // TODO: Use projectId for API calls
  const [isOpen, setIsOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    type: 'staging' as EnvironmentType,
    url: '',
    branch: '',
    autoDeloy: false,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Implement API call to create environment
    console.log('Creating environment:', formData)
    setIsOpen(false)
    // Reset form
    setFormData({
      name: '',
      type: 'staging',
      url: '',
      branch: '',
      autoDeloy: false,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Environment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Environment</DialogTitle>
          <DialogDescription>
            Create a new deployment environment for your project.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Environment Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Production, Staging, Feature Branch"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Environment Type</Label>
            <Select
              value={formData.type}
              onValueChange={(value: EnvironmentType) => setFormData({ ...formData, type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(environmentTypeConfig).map(([key, config]) => {
                  const Icon = config.icon
                  return (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{config.label}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {environmentTypeConfig[formData.type].description}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL (Optional)</Label>
            <Input
              id="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://example.com"
              type="url"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch">Git Branch (Optional)</Label>
            <Input
              id="branch"
              value={formData.branch}
              onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
              placeholder="main, develop, feature/..."
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="autoDeloy"
              checked={formData.autoDeloy}
              onCheckedChange={(checked) => setFormData({ ...formData, autoDeloy: checked })}
            />
            <Label htmlFor="autoDeloy">Enable Auto-deployment</Label>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Environment</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EnvironmentCard({ environment }: { environment: Environment }) {
  const typeConfig = environmentTypeConfig[environment.type]
  const statusData = statusConfig[environment.status]
  const TypeIcon = typeConfig.icon
  const StatusIcon = statusData.icon

  const formatTimeAgo = (date: Date) => {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) {
      return `${diffDays}d ago`
    } else if (diffHours > 0) {
      return `${diffHours}h ago`
    } else {
      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      return `${diffMinutes}m ago`
    }
  }

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={cn('p-2 rounded-lg border', typeConfig.color)}>
              <TypeIcon className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">{environment.name}</h3>
                {environment.url && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <StatusIcon className={cn('h-3 w-3', statusData.color)} />
                <span>{statusData.label}</span>
                {environment.branch && (
                  <>
                    <span>•</span>
                    <GitBranch className="h-3 w-3" />
                    <span>{environment.branch}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {environment.autoDeloy && (
              <Badge variant="secondary" className="text-xs px-2">
                Auto-deploy
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Settings className="h-4 w-4 mr-2" />
                  Configure
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy className="h-4 w-4 mr-2" />
                  Clone Environment
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Environment
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Environment</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete the &quot;{environment.name}&quot; environment? 
                        This will stop all deployments and cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete Environment
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {/* Deployment Info */}
          {environment.lastDeployment && (
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Last deployed:</span>
                <span>{formatTimeAgo(environment.lastDeployment.createdAt)}</span>
              </div>
              <div className="text-muted-foreground">
                {environment.deploymentCount} deployments
              </div>
            </div>
          )}

          {/* Services Status */}
          {environment.services.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Services</div>
              <div className="flex flex-wrap gap-2">
                {environment.services.map((service) => {
                  const serviceStatusColor = service.status === 'running' 
                    ? 'bg-green-100 text-green-800' 
                    : service.status === 'deploying' 
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-800'
                  
                  return (
                    <Badge key={service.id} variant="outline" className={cn('text-xs', serviceStatusColor)}>
                      {service.name}: {service.status}
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}

          {/* Variables Count */}
          <div className="text-xs text-muted-foreground">
            {environment.variables.length} environment variables configured
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function EnvironmentsPage() {
  const params = useParams(DashboardProjectsProjectIdTabsConfigurationEnvironments)
  const [environments] = useState<Environment[]>(mockEnvironments)
  const [filter, setFilter] = useState<'all' | EnvironmentType>('all')

  const filteredEnvironments = environments.filter(env => 
    filter === 'all' || env.type === filter
  )

  const environmentStats = {
    total: environments.length,
    production: environments.filter(e => e.type === 'production').length,
    staging: environments.filter(e => e.type === 'staging').length,
    preview: environments.filter(e => e.type === 'preview').length,
    healthy: environments.filter(e => e.status === 'healthy').length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Environments</h2>
          <p className="text-sm text-muted-foreground">
            Manage your deployment environments and their configurations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreatePreviewEnvironmentDialog projectId={params.projectId} />
          <CreateEnvironmentDialog projectId={params.projectId} />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Environments</p>
                <p className="text-2xl font-bold">{environmentStats.total}</p>
              </div>
              <Globe className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Healthy</p>
                <p className="text-2xl font-bold text-green-600">{environmentStats.healthy}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Production</p>
                <p className="text-2xl font-bold text-red-600">{environmentStats.production}</p>
              </div>
              <Globe className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Preview</p>
                <p className="text-2xl font-bold text-blue-600">{environmentStats.preview}</p>
              </div>
              <GitBranch className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All ({environmentStats.total})
        </Button>
        <Button
          variant={filter === 'production' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('production')}
        >
          Production ({environmentStats.production})
        </Button>
        <Button
          variant={filter === 'staging' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('staging')}
        >
          Staging ({environmentStats.staging})
        </Button>
        <Button
          variant={filter === 'preview' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('preview')}
        >
          Preview ({environmentStats.preview})
        </Button>
      </div>

      {/* Environment Grid */}
      {filteredEnvironments.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <Globe className="h-12 w-12 text-muted-foreground mx-auto" />
              <h3 className="text-lg font-medium">No environments found</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {filter === 'all' 
                  ? 'Get started by creating your first environment.'
                  : `No ${filter} environments found. Try a different filter or create a new environment.`
                }
              </p>
              <CreateEnvironmentDialog projectId={params.projectId} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredEnvironments.map((environment) => (
            <EnvironmentCard key={environment.id} environment={environment} />
          ))}
        </div>
      )}
    </div>
  )
}