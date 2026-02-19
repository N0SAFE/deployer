'use client'

import { useState } from 'react'
import { useServices } from '@/hooks/useServices'
import { useDeploymentActions } from '@/hooks/useDeployments'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { 
  Rocket, 
  GitBranch, 
  Globe,
  Server,
  Settings,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'

const deploymentSchema = z.object({
  serviceId: z.string().min(1, 'Please select a service'),
  environment: z.enum(['production', 'staging', 'preview', 'development']),
  sourceType: z.enum(['git', 'github', 'gitlab', 'upload']),
  sourceConfig: z.object({
    repositoryUrl: z.string().optional(),
    branch: z.string().default('main'),
    commitSha: z.string().optional(),
    pullRequestNumber: z.number().optional(),
    fileName: z.string().optional(),
    fileSize: z.number().optional(),
    customData: z.record(z.string(), z.any()).optional(),
  }),
  environmentVariables: z.string().optional(), // Will be parsed as key=value pairs
  notes: z.string().optional(),
})

type DeploymentFormData = z.infer<typeof deploymentSchema>

interface NewDeploymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  preselectedServiceId?: string
}

export default function NewDeploymentDialog({
  open,
  onOpenChange,
  projectId,
  preselectedServiceId
}: NewDeploymentDialogProps) {
  const [isAdvancedMode, setIsAdvancedMode] = useState(false)
  
  const { data: servicesData, isLoading: servicesLoading } = useServices(projectId)
  const services = servicesData?.services || []
  
  const { triggerDeployment, isLoading } = useDeploymentActions()

  const form = useForm<DeploymentFormData>({
    resolver: zodResolver(deploymentSchema),
    defaultValues: {
      serviceId: preselectedServiceId || '',
      environment: 'production',
      sourceType: 'git',
      sourceConfig: {
        branch: 'main',
      },
    },
  })

  const selectedServiceId = form.watch('serviceId')
  const selectedService = services.find(s => s.id === selectedServiceId)
  const environment = form.watch('environment')
  const sourceType = form.watch('sourceType')

  const onSubmit = async (data: DeploymentFormData) => {
    try {
      // Parse environment variables if provided
      let parsedEnvVars = {}
      if (data.environmentVariables) {
        try {
          // Simple parsing: KEY=VALUE format, one per line
          const lines = data.environmentVariables.split('\n').filter(line => line.trim())
          parsedEnvVars = lines.reduce((acc, line) => {
            const [key, ...values] = line.split('=')
            if (key && values.length > 0) {
              acc[key.trim()] = values.join('=').trim()
            }
            return acc
          }, {} as Record<string, string>)
        } catch (error) {
          console.warn('Failed to parse environment variables:', error)
        }
      }

      await triggerDeployment({
        serviceId: data.serviceId,
        environment: data.environment,
        sourceType: data.sourceType,
        sourceConfig: data.sourceConfig,
        environmentVariables: parsedEnvVars,
      })

      toast.success('Deployment triggered successfully!')
      onOpenChange(false)
      form.reset()
    } catch (error) {
      console.error('Failed to trigger deployment:', error)
      toast.error('Failed to trigger deployment')
    }
  }

  const getEnvironmentDescription = (env: string) => {
    switch (env) {
      case 'production':
        return 'Live environment for end users'
      case 'staging':
        return 'Pre-production testing environment'
      case 'preview':
        return 'Feature preview environment'
      case 'development':
        return 'Development and testing environment'
      default:
        return ''
    }
  }

  const getSourceTypeDescription = (type: string) => {
    switch (type) {
      case 'git':
        return 'Deploy from generic Git repository'
      case 'github':
        return 'Deploy from GitHub repository with PR integration'
      case 'gitlab':
        return 'Deploy from GitLab repository with MR integration'
      case 'upload':
        return 'Deploy from uploaded ZIP file'
      default:
        return ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Rocket className="h-5 w-5" />
            <span>New Deployment</span>
          </DialogTitle>
          <DialogDescription>
            Configure and trigger a new deployment for your service
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Service Selection */}
            <FormField
              control={form.control}
              name="serviceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center space-x-2">
                    <Server className="h-4 w-4" />
                    <span>Service</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a service to deploy" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {servicesLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="ml-2">Loading services...</span>
                        </div>
                      ) : services.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-muted-foreground">
                          <AlertCircle className="h-4 w-4 mr-2" />
                          No services available
                        </div>
                      ) : (
                        services.map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            <div className="flex items-center space-x-2">
                              <span>{service.name}</span>
                              <Badge variant="outline" className="text-xs">
                                {service.type}
                              </Badge>
                              {!service.isActive && (
                                <Badge variant="destructive" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                  {selectedService && (
                    <div className="text-sm text-muted-foreground">
                      Port: {selectedService.port || 'Not configured'} • 
                      Health Check: {selectedService.healthCheckPath || 'None'}
                    </div>
                  )}
                </FormItem>
              )}
            />

            {/* Environment Selection */}
            <FormField
              control={form.control}
              name="environment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center space-x-2">
                    <Globe className="h-4 w-4" />
                    <span>Environment</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="production">
                        <div>
                          <div className="font-medium">Production</div>
                          <div className="text-xs text-muted-foreground">Live environment</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="staging">
                        <div>
                          <div className="font-medium">Staging</div>
                          <div className="text-xs text-muted-foreground">Pre-production testing</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="preview">
                        <div>
                          <div className="font-medium">Preview</div>
                          <div className="text-xs text-muted-foreground">Feature previews</div>
                        </div>
                      </SelectItem>
                      <SelectItem value="development">
                        <div>
                          <div className="font-medium">Development</div>
                          <div className="text-xs text-muted-foreground">Development testing</div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {getEnvironmentDescription(environment)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Source Configuration */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center space-x-2 text-base">
                  <GitBranch className="h-4 w-4" />
                  <span>Source Configuration</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="sourceType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="git">Generic Git</SelectItem>
                          <SelectItem value="github">GitHub</SelectItem>
                          <SelectItem value="gitlab">GitLab</SelectItem>
                          <SelectItem value="upload">File Upload</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {getSourceTypeDescription(sourceType)}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {sourceType !== 'upload' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="sourceConfig.branch"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Branch</FormLabel>
                            <FormControl>
                              <Input placeholder="main" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                    </div>

                    <FormField
                      control={form.control}
                      name="sourceConfig.commitSha"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Specific Commit (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="abc123def456..." {...field} />
                          </FormControl>
                          <FormDescription>
                            Deploy a specific commit instead of branch
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Advanced Configuration */}
            <div className="space-y-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsAdvancedMode(!isAdvancedMode)}
                className="flex items-center space-x-2"
              >
                <Settings className="h-4 w-4" />
                <span>Advanced Configuration</span>
              </Button>

              {isAdvancedMode && (
                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <FormField
                      control={form.control}
                      name="environmentVariables"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Environment Variables</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="NODE_ENV=production&#10;API_KEY=your-api-key"
                              className="min-h-24"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            One variable per line in KEY=VALUE format
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Deployment Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Add notes about this deployment..."
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Optional notes about this deployment
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              )}
            </div>

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading.trigger || !selectedServiceId}
              >
                {isLoading.trigger ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Deploy
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}