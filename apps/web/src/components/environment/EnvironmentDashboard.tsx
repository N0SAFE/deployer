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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
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
  Eye, 
  Edit, 
  Trash2, 
  Copy, 
  RefreshCw,
  Variable,
  Globe,
  Code,
  Layers
} from 'lucide-react'
import { 
  useEnvironmentVariables,
  usePreviewEnvironments,
  useEnvironmentActions,
  useResolveTemplate
} from '@/hooks/useEnvironment'

interface EnvironmentDashboardProps {
  projectId: string
}

export function EnvironmentDashboard({ projectId }: EnvironmentDashboardProps) {
  const [activeTab, setActiveTab] = useState('variables')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Environment Management</h1>
          <p className="text-muted-foreground">
            Manage environment variables, preview environments, and templates
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="variables" className="flex items-center gap-2">
            <Variable className="h-4 w-4" />
            Variables
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Preview Environments
          </TabsTrigger>
          <TabsTrigger value="templates" className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="resolver" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Template Resolver
          </TabsTrigger>
        </TabsList>

        <TabsContent value="variables" className="space-y-6">
          <EnvironmentVariablesTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="preview" className="space-y-6">
          <PreviewEnvironmentsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="templates" className="space-y-6">
          <EnvironmentTemplatesTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="resolver" className="space-y-6">
          <TemplateResolverTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EnvironmentVariablesTab({ projectId: _ }: { projectId: string }) {
  // For now, using a default environment ID until we implement proper environment selection
  const { data: variables, isLoading, error } = useEnvironmentVariables('production')
  const actions = useEnvironmentActions()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingVariable, setEditingVariable] = useState<{
    id: string
    key: string
    value: string
    description?: string
    isSecret: boolean
    environmentId: string
  } | null>(null)

  const [newVariable, setNewVariable] = useState({
    key: '',
    value: '',
    description: '',
    isSecret: false,
    environment: 'production' as 'production' | 'staging' | 'development',
  })

  const handleCreateVariable = () => {
    // Use updateVariables to add new variables
    actions.updateVariables({
      environmentId: 'production', // Should be dynamic based on selected environment
      variables: [newVariable]
    })
    setNewVariable({
      key: '',
      value: '',
      description: '',
      isSecret: false,
      environment: 'production',
    })
    setIsCreateDialogOpen(false)
  }

  const handleUpdateVariable = () => {
    if (editingVariable) {
      // Use updateVariables to update existing variables
      actions.updateVariables({
        environmentId: editingVariable.environmentId,
        variables: [{
          key: editingVariable.key,
          value: editingVariable.value,
          description: editingVariable.description,
          isSecret: editingVariable.isSecret,
        }]
      })
      setEditingVariable(null)
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
          <p className="text-destructive">Failed to load environment variables</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Environment Variables</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Variable
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Environment Variable</DialogTitle>
              <DialogDescription>
                Add a new environment variable to your project
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="key">Variable Key</Label>
                <Input
                  id="key"
                  value={newVariable.key}
                  onChange={(e) => setNewVariable({ ...newVariable, key: e.target.value })}
                  placeholder="DATABASE_URL"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="value">Variable Value</Label>
                <Input
                  id="value"
                  type={newVariable.isSecret ? 'password' : 'text'}
                  value={newVariable.value}
                  onChange={(e) => setNewVariable({ ...newVariable, value: e.target.value })}
                  placeholder="postgresql://..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newVariable.description}
                  onChange={(e) => setNewVariable({ ...newVariable, description: e.target.value })}
                  placeholder="Database connection URL"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="environment">Environment</Label>
                <Select
                  value={newVariable.environment}
                  onValueChange={(value: 'production' | 'staging' | 'development') => 
                    setNewVariable({ ...newVariable, environment: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="isSecret"
                  checked={newVariable.isSecret}
                  onCheckedChange={(checked) => setNewVariable({ ...newVariable, isSecret: checked })}
                />
                <Label htmlFor="isSecret">Secret Variable</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateVariable} disabled={actions.isLoading.updateVariables}>
                  {actions.isLoading.updateVariables ? (
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
        {variables?.data?.map((variable) => (
          <Card key={variable.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{variable.key}</h3>
                    <Badge variant={variable.environmentId === 'production' ? 'default' : 'secondary'}>
                      {variable.environmentId}
                    </Badge>
                    {variable.isSecret && <Badge variant="destructive">Secret</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{variable.description}</p>
                  <p className="text-sm font-mono">
                    {variable.isSecret ? '••••••••' : variable.value}
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingVariable(variable)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(variable.value)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {/* Delete functionality not available in current API */}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Variable Dialog */}
      <Dialog open={!!editingVariable} onOpenChange={() => setEditingVariable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Environment Variable</DialogTitle>
            <DialogDescription>
              Update the environment variable details
            </DialogDescription>
          </DialogHeader>
          {editingVariable && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-key">Variable Key</Label>
                <Input
                  id="edit-key"
                  value={editingVariable.key}
                  onChange={(e) => setEditingVariable({ ...editingVariable, key: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-value">Variable Value</Label>
                <Input
                  id="edit-value"
                  type={editingVariable.isSecret ? 'password' : 'text'}
                  value={editingVariable.value}
                  onChange={(e) => setEditingVariable({ ...editingVariable, value: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={editingVariable.description}
                  onChange={(e) => setEditingVariable({ ...editingVariable, description: e.target.value })}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-isSecret"
                  checked={editingVariable.isSecret}
                  onCheckedChange={(checked) => setEditingVariable({ ...editingVariable, isSecret: checked })}
                />
                <Label htmlFor="edit-isSecret">Secret Variable</Label>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setEditingVariable(null)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateVariable} disabled={actions.isLoading.updateVariables}>
                  {actions.isLoading.updateVariables ? (
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

function PreviewEnvironmentsTab({ projectId }: { projectId: string }) {
  const { data: environments, isLoading } = usePreviewEnvironments({ projectId })
  const actions = useEnvironmentActions()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const [newEnvironment, setNewEnvironment] = useState({
    name: '',
    branch: '',
    variables: [] as Array<{ key: string; value: string; isSecret?: boolean; description?: string }>,
    description: '',
  })

  const handleCreateEnvironment = () => {
    actions.createPreview(newEnvironment)
    setNewEnvironment({
      name: '',
      branch: '',
      variables: [],
      description: '',
    })
    setIsCreateDialogOpen(false)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Preview Environments</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Preview Environment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Preview Environment</DialogTitle>
              <DialogDescription>
                Create a new preview environment for testing
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="env-name">Environment Name</Label>
                <Input
                  id="env-name"
                  value={newEnvironment.name}
                  onChange={(e) => setNewEnvironment({ ...newEnvironment, name: e.target.value })}
                  placeholder="feature-branch"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="env-branch">Git Branch</Label>
                <Input
                  id="env-branch"
                  value={newEnvironment.branch}
                  onChange={(e) => setNewEnvironment({ ...newEnvironment, branch: e.target.value })}
                  placeholder="feature/new-feature"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="env-description">Description</Label>
                <Textarea
                  id="env-description"
                  value={newEnvironment.description}
                  onChange={(e) => setNewEnvironment({ ...newEnvironment, description: e.target.value })}
                  placeholder="Preview environment for testing new features"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateEnvironment} disabled={actions.isLoading.createPreview}>
                  {actions.isLoading.createPreview ? (
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
        {environments?.environments?.map((env) => (
          <Card key={env.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{env.name}</h3>
                    <Badge variant="outline">{env.branch}</Badge>
                    <Badge variant={env.isActive ? 'default' : 'secondary'}>
                      {env.isActive ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{env.metadata?.description || 'No description'}</p>
                  {env.url && (
                    <a 
                      href={env.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      <Globe className="h-3 w-3" />
                      {env.url}
                    </a>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(env.url, '_blank')}
                    disabled={!env.url}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => actions.deletePreview({ id: env.id })}
                    disabled={actions.isLoading.deletePreview}
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function EnvironmentTemplatesTab({ projectId: _ }: { projectId: string }) {
  // Template management not yet implemented in the API
  const templates = { 
    data: [] as Array<{
      id: string
      name: string
      description: string
      content: string
    }>
  } // Stub data
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  const [newTemplate, setNewTemplate] = useState({
    name: '',
    content: '',
    description: '',
    variables: [],
  })

  const handleCreateTemplate = () => {
    // Template creation not available in current API
    console.log('Template creation not yet implemented:', newTemplate)
    setNewTemplate({
      name: '',
      content: '',
      description: '',
      variables: [],
    })
    setIsCreateDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Environment Templates</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Environment Template</DialogTitle>
              <DialogDescription>
                Create a reusable environment template
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Template Name</Label>
                <Input
                  id="template-name"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  placeholder="Production Database"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-description">Description</Label>
                <Textarea
                  id="template-description"
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  placeholder="Template for production database configuration"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-content">Template Content</Label>
                <Textarea
                  id="template-content"
                  value={newTemplate.content}
                  onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                  placeholder="DATABASE_URL={{DATABASE_URL}}\nDB_PASSWORD={{DB_PASSWORD}}"
                  rows={8}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateTemplate} disabled={false}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Template
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {templates?.data?.map((template) => (
          <Card key={template.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-medium">{template.name}</h3>
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                  <div className="bg-muted p-2 rounded-md">
                    <pre className="text-xs overflow-x-auto">{template.content}</pre>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(template.content)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => console.log('Delete template not implemented:', template.id)}
                    disabled={false}
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TemplateResolverTab({ projectId: _ }: { projectId: string }) {
  const [templateContent, setTemplateContent] = useState('')
  const [variables, setVariables] = useState('')
  const { mutate: resolveTemplate, data: resolvedTemplate, isPending } = useResolveTemplate()

  const handleResolveTemplate = () => {
    try {
      const parsedVariables = JSON.parse(variables || '{}')
      resolveTemplate({
        template: templateContent,
        environmentId: 'production', // Should be dynamic based on selected environment
        context: parsedVariables,
        validateOnly: false,
      })
    } catch (error) {
      console.error('Failed to parse variables JSON:', error)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Template Resolver</h2>
        <p className="text-sm text-muted-foreground">
          Test and resolve environment templates with variable substitution
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Template Input</CardTitle>
            <CardDescription>
              Enter your template with variable placeholders like {/* {{VARIABLE_NAME}} */}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template">Template Content</Label>
              <Textarea
                id="template"
                value={templateContent}
                onChange={(e) => setTemplateContent(e.target.value)}
                placeholder="DATABASE_URL={{DATABASE_URL}}&#10;API_KEY={{API_KEY}}&#10;DEBUG={{DEBUG}}"
                rows={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="variables">Variables (JSON)</Label>
              <Textarea
                id="variables"
                value={variables}
                onChange={(e) => setVariables(e.target.value)}
                placeholder='{"DATABASE_URL": "postgresql://...", "API_KEY": "secret", "DEBUG": "true"}'
                rows={6}
              />
            </div>
            <Button onClick={handleResolveTemplate} disabled={isPending}>
              {isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Layers className="h-4 w-4 mr-2" />
              )}
              Resolve Template
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resolved Output</CardTitle>
            <CardDescription>
              The resolved template with variables substituted
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Resolved Content</Label>
                {resolvedTemplate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(resolvedTemplate.resolved)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="bg-muted p-3 rounded-md min-h-[200px]">
                <pre className="text-sm overflow-x-auto">
                  {resolvedTemplate?.resolved || 'No template resolved yet'}
                </pre>
              </div>
              {resolvedTemplate?.warnings && resolvedTemplate.warnings.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-amber-600">Warnings</Label>
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-md">
                    {resolvedTemplate.warnings.map((warning: string, index: number) => (
                      <p key={index} className="text-sm text-amber-800">
                        • {warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}