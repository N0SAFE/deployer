'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Siren, Save } from 'lucide-react'
import { toast } from 'sonner'
import { ENV_NAMES } from '@repo/contracts-common'
import { ServiceConfigSubNav } from '../_components/service-config-subnav'
import { z } from 'zod/v4'

const identitySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  type: z.string().min(1, 'Type is required'),
  providerId: z.string().optional(),
})

export default function DashboardServiceConfigurationPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId ?? ''
  const serviceId = params.serviceId ?? ''

  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const updateService = useUpdateService()
  const service = (serviceData ?? null) as Record<string, unknown> | null

  const identityForm = useForm({
    defaultValues: { name: '', description: '', type: '', providerId: '' },
    onSubmit: async ({ value }) => {
      const parsed = identitySchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      try {
        await updateService.mutateAsync({
          id: serviceId,
          name: parsed.data.name,
          type: (parsed.data.type || undefined) as never,
          description: parsed.data.description?.trim() || undefined,
        })
        toast.success('Service identity updated')
      } catch (err) {
        toast.error('Failed to update service', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })

  useEffect(() => {
    if (!service) return
    identityForm.reset({
      name: (service.name as string) ?? '',
      description: (service.description as string) ?? '',
      type: (service.type as string) ?? '',
      providerId: (service.providerId as string) ?? '',
    })
  }, [service])

  if (serviceLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!service) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="general" />

      {/* Identity section */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Basic service metadata.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <identityForm.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
              </div>
            )}
          </identityForm.Field>
          <identityForm.Field name="description">
            {(field) => (
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
              </div>
            )}
          </identityForm.Field>
          <div className="grid grid-cols-2 gap-4">
            <identityForm.Field name="type">
              {(field) => (
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                </div>
              )}
            </identityForm.Field>
            <identityForm.Field name="providerId">
              {(field) => (
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} disabled />
                </div>
              )}
            </identityForm.Field>
          </div>
          <identityForm.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button onClick={identityForm.handleSubmit} disabled={isSubmitting || updateService.isPending}>
                <Save className="mr-2 size-4" />
                {updateService.isPending ? 'Saving...' : 'Save'}
              </Button>
            )}
          </identityForm.Subscribe>
        </CardContent>
      </Card>

      {/* Service Details (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Service Details</CardTitle>
          <CardDescription>Read-only service metadata from the API.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <Label>ID</Label>
              <p className="text-muted-foreground font-mono">{String((service.id as string) ?? '-')}</p>
            </div>
            <div>
              <Label>Project</Label>
              <p className="text-muted-foreground">{String((service.projectId as string) ?? (service.project_id as string) ?? '-')}</p>
            </div>
            <div>
              <Label>Status</Label>
              <p><Badge variant="outline">{(service.status as string) ?? (service.state as string) ?? 'unknown'}</Badge></p>
            </div>
            <div>
              <Label>Provider Type</Label>
              <p className="text-muted-foreground">{(service.providerType as string) ?? (service.provider_type as string) ?? 'Not configured'}</p>
            </div>
            <div>
              <Label>Runner Type</Label>
              <p className="text-muted-foreground">{(service.runnerType as string) ?? (service.runner_type as string) ?? 'Not configured'}</p>
            </div>
            <div>
              <Label>Environments</Label>
              <p className="text-muted-foreground">{ENV_NAMES?.length ?? 0} available</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
