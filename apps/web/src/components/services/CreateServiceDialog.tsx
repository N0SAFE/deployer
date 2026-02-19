'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@repo/ui/components/shadcn/form'
import { Input } from '@repo/ui/components/shadcn/input'
import { Button } from '@repo/ui/components/shadcn/button'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Loader2, Server, Plus, Trash2 } from 'lucide-react'
import { useCreateService } from '@/hooks/useServices'

const serviceSchema = z.object({
  name: z.string()
    .min(1, 'Service name is required')
    .max(100, 'Service name must be less than 100 characters')
    .regex(/^[a-z0-9-]+$/, 'Service name must be lowercase alphanumeric with hyphens only'),
  type: z.string().min(1, 'Service type is required'),
  provider: z.enum(['github', 'gitlab', 'bitbucket', 'docker_registry', 'gitea', 's3_bucket', 'manual'], {
    message: 'Provider is required'
  }),
  builder: z.enum(['nixpack', 'railpack', 'dockerfile', 'buildpack', 'static', 'docker_compose'], {
    message: 'Builder is required'
  }),
  port: z.number().int().positive().optional(),
  healthCheckPath: z.string().min(1, 'Health check path is required'),
})

type ServiceFormData = z.infer<typeof serviceSchema>

const SERVICE_TYPES = [
  { value: 'web', label: 'Web Application' },
  { value: 'api', label: 'API Service' },
  { value: 'worker', label: 'Background Worker' },
  { value: 'database', label: 'Database' },
  { value: 'cache', label: 'Cache Service' },
  { value: 'queue', label: 'Message Queue' },
  { value: 'cron', label: 'Scheduled Tasks' },
  { value: 'static', label: 'Static Files' },
]

const SERVICE_PROVIDERS = [
  { value: 'github', label: 'GitHub', description: 'Deploy from GitHub repository' },
  { value: 'gitlab', label: 'GitLab', description: 'Deploy from GitLab repository' },
  { value: 'bitbucket', label: 'Bitbucket', description: 'Deploy from Bitbucket repository' },
  { value: 'gitea', label: 'Gitea', description: 'Deploy from Gitea repository' },
  { value: 'docker_registry', label: 'Docker Registry', description: 'Deploy pre-built Docker images' },
  { value: 's3_bucket', label: 'S3 Bucket', description: 'Deploy from S3 bucket storage' },
  { value: 'manual', label: 'Manual', description: 'Manual deployment with custom scripts' },
]

const SERVICE_BUILDERS = [
  { value: 'dockerfile', label: 'Dockerfile', description: 'Build using Dockerfile' },
  { value: 'nixpack', label: 'Nixpack', description: 'Auto-detect and build with Nixpack' },
  { value: 'railpack', label: 'Railpack', description: 'Build Ruby on Rails applications' },
  { value: 'buildpack', label: 'Buildpack', description: 'Build with Cloud Native Buildpacks' },
  { value: 'static', label: 'Static', description: 'Serve static files directly' },
  { value: 'docker_compose', label: 'Docker Compose', description: 'Multi-container deployment' },
]

