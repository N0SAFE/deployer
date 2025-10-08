'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useService } from '@/hooks/useServices'
import { useProviderSchema } from '@/hooks/useProviderBuilder'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Form,
  FormLabel,
} from '@repo/ui/components/shadcn/form'
import { 
  Box,
  Cloud,
  Info,
  AlertCircle,
  Save,
  Loader2
} from 'lucide-react'
import DynamicConfigForm from '@/components/services/DynamicConfigForm'

const providerConfigSchema = z.object({
  providerConfig: z.record(z.string(), z.unknown()).optional(),
})

type ProviderConfigFormData = z.infer<typeof providerConfigSchema>

interface ProviderConfigurationClientProps {
  params: {
    projectId: string
    serviceId: string
  }
}

export function ProviderConfigurationClient({ params }: ProviderConfigurationClientProps) {
  const { data: service } = useService(params.serviceId)
  const { data: providerSchema, isLoading: providerSchemaLoading, error: providerSchemaError } = useProviderSchema(service?.providerId)

  const form = useForm<ProviderConfigFormData>({
    resolver: zodResolver(providerConfigSchema),
    defaultValues: {
      providerConfig: {},
    },
  })

  // Update form when service data loads
  useEffect(() => {
    if (service?.providerConfig) {
      form.reset({
        providerConfig: service.providerConfig as Record<string, unknown>,
      })
    }
  }, [service, form])

  const onSubmit = async (data: ProviderConfigFormData) => {
    console.log('Provider config updated:', data)
    // TODO: Implement API call to update service provider config
  }

  const getProviderLabel = (provider: string) => {
    const labels = {
      docker: 'Docker',
      kubernetes: 'Kubernetes',
      aws: 'AWS',
      gcp: 'Google Cloud Platform',
      azure: 'Microsoft Azure',
      local: 'Local'
    }
    return labels[provider as keyof typeof labels] || provider
  }

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading provider configuration...</p>
      </div>
    )
  }

  if (providerSchemaError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Error Loading Provider Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load provider configuration schema: {providerSchemaError.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Provider Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5" />
              Deployment Provider
            </CardTitle>
            <CardDescription>
              Current deployment provider and configuration schema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Provider</FormLabel>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-sm">
                  {getProviderLabel(service.providerId)}
                </Badge>
                {providerSchema && (
                  <Badge variant="secondary" className="text-xs">
                    v{providerSchema.version}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The deployment provider used for this service
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Dynamic Provider Configuration */}
        {providerSchemaLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading provider configuration...</p>
              </div>
            </CardContent>
          </Card>
        ) : providerSchema ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 justify-between">
                <span className="flex items-center gap-2">
                  <Cloud className="h-5 w-5" />
                  {providerSchema.title}
                </span>
                <Badge variant="outline">{providerSchema.version}</Badge>
              </CardTitle>
              <CardDescription>
                {providerSchema.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DynamicConfigForm
                schema={providerSchema}
                form={form}
                fieldPrefix="providerConfig"
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground text-center">
                No configuration schema available for this provider
              </p>
            </CardContent>
          </Card>
        )}

        {/* Provider Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Provider Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
                <div className="flex items-start gap-2">
                  <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-800 mb-2">
                      Provider Configuration Tips
                    </p>
                    <ul className="text-sm text-blue-700 space-y-1">
                      <li>• Configure provider-specific settings here</li>
                      <li>• Some settings may require service restart</li>
                      <li>• Validate credentials before saving</li>
                      <li>• Check provider documentation for advanced options</li>
                    </ul>
                  </div>
                </div>
              </div>

              {service.providerId === 'docker' && (
                <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800 mb-2">
                        Docker Provider
                      </p>
                      <p className="text-sm text-yellow-700">
                        Ensure Docker daemon is accessible and has sufficient resources allocated.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {service.providerId === 'kubernetes' && (
                <div className="p-4 border border-purple-200 bg-purple-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-purple-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-purple-800 mb-2">
                        Kubernetes Provider
                      </p>
                      <p className="text-sm text-purple-700">
                        Verify cluster access and namespace permissions before deployment.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline">
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {form.formState.isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
