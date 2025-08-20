'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { 
  Github,
  GitBranch,
  Upload,
  Plus,
  X,
  Eye,
  EyeOff
} from 'lucide-react'

interface EnvironmentVariable {
  key: string
  value: string
  isSecret: boolean
}

interface DeploymentConfig {
  serviceId: string
  environment: 'production' | 'preview' | 'development'
  sourceType: 'git' | 'upload'
  sourceConfig: {
    // Git source
    repository?: string
    branch?: string
    gitProvider?: 'github' | 'gitlab' | 'git'
    // Upload source
    fileName?: string
    fileSize?: number
  }
  buildCommand?: string
  startCommand?: string
  dockerfilePath?: string
  environmentVariables: EnvironmentVariable[]
  previewConfig?: {
    enabled: boolean
    baseDomain: string
    subdomain?: string
    customDomain?: string
    shareEnvVars: boolean
  }
}

interface DeploymentSourceFormProps {
  serviceId?: string
  initialConfig?: Partial<DeploymentConfig>
  onSubmit: (config: DeploymentConfig) => void
  onCancel: () => void
}

export default function DeploymentSourceForm({ 
  serviceId = '', 
  initialConfig = {}, 
  onSubmit, 
  onCancel 
}: DeploymentSourceFormProps) {
  const [config, setConfig] = useState<DeploymentConfig>({
    serviceId,
    environment: 'production',
    sourceType: 'git',
    sourceConfig: {},
    environmentVariables: [],
    previewConfig: {
      enabled: false,
      baseDomain: 'preview.example.com',
      shareEnvVars: true
    },
    ...initialConfig
  })

  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  const addEnvironmentVariable = () => {
    setConfig(prev => ({
      ...prev,
      environmentVariables: [
        ...prev.environmentVariables,
        { key: '', value: '', isSecret: false }
      ]
    }))
  }

  const updateEnvironmentVariable = (index: number, field: keyof EnvironmentVariable, value: string | boolean) => {
    setConfig(prev => ({
      ...prev,
      environmentVariables: prev.environmentVariables.map((envVar, i) => 
        i === index ? { ...envVar, [field]: value } : envVar
      )
    }))
  }

  const removeEnvironmentVariable = (index: number) => {
    setConfig(prev => ({
      ...prev,
      environmentVariables: prev.environmentVariables.filter((_, i) => i !== index)
    }))
  }

  const toggleSecretVisibility = (index: number) => {
    setShowSecrets(prev => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setUploadFile(file)
      setConfig(prev => ({
        ...prev,
        sourceType: 'upload',
        sourceConfig: {
          fileName: file.name,
          fileSize: file.size
        }
      }))
    }
  }

  const handleSubmit = () => {
    onSubmit(config)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Deploy Configuration</h2>
          <p className="text-muted-foreground">Configure deployment source and settings</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSubmit}>Deploy</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Environment Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>Select the deployment environment</CardDescription>
            </CardHeader>
            <CardContent>
              <Select 
                value={config.environment} 
                onValueChange={(value: 'production' | 'preview' | 'development') => 
                  setConfig(prev => ({ ...prev, environment: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="preview">Preview</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Source Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Deployment Source</CardTitle>
              <CardDescription>Choose your deployment source</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs 
                value={config.sourceType} 
                onValueChange={(value) => 
                  setConfig(prev => ({ ...prev, sourceType: value as 'git' | 'upload' }))
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="git" className="flex items-center space-x-2">
                    <GitBranch className="h-4 w-4" />
                    <span>Git Repository</span>
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="flex items-center space-x-2">
                    <Upload className="h-4 w-4" />
                    <span>File Upload</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="git" className="space-y-4">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="git-provider">Git Provider</Label>
                      <Select 
                        value={config.sourceConfig.gitProvider} 
                        onValueChange={(value: 'github' | 'gitlab' | 'git') => 
                          setConfig(prev => ({ 
                            ...prev, 
                            sourceConfig: { ...prev.sourceConfig, gitProvider: value }
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select git provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="github">
                            <div className="flex items-center space-x-2">
                              <Github className="h-4 w-4" />
                              <span>GitHub</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="gitlab">
                            <div className="flex items-center space-x-2">
                              <GitBranch className="h-4 w-4" />
                              <span>GitLab</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="git">
                            <div className="flex items-center space-x-2">
                              <GitBranch className="h-4 w-4" />
                              <span>Git (Generic)</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="repository">Repository URL</Label>
                      <Input
                        id="repository"
                        placeholder="https://github.com/user/repo.git"
                        value={config.sourceConfig.repository || ''}
                        onChange={(e) => setConfig(prev => ({
                          ...prev,
                          sourceConfig: { ...prev.sourceConfig, repository: e.target.value }
                        }))}
                      />
                    </div>

                    <div>
                      <Label htmlFor="branch">Branch</Label>
                      <Input
                        id="branch"
                        placeholder="main"
                        value={config.sourceConfig.branch || ''}
                        onChange={(e) => setConfig(prev => ({
                          ...prev,
                          sourceConfig: { ...prev.sourceConfig, branch: e.target.value }
                        }))}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="upload" className="space-y-4">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-2">
                      Drop your ZIP file here, or click to browse
                    </p>
                    <input
                      type="file"
                      accept=".zip,.tar.gz"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="file-upload"
                    />
                    <label htmlFor="file-upload">
                      <Button variant="outline" asChild>
                        <span>Choose File</span>
                      </Button>
                    </label>
                    {uploadFile && (
                      <div className="mt-3 p-2 bg-gray-50 rounded text-sm">
                        <p className="font-medium">{uploadFile.name}</p>
                        <p className="text-gray-500">{Math.round(uploadFile.size / 1024)} KB</p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Build Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Build Configuration</CardTitle>
              <CardDescription>Configure build and runtime commands</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="dockerfile">Dockerfile Path (Optional)</Label>
                <Input
                  id="dockerfile"
                  placeholder="./Dockerfile"
                  value={config.dockerfilePath || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, dockerfilePath: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="build-command">Build Command (Optional)</Label>
                <Input
                  id="build-command"
                  placeholder="npm run build"
                  value={config.buildCommand || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, buildCommand: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="start-command">Start Command (Optional)</Label>
                <Input
                  id="start-command"
                  placeholder="npm start"
                  value={config.startCommand || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, startCommand: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Configuration */}
        <div className="space-y-6">
          {/* Environment Variables */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Environment Variables
                <Button variant="outline" size="sm" onClick={addEnvironmentVariable}>
                  <Plus className="h-4 w-4" />
                </Button>
              </CardTitle>
              <CardDescription>Configure environment variables for this deployment</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {config.environmentVariables.map((envVar, index) => (
                  <div key={index} className="space-y-2 p-3 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <Input
                        placeholder="Key"
                        value={envVar.key}
                        onChange={(e) => updateEnvironmentVariable(index, 'key', e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEnvironmentVariable(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 relative">
                        <Input
                          placeholder="Value"
                          type={envVar.isSecret && !showSecrets[index] ? 'password' : 'text'}
                          value={envVar.value}
                          onChange={(e) => updateEnvironmentVariable(index, 'value', e.target.value)}
                        />
                        {envVar.isSecret && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                            onClick={() => toggleSecretVisibility(index)}
                          >
                            {showSecrets[index] ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={envVar.isSecret}
                        onCheckedChange={(checked) => updateEnvironmentVariable(index, 'isSecret', checked)}
                      />
                      <Label className="text-sm">Secret</Label>
                    </div>
                  </div>
                ))}

                {config.environmentVariables.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No environment variables configured
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Preview Configuration */}
          {config.environment === 'preview' && (
            <Card>
              <CardHeader>
                <CardTitle>Preview Configuration</CardTitle>
                <CardDescription>Configure preview deployment settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={config.previewConfig?.enabled || false}
                    onCheckedChange={(checked) => setConfig(prev => ({
                      ...prev,
                      previewConfig: { ...prev.previewConfig!, enabled: checked }
                    }))}
                  />
                  <Label>Enable Preview Deployment</Label>
                </div>

                {config.previewConfig?.enabled && (
                  <>
                    <div>
                      <Label htmlFor="base-domain">Base Domain</Label>
                      <Input
                        id="base-domain"
                        placeholder="preview.example.com"
                        value={config.previewConfig.baseDomain}
                        onChange={(e) => setConfig(prev => ({
                          ...prev,
                          previewConfig: { ...prev.previewConfig!, baseDomain: e.target.value }
                        }))}
                      />
                    </div>

                    <div>
                      <Label htmlFor="subdomain">Subdomain (Optional)</Label>
                      <Input
                        id="subdomain"
                        placeholder="auto-generated"
                        value={config.previewConfig.subdomain || ''}
                        onChange={(e) => setConfig(prev => ({
                          ...prev,
                          previewConfig: { ...prev.previewConfig!, subdomain: e.target.value }
                        }))}
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={config.previewConfig.shareEnvVars}
                        onCheckedChange={(checked) => setConfig(prev => ({
                          ...prev,
                          previewConfig: { ...prev.previewConfig!, shareEnvVars: checked }
                        }))}
                      />
                      <Label>Share Environment Variables</Label>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Deployment Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Deployment Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Environment:</span>
                <Badge variant={config.environment === 'production' ? 'default' : 'secondary'}>
                  {config.environment}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Source:</span>
                <Badge variant="outline">
                  {config.sourceType === 'git' ? 'Git Repository' : 'File Upload'}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Env Variables:</span>
                <span className="text-sm text-muted-foreground">
                  {config.environmentVariables.length}
                </span>
              </div>

              {config.previewConfig?.enabled && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Preview URL:</span>
                  <span className="text-sm text-muted-foreground truncate">
                    {config.previewConfig.subdomain || 'auto'}.{config.previewConfig.baseDomain}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}