interface CreateServiceDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateServiceDialog({ 
  projectId, 
  open, 
  onOpenChange 
}: CreateServiceDialogProps) {
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([])
  const [providerConfig, setProviderConfig] = useState<Record<string, string>>({})
  const [builderConfig, setBuilderConfig] = useState<Record<string, string>>({})
  
  const createService = useCreateService()
  
  const form = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: '',
      type: '',
      provider: undefined,
      builder: undefined,
      port: undefined,
      healthCheckPath: '/health',
    },
  })

  const onSubmit = async (data: ServiceFormData) => {
    try {
      const environmentVariables = envVars.reduce((acc, { key, value }) => {
        if (key && value) acc[key] = value
        return acc
      }, {} as Record<string, string>)

      await createService.mutateAsync({
        projectId,
        name: data.name,
        type: data.type,
        provider: data.provider,
        builder: data.builder,
        port: data.port || undefined,
        healthCheckPath: data.healthCheckPath,
        environmentVariables: Object.keys(environmentVariables).length > 0 ? environmentVariables : undefined,
        providerConfig: Object.keys(providerConfig).length > 0 ? providerConfig : undefined,
        builderConfig: Object.keys(builderConfig).length > 0 ? builderConfig : undefined,
      })

      // Reset form and close dialog
      form.reset()
      setEnvVars([])
      setProviderConfig({})
      setBuilderConfig({})
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to create service:', error)
    }
  }

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }])
  }

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index))
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...envVars]
    newEnvVars[index][field] = value
    setEnvVars(newEnvVars)
  }

  const updateProviderConfig = (key: string, value: string) => {
    setProviderConfig(prev => ({ ...prev, [key]: value }))
  }

  const updateBuilderConfig = (key: string, value: string) => {
    setBuilderConfig(prev => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Server className="h-5 w-5" />
            <span>Create New Service</span>
          </DialogTitle>
          <DialogDescription>
            Configure a new deployable service for your project. Services can be web apps, APIs, workers, or other components.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Basic Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Name</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="my-service" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Lowercase, alphanumeric with hyphens only
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select service type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SERVICE_TYPES.map(type => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="provider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Source Provider</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select provider" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SERVICE_PROVIDERS.map(provider => (
                              <SelectItem key={provider.value} value={provider.value}>
                                <div>
                                  <div className="font-medium">{provider.label}</div>
                                  <div className="text-xs text-muted-foreground">{provider.description}</div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Where your code or deployment artifacts come from
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="builder"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Build System</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select builder" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SERVICE_BUILDERS.map(builder => (
                              <SelectItem key={builder.value} value={builder.value}>
                                <div>
                                  <div className="font-medium">{builder.label}</div>
                                  <div className="text-xs text-muted-foreground">{builder.description}</div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          How your service will be built and deployed
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Port (Optional)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number"
                            placeholder="3000" 
                            {...field}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                          />
                        </FormControl>
                        <FormDescription>
                          Main port for the service
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="healthCheckPath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Health Check Path</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="/health" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Endpoint for health checks
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Provider Configuration */}
            {form.watch('provider') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {SERVICE_PROVIDERS.find(p => p.value === form.watch('provider'))?.label} Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {form.watch('provider') === 'github' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">Repository URL</label>
                          <Input 
                            placeholder="https://github.com/user/repo"
                            onChange={(e) => updateProviderConfig('repositoryUrl', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Branch</label>
                          <Input 
                            placeholder="main"
                            onChange={(e) => updateProviderConfig('branch', e.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Access Token (Optional)</label>
                        <Input 
                          type="password"
                          placeholder="ghp_xxxxxxxxxxxx"
                          onChange={(e) => updateProviderConfig('accessToken', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                  {form.watch('provider') === 'docker_registry' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">Registry URL</label>
                          <Input 
                            placeholder="docker.io"
                            onChange={(e) => updateProviderConfig('registryUrl', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Image Name</label>
                          <Input 
                            placeholder="nginx:latest"
                            onChange={(e) => updateProviderConfig('imageName', e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Builder Configuration */}
            {form.watch('builder') && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {SERVICE_BUILDERS.find(b => b.value === form.watch('builder'))?.label} Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {form.watch('builder') === 'dockerfile' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">Dockerfile Path</label>
                        <Input 
                          placeholder="Dockerfile"
                          onChange={(e) => updateBuilderConfig('dockerfilePath', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Build Context</label>
                        <Input 
                          placeholder="."
                          onChange={(e) => updateBuilderConfig('buildContext', e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  {form.watch('builder') === 'static' && (
                    <div>
                      <label className="text-sm font-medium">Output Directory</label>
                      <Input 
                        placeholder="dist"
                        onChange={(e) => updateBuilderConfig('outputDirectory', e.target.value)}
                      />
                    </div>
                  )}
                  {(form.watch('builder') === 'nixpack' || form.watch('builder') === 'buildpack') && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">Build Command (Optional)</label>
                          <Input 
                            placeholder="npm run build"
                            onChange={(e) => updateBuilderConfig('buildCommand', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Start Command (Optional)</label>
                          <Input 
                            placeholder="npm start"
                            onChange={(e) => updateBuilderConfig('startCommand', e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Environment Variables */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Environment Variables</CardTitle>
                  <Button type="button" variant="outline" size="sm" onClick={addEnvVar}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Variable
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {envVars.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No environment variables defined
                  </p>
                ) : (
                  <div className="space-y-3">
                    {envVars.map((envVar, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <Input
                          placeholder="KEY"
                          value={envVar.key}
                          onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                        />
                        <span className="text-muted-foreground">=</span>
                        <Input
                          placeholder="value"
                          value={envVar.value}
                          onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeEnvVar(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Form Actions */}
            <div className="flex justify-end space-x-2">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                disabled={createService.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createService.isPending}>
                {createService.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Server className="h-4 w-4 mr-2" />
                    Create Service
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}