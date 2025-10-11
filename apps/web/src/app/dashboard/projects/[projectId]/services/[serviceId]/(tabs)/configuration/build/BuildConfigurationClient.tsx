'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useService } from '@/hooks/useServices'
import { useBuilderSchema } from '@/hooks/useProviderBuilder'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Form,
  FormLabel,
} from '@repo/ui/components/shadcn/form'
import { 
  Box,
  Wrench,
  Clock,
  AlertCircle,
  CheckCircle,
  Save,
  Loader2
} from 'lucide-react'
import DynamicConfigForm from '@/components/services/DynamicConfigForm'

const buildConfigSchema = z.object({
  builderConfig: z.record(z.string(), z.unknown()).optional(),
})

type BuildConfigFormData = z.infer<typeof buildConfigSchema>

interface BuildConfigurationClientProps {
  params: {
    id: string
    serviceId: string
  }
}

export function BuildConfigurationClient({ params }: BuildConfigurationClientProps) {
  const { data: service } = useService(params.serviceId)
  const { data: builderSchema, isLoading: builderSchemaLoading, error: builderSchemaError } = useBuilderSchema(service?.builderId)

  const form = useForm<BuildConfigFormData>({
    resolver: zodResolver(buildConfigSchema),
    defaultValues: {
      builderConfig: {},
    },
  })

  // Update form when service data loads
  useEffect(() => {
    if (service?.builderConfig) {
      form.reset({
        builderConfig: service.builderConfig as Record<string, unknown>,
      })
    }
  }, [service, form])

  const onSubmit = async (data: BuildConfigFormData) => {
    console.log('Build config updated:', data)
    // TODO: Implement API call to update service build config
  }

  const getBuilderLabel = (builder: string) => {
    const labels = {
      dockerfile: 'Dockerfile',
      nixpack: 'Nixpack',
      railpack: 'Railpack', 
      buildpack: 'Buildpack',
      static: 'Static',
      docker_compose: 'Docker Compose'
    }
    return labels[builder as keyof typeof labels] || builder
  }

  if (!service) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground">Loading build configuration...</p>
      </div>
    )
  }

  if (builderSchemaError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Error Loading Build Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Failed to load builder configuration schema: {builderSchemaError.message}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Builder Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5" />
              Build System
            </CardTitle>
            <CardDescription>
              Current builder and configuration schema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <FormLabel>Build Tool</FormLabel>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-sm">
                  {getBuilderLabel(service.builderId)}
                </Badge>
                {builderSchema && (
                  <Badge variant="secondary" className="text-xs">
                    v{builderSchema.version}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The build system used for this service
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Dynamic Builder Configuration */}
        {builderSchemaLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading builder configuration...</p>
              </div>
            </CardContent>
          </Card>
        ) : builderSchema ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 justify-between">
                <span className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  {builderSchema.title}
                </span>
                <Badge variant="outline">{builderSchema.version}</Badge>
              </CardTitle>
              <CardDescription>
                {builderSchema.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DynamicConfigForm
                schema={builderSchema}
                form={form}
                fieldPrefix="builderConfig"
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground text-center">
                No configuration schema available for this builder
              </p>
            </CardContent>
          </Card>
        )}

        {/* Build History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Builds
            </CardTitle>
            <CardDescription>
              History of recent build attempts and their status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Mock build history */}
              {[
                { id: '1', status: 'success', duration: '2m 34s', time: '2 hours ago', commit: 'feat: Add user auth' },
                { id: '2', status: 'success', duration: '1m 42s', time: '1 day ago', commit: 'fix: Database connection' },
                { id: '3', status: 'failed', duration: '45s', time: '2 days ago', commit: 'refactor: API endpoints' },
              ].map((build) => (
                <div key={build.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {build.status === 'success' ? (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                    <div>
                      <p className="font-medium text-sm">{build.commit}</p>
                      <p className="text-xs text-muted-foreground">
                        {build.duration} • {build.time}
                      </p>
                    </div>
                  </div>
                  <Badge variant={build.status === 'success' ? 'default' : 'destructive'}>
                    {build.status}
                  </Badge>
                </div>
              ))}
              
              <Button type="button" variant="outline" className="w-full">
                View All Builds
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Build Warnings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Build Configuration Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-800 mb-2">
                      Build Performance Tips
                    </p>
                    <ul className="text-sm text-blue-700 space-y-1">
                      <li>• Enable build caching for faster subsequent builds</li>
                      <li>• Use multi-stage Dockerfiles to reduce final image size</li>
                      <li>• Exclude unnecessary files with .dockerignore</li>
                      <li>• Consider using alpine-based images for smaller builds</li>
                    </ul>
                  </div>
                </div>
              </div>

              {service.builderId === 'dockerfile' && (
                <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800 mb-2">
                        Dockerfile Detected
                      </p>
                      <p className="text-sm text-yellow-700">
                        Make sure your Dockerfile is optimized for production and includes proper health checks.
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