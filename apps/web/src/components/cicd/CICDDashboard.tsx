'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Switch } from '@repo/ui/components/shadcn/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { 
  Plus, 
  Play, 
  Square, 
  Eye, 
  Edit, 
  Trash2, 
  Copy, 
  RefreshCw,
  Settings,
  GitBranch,
  Clock,
  CheckCircle,
  XCircle,
  Webhook
} from 'lucide-react'
import { 
  usePipelines, 
  usePipelineRuns,
  useWebhooks,
  useCICDActions
} from '@/hooks/useCICD'
import type { PipelineConfig, Build, WebhookConfig } from '@repo/api-contracts'

interface CICDDashboardProps {
  projectId: string
}

export function CICDDashboard({ projectId }: CICDDashboardProps) {
  const [activeTab, setActiveTab] = useState('pipelines')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">CI/CD Dashboard</h1>
          <p className="text-muted-foreground">
            Manage pipelines, builds, deployments, and automation
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pipelines" className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Pipelines
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex items-center gap-2">
            <Play className="h-4 w-4" />
            Pipeline Runs
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipelines" className="space-y-6">
          <PipelinesTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="runs" className="space-y-6">
          <PipelineRunsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-6">
          <WebhooksTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <SettingsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PipelinesTab({ projectId }: { projectId: string }) {
  const { data: pipelines, isLoading, error } = usePipelines()
  const actions = useCICDActions()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingPipeline, setEditingPipeline] = useState<PipelineConfig | null>(null)

  const [newPipeline, setNewPipeline] = useState({
    name: '',
    description: '',
    projectId,
    branch: 'main',
    triggers: {
      webhook: true,
      manual: true,
      schedule: undefined as string | undefined,
    },
    stages: [{
      name: 'build',
      script: 'echo "Build stage"',
      timeout: 300,
      retryCount: 0,
      continueOnError: false,
    }],
    environment: {} as Record<string, string>,
    isActive: true,
  })

  const handleCreatePipeline = () => {
    actions.createPipeline(newPipeline)
    setNewPipeline({
      name: '',
      description: '',
      projectId,
      branch: 'main',
      triggers: {
        webhook: true,
        manual: true,
        schedule: undefined,
      },
      stages: [{
        name: 'build',
        script: 'echo "Build stage"',
        timeout: 300,
        retryCount: 0,
        continueOnError: false,
      }],
      environment: {},
      isActive: true,
    })
    setIsCreateDialogOpen(false)
  }

  const handleUpdatePipeline = () => {
    if (editingPipeline) {
      actions.updatePipeline({
        id: editingPipeline.id,
        data: {
          name: editingPipeline.name,
          description: editingPipeline.description,
          branch: editingPipeline.branch,
          triggers: editingPipeline.triggers,
          stages: editingPipeline.stages,
          environment: editingPipeline.environment,
          isActive: editingPipeline.isActive,
        },
      })
      setEditingPipeline(null)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-destructive">Failed to load pipelines</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">CI/CD Pipelines</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Pipeline
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create CI/CD Pipeline</DialogTitle>
              <DialogDescription>
                Set up a new automated build and deployment pipeline
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Pipeline Name</Label>
                  <Input
                    id="name"
                    value={newPipeline.name}
                    onChange={(e) => setNewPipeline({ ...newPipeline, name: e.target.value })}
                    placeholder="Frontend Build & Deploy"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch">Branch</Label>
                  <Input
                    id="branch"
                    value={newPipeline.branch}
                    onChange={(e) => setNewPipeline({ ...newPipeline, branch: e.target.value })}
                    placeholder="main"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newPipeline.description}
                  onChange={(e) => setNewPipeline({ ...newPipeline, description: e.target.value })}
                  placeholder="Build and deploy the application"
                />
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Triggers</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={newPipeline.triggers.webhook}
                        onCheckedChange={(checked) => 
                          setNewPipeline({ 
                            ...newPipeline, 
                            triggers: { ...newPipeline.triggers, webhook: checked }
                          })
                        }
                      />
                      <Label>Webhook</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={newPipeline.triggers.manual}
                        onCheckedChange={(checked) => 
                          setNewPipeline({ 
                            ...newPipeline, 
                            triggers: { ...newPipeline.triggers, manual: checked }
                          })
                        }
                      />
                      <Label>Manual</Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Stages</Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={newPipeline.stages[0]?.name || ''}
                        onChange={(e) => {
                          const updatedStages = [...newPipeline.stages]
                          updatedStages[0] = { ...updatedStages[0], name: e.target.value }
                          setNewPipeline({ ...newPipeline, stages: updatedStages })
                        }}
                        placeholder="Stage name"
                      />
                      <Input
                        value={newPipeline.stages[0]?.script || ''}
                        onChange={(e) => {
                          const updatedStages = [...newPipeline.stages]
                          updatedStages[0] = { ...updatedStages[0], script: e.target.value }
                          setNewPipeline({ ...newPipeline, stages: updatedStages })
                        }}
                        placeholder="Script command"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="isActive"
                  checked={newPipeline.isActive}
                  onCheckedChange={(checked) => setNewPipeline({ ...newPipeline, isActive: checked })}
                />
                <Label htmlFor="isActive">Active Pipeline</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreatePipeline} disabled={actions.isLoading.createPipeline}>
                  {actions.isLoading.createPipeline ? (
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {pipelines?.pipelines?.map((pipeline: PipelineConfig) => (
          <Card key={pipeline.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{pipeline.name}</h3>
                    <Badge variant={pipeline.isActive ? 'default' : 'secondary'}>
                      {pipeline.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{pipeline.description}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {pipeline.branch}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Triggers: {Object.entries(pipeline.triggers).filter(([, value]) => value === true || value).map(([key]) => key).join(', ')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => actions.triggerPipeline({ id: pipeline.id })}
                    disabled={actions.isLoading.triggerPipeline}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingPipeline(pipeline)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => actions.deletePipeline({ id: pipeline.id })}
                    disabled={actions.isLoading.deletePipeline}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Pipeline Dialog */}
      <Dialog open={!!editingPipeline} onOpenChange={() => setEditingPipeline(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Pipeline</DialogTitle>
            <DialogDescription>
              Update pipeline configuration
            </DialogDescription>
          </DialogHeader>
          {editingPipeline && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Pipeline Name</Label>
                  <Input
                    id="edit-name"
                    value={editingPipeline.name}
                    onChange={(e) => setEditingPipeline({ ...editingPipeline, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-branch">Branch</Label>
                  <Input
                    id="edit-branch"
                    value={editingPipeline.branch}
                    onChange={(e) => setEditingPipeline({ ...editingPipeline, branch: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editingPipeline.description || ''}
                  onChange={(e) => setEditingPipeline({ ...editingPipeline, description: e.target.value })}
                />
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Triggers</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={editingPipeline.triggers.webhook}
                        onCheckedChange={(checked) => 
                          setEditingPipeline({ 
                            ...editingPipeline, 
                            triggers: { ...editingPipeline.triggers, webhook: checked }
                          })
                        }
                      />
                      <Label>Webhook</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={editingPipeline.triggers.manual}
                        onCheckedChange={(checked) => 
                          setEditingPipeline({ 
                            ...editingPipeline, 
                            triggers: { ...editingPipeline.triggers, manual: checked }
                          })
                        }
                      />
                      <Label>Manual</Label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-isActive"
                  checked={editingPipeline.isActive}
                  onCheckedChange={(checked) => setEditingPipeline({ ...editingPipeline, isActive: checked })}
                />
                <Label htmlFor="edit-isActive">Active Pipeline</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setEditingPipeline(null)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdatePipeline} disabled={actions.isLoading.updatePipeline}>
                  {actions.isLoading.updatePipeline ? (
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Edit className="h-4 w-4 mr-2" />
                  )}
                  Update
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PipelineRunsTab({ projectId }: { projectId: string }) {
  const { data: runs, isLoading } = usePipelineRuns({ limit: 50 })
  const [selectedRun, setSelectedRun] = useState<Build | null>(null)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'running':
        return <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
      case 'cancelled':
        return <Square className="h-4 w-4 text-orange-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'default'
      case 'failed':
        return 'destructive'
      case 'running':
        return 'secondary'
      case 'cancelled':
        return 'outline'
      default:
        return 'outline'
    }
  }

  // Suppress projectId unused warning - keeping for future use
  void projectId

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Pipeline Runs</h2>
        <Button variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {runs?.builds?.map((run: Build) => (
          <Card key={run.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(run.status)}
                    <h3 className="font-medium">Build #{run.number}</h3>
                    <Badge variant={getStatusColor(run.status) as 'default' | 'destructive' | 'secondary' | 'outline'}>
                      {run.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Commit: {run.commitSha.substring(0, 8)}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {run.branch}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {run.duration ? `${Math.round(run.duration / 1000)}s` : 'Running...'}
                    </span>
                    <span>{new Date(run.triggeredAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedRun(run)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {run.status === 'running' && (
                    <Button
                      variant="outline"
                      size="sm"
                      // onClick={() => actions.stopPipelineRun(run.id)}
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Run Details Dialog */}
      <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedRun && getStatusIcon(selectedRun.status)}
              Pipeline Run #{selectedRun?.number}
            </DialogTitle>
            <DialogDescription>
              Pipeline Run #{selectedRun?.number} - {selectedRun?.branch}
            </DialogDescription>
          </DialogHeader>
          {selectedRun && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Badge variant={getStatusColor(selectedRun.status) as 'default' | 'destructive' | 'secondary' | 'outline'}>
                    {selectedRun.status}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <p className="text-sm">{selectedRun.duration ? `${selectedRun.duration}s` : 'Still running'}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Logs</Label>
                <div className="bg-black text-green-400 p-4 rounded-md h-96 overflow-y-auto font-mono text-xs">
                  <pre>{selectedRun.logs || 'No logs available'}</pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WebhooksTab({ projectId }: { projectId: string }) {
  const { data: webhooks, isLoading } = useWebhooks()
  const actions = useCICDActions()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const [newWebhook, setNewWebhook] = useState({
    name: '',
    url: '',
    events: ['pipeline.started', 'pipeline.completed'] as Array<'pipeline.started' | 'pipeline.completed' | 'pipeline.failed' | 'build.started' | 'build.completed' | 'build.failed' | 'deployment.started' | 'deployment.completed' | 'deployment.failed' | 'deployment.rolled-back'>,
    secret: '',
    isActive: true,
  })

  const handleCreateWebhook = () => {
    actions.createWebhook(newWebhook)
    setNewWebhook({
      name: '',
      url: '',
      events: ['pipeline.started', 'pipeline.completed'],
      secret: '',
      isActive: true,
    })
    setIsCreateDialogOpen(false)
  }

  // Suppress projectId unused warning - keeping for future use
  void projectId

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Webhooks</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Webhook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Webhook</DialogTitle>
              <DialogDescription>
                Add a webhook to receive pipeline events
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Webhook Name</Label>
                <Input
                  id="name"
                  value={newWebhook.name}
                  onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
                  placeholder="Build Notifications"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">Webhook URL</Label>
                <Input
                  id="url"
                  value={newWebhook.url}
                  onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                  placeholder="https://example.com/webhook"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secret">Secret (Optional)</Label>
                <Input
                  id="secret"
                  type="password"
                  value={newWebhook.secret}
                  onChange={(e) => setNewWebhook({ ...newWebhook, secret: e.target.value })}
                  placeholder="webhook_secret_key"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="isActive"
                  checked={newWebhook.isActive}
                  onCheckedChange={(checked) => setNewWebhook({ ...newWebhook, isActive: checked })}
                />
                <Label htmlFor="isActive">Active Webhook</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateWebhook} disabled={actions.isLoading.createWebhook}>
                  {actions.isLoading.createWebhook ? (
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {webhooks?.webhooks?.map((webhook: WebhookConfig) => (
          <Card key={webhook.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4" />
                    <h3 className="font-medium">{webhook.name}</h3>
                    <Badge variant={webhook.isActive ? 'default' : 'secondary'}>
                      {webhook.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{webhook.url}</p>
                  <p className="text-sm text-muted-foreground">
                    Events: {webhook.events.join(', ')}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(webhook.url)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => actions.deleteWebhook({ id: webhook.id })}
                    disabled={actions.isLoading.deleteWebhook}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function SettingsTab({ projectId }: { projectId: string }) {
  // Suppress projectId unused warning - keeping for future use
  void projectId
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">CI/CD Settings</h2>
      
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>
            Configure general CI/CD pipeline settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-retry failed builds</Label>
              <p className="text-sm text-muted-foreground">
                Automatically retry failed pipeline runs
              </p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Parallel builds</Label>
              <p className="text-sm text-muted-foreground">
                Allow multiple builds to run in parallel
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Build notifications</Label>
              <p className="text-sm text-muted-foreground">
                Send notifications when builds complete
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security Settings</CardTitle>
          <CardDescription>
            Manage security and access controls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Allowed branches</Label>
            <Input placeholder="main, develop, feature/*" />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of branches that can trigger builds
            </p>
          </div>
          <div className="space-y-2">
            <Label>Secret management</Label>
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              Manage Secrets
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}