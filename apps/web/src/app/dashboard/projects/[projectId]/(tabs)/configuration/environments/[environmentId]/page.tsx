'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from '@repo/ui/components/shadcn/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@repo/ui/components/shadcn/dialog'
import {
  Globe,
  Key,
  Server,
  GitBranch,
  ExternalLink,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Save,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Copy,
  ArrowLeft,
  Lightbulb,
  Edit,
} from 'lucide-react'
import Link from 'next/link'

interface EnvironmentVariable {
  key: string
  value: string
  isSecret: boolean
  description?: string
}

interface EnvironmentDetails {
  id: string
  name: string
  type: 'production' | 'staging' | 'preview'
  url?: string
  branch?: string
  isActive: boolean
  autoDeloy: boolean
  status: 'healthy' | 'unhealthy' | 'deploying' | 'failed' | 'unknown'
  variables: EnvironmentVariable[]
  deploymentConfig: {
    strategy: 'rolling' | 'blue_green' | 'recreate'
    healthCheckPath: string
    healthCheckTimeout: number
    deploymentTimeout: number
    replicas: number
    resources: {
      cpu: string
      memory: string
      storage?: string
    }
    scaling: {
      enabled: boolean
      minReplicas: number
      maxReplicas: number
      targetCPU: number
      targetMemory: number
    }
  }
  protectionRules: {
    requireApproval: boolean
    approvers: string[]
    allowedBranches: string[]
    requireStatusChecks: boolean
  }
  metadata: Record<string, string | number | boolean>
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

// Mock data - replace with API call
const mockEnvironment: EnvironmentDetails = {
  id: '1',
  name: 'Production',
  type: 'production',
  url: 'https://myapp.com',
  branch: 'main',
  isActive: true,
  autoDeloy: false,
  status: 'healthy',
  variables: [
    { key: 'DATABASE_URL', value: 'postgres://user:pass@localhost:5432/prod', isSecret: true, description: 'Main database connection' },
    { key: 'API_KEY', value: 'pk_live_1234567890', isSecret: true, description: 'Production API key' },
    { key: 'NODE_ENV', value: 'production', isSecret: false, description: 'Node environment' },
    { key: 'LOG_LEVEL', value: 'warn', isSecret: false, description: 'Application log level' },
  ],
  deploymentConfig: {
    strategy: 'rolling',
    healthCheckPath: '/health',
    healthCheckTimeout: 30,
    deploymentTimeout: 600,
    replicas: 3,
    resources: {
      cpu: '1',
      memory: '2GB',
      storage: '10GB',
    },
    scaling: {
      enabled: true,
      minReplicas: 2,
      maxReplicas: 10,
      targetCPU: 70,
      targetMemory: 80,
    },
  },
  protectionRules: {
    requireApproval: true,
    approvers: ['user1', 'user2'],
    allowedBranches: ['main', 'release/*'],
    requireStatusChecks: true,
  },
  metadata: {
    region: 'us-east-1',
    tier: 'production',
  },
  tags: ['critical', 'customer-facing'],
  createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
}

export default function EnvironmentConfigPage() {
  const params = useParams()
  const projectId = params.projectId as string
  // const environmentId = params.environmentId as string // We'll use this later for API calls

  const [environment, setEnvironment] = useState<EnvironmentDetails>(mockEnvironment)
  const [activeTab, setActiveTab] = useState('general')
  const [hasChanges, setHasChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // Variable management state
  const [variables, setVariables] = useState<EnvironmentVariable[]>(environment.variables)
  const [newVariable, setNewVariable] = useState<Partial<EnvironmentVariable>>({})
  const [isAddingVariable, setIsAddingVariable] = useState(false)
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  
  // General settings state
  const [generalConfig, setGeneralConfig] = useState({
    name: environment.name,
    url: environment.url || '',
    branch: environment.branch || '',
    isActive: environment.isActive,
    autoDeloy: environment.autoDeloy,
  })

  const handleSave = async () => {
    setIsLoading(true)
    try {
      // TODO: Implement API call to save environment
      console.log('Saving environment:', {
        generalConfig,
        variables,
        deploymentConfig: environment.deploymentConfig,
      })
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save environment:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddVariable = () => {
    if (!newVariable.key || !newVariable.value) return
    
    const variable: EnvironmentVariable = {
      key: newVariable.key,
      value: newVariable.value,
      isSecret: newVariable.isSecret || false,
      description: newVariable.description,
    }
    
    setVariables([...variables, variable])
    setNewVariable({})
    setIsAddingVariable(false)
    setHasChanges(true)
  }

  const handleDeleteVariable = (index: number) => {
    setVariables(variables.filter((_, i) => i !== index))
    setHasChanges(true)
  }

  const toggleShowSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const getStatusIcon = () => {
    switch (environment.status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'unhealthy':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'deploying':
        return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />
    }
  }

  const getTypeColor = () => {
    switch (environment.type) {
      case 'production':
        return 'bg-red-100 text-red-800'
      case 'staging':
        return 'bg-yellow-100 text-yellow-800'
      case 'preview':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link 
            href={`/dashboard/projects/${projectId}/configuration/environments`}
            className="p-2 hover:bg-accent rounded-md"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Globe className="h-6 w-6" />
                {environment.name}
              </h1>
              {getStatusIcon()}
              <Badge variant="secondary" className={getTypeColor()}>
                {environment.type}
              </Badge>
              {!environment.isActive && (
                <Badge variant="outline">Inactive</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Configure environment settings and variables
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {environment.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={environment.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Visit
              </a>
            </Button>
          )}
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges || isLoading}
            size="sm"
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Environment Info Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Variables</p>
                <p className="text-2xl font-bold">{variables.length}</p>
              </div>
              <Key className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Replicas</p>
                <p className="text-2xl font-bold">{environment.deploymentConfig.replicas}</p>
              </div>
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">CPU</p>
                <p className="text-2xl font-bold">{environment.deploymentConfig.resources.cpu}</p>
              </div>
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Memory</p>
                <p className="text-2xl font-bold">{environment.deploymentConfig.resources.memory}</p>
              </div>
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        {/* General Configuration */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General Configuration</CardTitle>
              <CardDescription>
                Basic environment settings and information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Environment Name</Label>
                  <Input
                    id="name"
                    value={generalConfig.name}
                    onChange={(e) => {
                      setGeneralConfig(prev => ({ ...prev, name: e.target.value }))
                      setHasChanges(true)
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">Environment URL</Label>
                  <Input
                    id="url"
                    placeholder="https://example.com"
                    value={generalConfig.url}
                    onChange={(e) => {
                      setGeneralConfig(prev => ({ ...prev, url: e.target.value }))
                      setHasChanges(true)
                    }}
                  />
                </div>
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="branch">Git Branch</Label>
                  <Input
                    id="branch"
                    placeholder="main, develop, feature/..."
                    value={generalConfig.branch}
                    onChange={(e) => {
                      setGeneralConfig(prev => ({ ...prev, branch: e.target.value }))
                      setHasChanges(true)
                    }}
                  />
                  {generalConfig.branch && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <GitBranch className="h-3 w-3" />
                      <span>Linked to {generalConfig.branch}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="active"
                    checked={generalConfig.isActive}
                    onCheckedChange={(checked) => {
                      setGeneralConfig(prev => ({ ...prev, isActive: checked }))
                      setHasChanges(true)
                    }}
                  />
                  <Label htmlFor="active">Environment is active</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-deploy"
                    checked={generalConfig.autoDeloy}
                    onCheckedChange={(checked) => {
                      setGeneralConfig(prev => ({ ...prev, autoDeloy: checked }))
                      setHasChanges(true)
                    }}
                  />
                  <Label htmlFor="auto-deploy">Enable auto deployment</Label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variables Configuration */}
        <TabsContent value="variables">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Environment Variables</CardTitle>
                  <CardDescription>
                    Manage environment-specific configuration variables
                  </CardDescription>
                </div>
                <Button onClick={() => setIsAddingVariable(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Variable
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {variables.map((variable, index) => (
                  <div key={`${variable.key}-${index}`} className="flex items-center gap-2 p-3 border rounded-lg">
                    <div className="flex-1 grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Key</Label>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{variable.key}</span>
                          {variable.isSecret && (
                            <Badge variant="secondary" className="h-5 text-xs">
                              <Key className="h-3 w-3 mr-1" />
                              Secret
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Value</Label>
                        <div className="flex items-center gap-2">
                          {variable.isSecret && !showSecrets[variable.key] ? (
                            <span className="font-mono text-sm">••••••••</span>
                          ) : (
                            <span className="font-mono text-sm truncate max-w-[200px]">
                              {variable.value}
                            </span>
                          )}
                          {variable.isSecret && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => toggleShowSecret(variable.key)}
                            >
                              {showSecrets[variable.key] ? (
                                <EyeOff className="h-3 w-3" />
                              ) : (
                                <Eye className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Description</Label>
                        <span className="text-sm text-muted-foreground truncate block">
                          {variable.description || 'No description'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => navigator.clipboard.writeText(variable.value)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                        onClick={() => handleDeleteVariable(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {variables.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Key className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No environment variables configured</p>
                    <p className="text-sm">Add your first variable to get started</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variable Templates Configuration */}
        <TabsContent value="templates">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Dynamic Variable Templates</CardTitle>
                <CardDescription>
                  Create dynamic variables that reference other projects, services, and environments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 rounded-md bg-blue-50 border border-blue-200">
                    <div className="flex items-center gap-2 text-blue-800 text-sm font-medium mb-2">
                      <Lightbulb className="h-4 w-4" />
                      Dynamic Variable Templates
                    </div>
                    <p className="text-sm text-blue-700">
                      Variable templates allow you to create dynamic values that reference other resources in your system.
                      Use syntax like ${'{'}projects.myproject.url{'}'} to reference project properties, or ${'{'}services.api.port{'}'} for service configuration.
                    </p>
                  </div>

                  {/* Existing dynamic variables */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">Current Dynamic Variables</h4>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Template
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {[
                        {
                          key: 'API_BASE_URL',
                          template: '${services.api.url}/v1',
                          resolvedValue: 'https://api.myproject.com/v1',
                          status: 'resolved'
                        },
                        {
                          key: 'DATABASE_URL',
                          template: '${projects.1.services.database.connection}',
                          resolvedValue: 'postgresql://localhost:5432/myproject',
                          status: 'resolved'
                        },
                        {
                          key: 'WEB_URL',
                          template: 'https://${environments.1.domain}',
                          resolvedValue: 'https://prod.myproject.com',
                          status: 'resolved'
                        },
                      ].map((variable, index) => (
                        <div key={index} className="p-3 border rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium">{variable.key}</span>
                              <Badge 
                                variant={variable.status === 'resolved' ? 'secondary' : 'destructive'}
                                className={variable.status === 'resolved' ? 'text-green-700 bg-green-50 border-green-200' : ''}
                              >
                                {variable.status === 'resolved' ? (
                                  <>
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Resolved
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Failed
                                  </>
                                )}
                              </Badge>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Template:</div>
                            <div className="font-mono text-xs bg-gray-50 p-1 rounded">{variable.template}</div>
                            <div className="text-xs text-muted-foreground">Resolved Value:</div>
                            <div className="font-mono text-xs bg-green-50 p-1 rounded text-green-800">{variable.resolvedValue}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Deployment Configuration */}
        <TabsContent value="deployment">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Deployment Strategy</CardTitle>
                <CardDescription>
                  Configure how deployments are handled for this environment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Deployment Strategy</Label>
                    <Select
                      value={environment.deploymentConfig.strategy}
                      onValueChange={(value: 'rolling' | 'blue_green' | 'recreate') => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: { ...prev.deploymentConfig, strategy: value }
                        }))
                        setHasChanges(true)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rolling">Rolling Update</SelectItem>
                        <SelectItem value="blue_green">Blue-Green</SelectItem>
                        <SelectItem value="recreate">Recreate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Replicas</Label>
                    <Input
                      type="number"
                      value={environment.deploymentConfig.replicas}
                      onChange={(e) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: { ...prev.deploymentConfig, replicas: parseInt(e.target.value) || 1 }
                        }))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Health Check Path</Label>
                    <Input
                      value={environment.deploymentConfig.healthCheckPath}
                      onChange={(e) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: { ...prev.deploymentConfig, healthCheckPath: e.target.value }
                        }))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Health Check Timeout (seconds)</Label>
                    <Input
                      type="number"
                      value={environment.deploymentConfig.healthCheckTimeout}
                      onChange={(e) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: { ...prev.deploymentConfig, healthCheckTimeout: parseInt(e.target.value) || 30 }
                        }))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Resource Configuration</CardTitle>
                <CardDescription>
                  Set resource limits and scaling configuration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>CPU Limit</Label>
                    <Input
                      value={environment.deploymentConfig.resources.cpu}
                      onChange={(e) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: {
                            ...prev.deploymentConfig,
                            resources: { ...prev.deploymentConfig.resources, cpu: e.target.value }
                          }
                        }))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Memory Limit</Label>
                    <Input
                      value={environment.deploymentConfig.resources.memory}
                      onChange={(e) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: {
                            ...prev.deploymentConfig,
                            resources: { ...prev.deploymentConfig.resources, memory: e.target.value }
                          }
                        }))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Storage Limit</Label>
                    <Input
                      value={environment.deploymentConfig.resources.storage || ''}
                      onChange={(e) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: {
                            ...prev.deploymentConfig,
                            resources: { ...prev.deploymentConfig.resources, storage: e.target.value }
                          }
                        }))
                        setHasChanges(true)
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={environment.deploymentConfig.scaling.enabled}
                      onCheckedChange={(checked) => {
                        setEnvironment(prev => ({
                          ...prev,
                          deploymentConfig: {
                            ...prev.deploymentConfig,
                            scaling: { ...prev.deploymentConfig.scaling, enabled: checked }
                          }
                        }))
                        setHasChanges(true)
                      }}
                    />
                    <Label>Enable Auto-scaling</Label>
                  </div>

                  {environment.deploymentConfig.scaling.enabled && (
                    <div className="grid gap-4 md:grid-cols-4 p-4 border rounded-lg">
                      <div className="space-y-2">
                        <Label>Min Replicas</Label>
                        <Input
                          type="number"
                          value={environment.deploymentConfig.scaling.minReplicas}
                          onChange={(e) => {
                            setEnvironment(prev => ({
                              ...prev,
                              deploymentConfig: {
                                ...prev.deploymentConfig,
                                scaling: { ...prev.deploymentConfig.scaling, minReplicas: parseInt(e.target.value) || 1 }
                              }
                            }))
                            setHasChanges(true)
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Max Replicas</Label>
                        <Input
                          type="number"
                          value={environment.deploymentConfig.scaling.maxReplicas}
                          onChange={(e) => {
                            setEnvironment(prev => ({
                              ...prev,
                              deploymentConfig: {
                                ...prev.deploymentConfig,
                                scaling: { ...prev.deploymentConfig.scaling, maxReplicas: parseInt(e.target.value) || 10 }
                              }
                            }))
                            setHasChanges(true)
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>CPU Target (%)</Label>
                        <Input
                          type="number"
                          value={environment.deploymentConfig.scaling.targetCPU}
                          onChange={(e) => {
                            setEnvironment(prev => ({
                              ...prev,
                              deploymentConfig: {
                                ...prev.deploymentConfig,
                                scaling: { ...prev.deploymentConfig.scaling, targetCPU: parseInt(e.target.value) || 70 }
                              }
                            }))
                            setHasChanges(true)
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Memory Target (%)</Label>
                        <Input
                          type="number"
                          value={environment.deploymentConfig.scaling.targetMemory}
                          onChange={(e) => {
                            setEnvironment(prev => ({
                              ...prev,
                              deploymentConfig: {
                                ...prev.deploymentConfig,
                                scaling: { ...prev.deploymentConfig.scaling, targetMemory: parseInt(e.target.value) || 80 }
                              }
                            }))
                            setHasChanges(true)
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Security Configuration */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Protection Rules</CardTitle>
              <CardDescription>
                Configure security and access control for this environment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={environment.protectionRules.requireApproval}
                  onCheckedChange={(checked) => {
                    setEnvironment(prev => ({
                      ...prev,
                      protectionRules: { ...prev.protectionRules, requireApproval: checked }
                    }))
                    setHasChanges(true)
                  }}
                />
                <Label>Require deployment approval</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={environment.protectionRules.requireStatusChecks}
                  onCheckedChange={(checked) => {
                    setEnvironment(prev => ({
                      ...prev,
                      protectionRules: { ...prev.protectionRules, requireStatusChecks: checked }
                    }))
                    setHasChanges(true)
                  }}
                />
                <Label>Require status checks to pass</Label>
              </div>

              <div className="space-y-2">
                <Label>Allowed Branches</Label>
                <div className="space-y-2">
                  {environment.protectionRules.allowedBranches.map((branch, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Badge variant="outline">{branch}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-red-600"
                        onClick={() => {
                          setEnvironment(prev => ({
                            ...prev,
                            protectionRules: {
                              ...prev.protectionRules,
                              allowedBranches: prev.protectionRules.allowedBranches.filter((_, i) => i !== index)
                            }
                          }))
                          setHasChanges(true)
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Branch Pattern
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Variable Dialog */}
      <Dialog open={isAddingVariable} onOpenChange={setIsAddingVariable}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Environment Variable</DialogTitle>
            <DialogDescription>
              Add a new environment variable for this environment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="var-key">Key</Label>
              <Input
                id="var-key"
                placeholder="VARIABLE_NAME"
                value={newVariable.key || ''}
                onChange={(e) => setNewVariable(prev => ({ ...prev, key: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="var-value">Value</Label>
              <Input
                id="var-value"
                placeholder="variable value"
                value={newVariable.value || ''}
                onChange={(e) => setNewVariable(prev => ({ ...prev, value: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="var-description">Description (Optional)</Label>
              <Textarea
                id="var-description"
                placeholder="Description of this variable"
                value={newVariable.description || ''}
                onChange={(e) => setNewVariable(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={newVariable.isSecret || false}
                onCheckedChange={(checked) => setNewVariable(prev => ({ ...prev, isSecret: checked }))}
              />
              <Label>Mark as secret</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingVariable(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddVariable} disabled={!newVariable.key || !newVariable.value}>
              Add Variable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}