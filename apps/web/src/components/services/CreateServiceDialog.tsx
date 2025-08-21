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
  dockerfilePath: z.string().min(1, 'Dockerfile path is required'),
  buildContext: z.string().min(1, 'Build context is required'),
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
  const [buildArgs, setBuildArgs] = useState<Array<{ key: string; value: string }>>([])
  
  const createService = useCreateService()
  
  const form = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: '',
      type: '',
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
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

      const buildArguments = buildArgs.reduce((acc, { key, value }) => {
        if (key && value) acc[key] = value
        return acc
      }, {} as Record<string, string>)

      await createService.mutateAsync({
        projectId,
        name: data.name,
        type: data.type,
        dockerfilePath: data.dockerfilePath,
        buildContext: data.buildContext,
        port: data.port || undefined,
        healthCheckPath: data.healthCheckPath,
        environmentVariables: Object.keys(environmentVariables).length > 0 ? environmentVariables : undefined,
        buildArguments: Object.keys(buildArguments).length > 0 ? buildArguments : undefined,
      })

      // Reset form and close dialog
      form.reset()
      setEnvVars([])
      setBuildArgs([])
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

  const addBuildArg = () => {
    setBuildArgs([...buildArgs, { key: '', value: '' }])
  }

  const removeBuildArg = (index: number) => {
    setBuildArgs(buildArgs.filter((_, i) => i !== index))
  }

  const updateBuildArg = (index: number, field: 'key' | 'value', value: string) => {
    const newBuildArgs = [...buildArgs]
    newBuildArgs[index][field] = value
    setBuildArgs(newBuildArgs)
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
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                    name="dockerfilePath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dockerfile Path</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Dockerfile" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Relative path to Dockerfile
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="buildContext"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Build Context</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="." 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          Docker build context path
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

            {/* Build Arguments */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Build Arguments</CardTitle>
                  <Button type="button" variant="outline" size="sm" onClick={addBuildArg}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Argument
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {buildArgs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No build arguments defined
                  </p>
                ) : (
                  <div className="space-y-3">
                    {buildArgs.map((buildArg, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <Input
                          placeholder="ARG_NAME"
                          value={buildArg.key}
                          onChange={(e) => updateBuildArg(index, 'key', e.target.value)}
                        />
                        <span className="text-muted-foreground">=</span>
                        <Input
                          placeholder="value"
                          value={buildArg.value}
                          onChange={(e) => updateBuildArg(index, 'value', e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBuildArg(index)}
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