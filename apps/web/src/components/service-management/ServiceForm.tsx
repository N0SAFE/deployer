'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Plus,
  X,
  Eye,
  EyeOff,
  Server,
  Globe,
  Cpu
} from 'lucide-react'
import { type Service } from '@/state/serviceStore'

interface ServiceFormProps {
  projectId: string
  service?: Service
  onSubmit: (service: Partial<Service>) => void
  onCancel: () => void
  isEditing?: boolean
}

interface EnvironmentVariable {
  key: string
  value: string
  isSecret: boolean
}

export default function ServiceForm({ 
  projectId, 
  service, 
  onSubmit, 
  onCancel, 
  isEditing = false 
}: ServiceFormProps) {
  const [formData, setFormData] = useState({
    name: service?.name || '',
    description: service?.description || '',
    dockerfilePath: service?.dockerfilePath || '',
    subdomain: service?.subdomain || '',
    customDomain: service?.customDomain || '',
    port: service?.port?.toString() || '3000',
    healthCheckPath: service?.healthCheckPath || '/',
    cpuLimit: service?.cpuLimit || '0.5',
    memoryLimit: service?.memoryLimit || '512M',
    isEnabled: service?.isEnabled ?? true
  })

  const [envVars, setEnvVars] = useState<EnvironmentVariable[]>(() => {
    if (service?.envVars) {
      return Object.entries(service.envVars).map(([key, value]) => ({
        key,
        value,
        isSecret: false // We can't determine if it was secret from stored data
      }))
    }
    return []
  })

  const [buildArgs, setBuildArgs] = useState<EnvironmentVariable[]>(() => {
    if (service?.buildArgs) {
      return Object.entries(service.buildArgs).map(([key, value]) => ({
        key,
        value,
        isSecret: false
      }))
    }
    return []
  })

  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

  const addEnvironmentVariable = (type: 'env' | 'build') => {
    const setter = type === 'env' ? setEnvVars : setBuildArgs
    setter(prev => [...prev, { key: '', value: '', isSecret: false }])
  }

  const updateVariable = (
    index: number, 
    field: keyof EnvironmentVariable, 
    value: string | boolean,
    type: 'env' | 'build'
  ) => {
    const setter = type === 'env' ? setEnvVars : setBuildArgs
    setter(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ))
  }

  const removeVariable = (index: number, type: 'env' | 'build') => {
    const setter = type === 'env' ? setEnvVars : setBuildArgs
    setter(prev => prev.filter((_, i) => i !== index))
  }

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSubmit = () => {
    const envVarsObject = envVars.reduce((acc, { key, value }) => {
      if (key.trim()) acc[key] = value
      return acc
    }, {} as Record<string, string>)

    const buildArgsObject = buildArgs.reduce((acc, { key, value }) => {
      if (key.trim()) acc[key] = value
      return acc
    }, {} as Record<string, string>)

    const serviceData: Partial<Service> = {
      ...service,
      name: formData.name,
      description: formData.description || null,
      projectId,
      dockerfilePath: formData.dockerfilePath || null,
      envVars: Object.keys(envVarsObject).length > 0 ? envVarsObject : null,
      buildArgs: Object.keys(buildArgsObject).length > 0 ? buildArgsObject : null,
      subdomain: formData.subdomain || null,
      customDomain: formData.customDomain || null,
      port: parseInt(formData.port),
      healthCheckPath: formData.healthCheckPath || null,
      cpuLimit: formData.cpuLimit || null,
      memoryLimit: formData.memoryLimit || null,
      isEnabled: formData.isEnabled,
      updatedAt: new Date()
    }

    if (!isEditing) {
      serviceData.createdAt = new Date()
    }

    onSubmit(serviceData)
  }

  const renderVariableSection = (
    title: string,
    variables: EnvironmentVariable[],
    type: 'env' | 'build'
  ) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {title}
          <Button variant="outline" size="sm" onClick={() => addEnvironmentVariable(type)}>
            <Plus className="h-4 w-4" />
          </Button>
        </CardTitle>
        <CardDescription>
          {type === 'env' 
            ? 'Runtime environment variables for your service'
            : 'Build-time arguments for Docker builds'
          }
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {variables.map((variable, index) => (
            <div key={index} className="space-y-2 p-3 border rounded-lg">
              <div className="flex items-center space-x-2">
                <Input
                  placeholder="Key"
                  value={variable.key}
                  onChange={(e) => updateVariable(index, 'key', e.target.value, type)}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeVariable(index, type)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="relative">
                <Input
                  placeholder="Value"
                  type={variable.isSecret && !showSecrets[`${type}-${index}`] ? 'password' : 'text'}
                  value={variable.value}
                  onChange={(e) => updateVariable(index, 'value', e.target.value, type)}
                />
                {variable.isSecret && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => toggleSecretVisibility(`${type}-${index}`)}
                  >
                    {showSecrets[`${type}-${index}`] ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={variable.isSecret}
                  onCheckedChange={(checked) => updateVariable(index, 'isSecret', checked, type)}
                />
                <Label className="text-sm">Secret</Label>
              </div>
            </div>
          ))}

          {variables.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No {type === 'env' ? 'environment variables' : 'build arguments'} configured
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">
            {isEditing ? 'Edit Service' : 'Create New Service'}
          </h2>
          <p className="text-muted-foreground">
            {isEditing 
              ? 'Update service configuration and settings'
              : 'Configure a new service for your project'
            }
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {isEditing ? 'Update Service' : 'Create Service'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Server className="h-5 w-5" />
                <span>Basic Information</span>
              </CardTitle>
              <CardDescription>Configure basic service details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Service Name *</Label>
                <Input
                  id="name"
                  placeholder="my-service"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="Describe what this service does..."
                  value={formData.description}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.isEnabled}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isEnabled: checked }))}
                />
                <Label>Enable this service</Label>
              </div>
            </CardContent>
          </Card>

          {/* Docker Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Docker Configuration</CardTitle>
              <CardDescription>Configure Docker build and runtime settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="dockerfile">Dockerfile Path</Label>
                <Input
                  id="dockerfile"
                  placeholder="./Dockerfile"
                  value={formData.dockerfilePath}
                  onChange={(e) => setFormData(prev => ({ ...prev, dockerfilePath: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="port">Port *</Label>
                  <Input
                    id="port"
                    type="number"
                    placeholder="3000"
                    value={formData.port}
                    onChange={(e) => setFormData(prev => ({ ...prev, port: e.target.value }))}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="health-check">Health Check Path</Label>
                  <Input
                    id="health-check"
                    placeholder="/health"
                    value={formData.healthCheckPath}
                    onChange={(e) => setFormData(prev => ({ ...prev, healthCheckPath: e.target.value }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Domain Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Globe className="h-5 w-5" />
                <span>Domain Configuration</span>
              </CardTitle>
              <CardDescription>Configure how your service is accessed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="subdomain">Subdomain</Label>
                <Input
                  id="subdomain"
                  placeholder="api"
                  value={formData.subdomain}
                  onChange={(e) => setFormData(prev => ({ ...prev, subdomain: e.target.value }))}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Will create: {formData.subdomain || 'subdomain'}.yourdomain.com
                </p>
              </div>

              <div>
                <Label htmlFor="custom-domain">Custom Domain</Label>
                <Input
                  id="custom-domain"
                  placeholder="api.example.com"
                  value={formData.customDomain}
                  onChange={(e) => setFormData(prev => ({ ...prev, customDomain: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Configuration */}
        <div className="space-y-6">
          {/* Resource Limits */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Cpu className="h-5 w-5" />
                <span>Resource Limits</span>
              </CardTitle>
              <CardDescription>Configure CPU and memory limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="cpu-limit">CPU Limit</Label>
                <Select 
                  value={formData.cpuLimit} 
                  onValueChange={(value) => setFormData(prev => ({ ...prev, cpuLimit: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.1">0.1 CPU</SelectItem>
                    <SelectItem value="0.25">0.25 CPU</SelectItem>
                    <SelectItem value="0.5">0.5 CPU</SelectItem>
                    <SelectItem value="1">1 CPU</SelectItem>
                    <SelectItem value="2">2 CPU</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="memory-limit">Memory Limit</Label>
                <Select 
                  value={formData.memoryLimit} 
                  onValueChange={(value) => setFormData(prev => ({ ...prev, memoryLimit: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="128M">128 MB</SelectItem>
                    <SelectItem value="256M">256 MB</SelectItem>
                    <SelectItem value="512M">512 MB</SelectItem>
                    <SelectItem value="1G">1 GB</SelectItem>
                    <SelectItem value="2G">2 GB</SelectItem>
                    <SelectItem value="4G">4 GB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Service Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Service Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Status:</span>
                <Badge variant={formData.isEnabled ? 'default' : 'secondary'}>
                  {formData.isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Port:</span>
                <span className="text-sm text-muted-foreground">{formData.port}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">CPU:</span>
                <span className="text-sm text-muted-foreground">{formData.cpuLimit}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Memory:</span>
                <span className="text-sm text-muted-foreground">{formData.memoryLimit}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Env Variables:</span>
                <span className="text-sm text-muted-foreground">{envVars.length}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Build Args:</span>
                <span className="text-sm text-muted-foreground">{buildArgs.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Variable Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderVariableSection('Environment Variables', envVars, 'env')}
        {renderVariableSection('Build Arguments', buildArgs, 'build')}
      </div>
    </div>
  )
}