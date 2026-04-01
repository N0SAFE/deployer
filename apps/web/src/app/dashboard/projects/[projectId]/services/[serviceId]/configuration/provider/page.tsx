'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { MOCK_PROJECTS, MOCK_SERVICE_CONFIGS_BY_PROJECT, MOCK_SERVICE_PROVIDERS_BY_PROJECT, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft } from 'lucide-react'
import { ServiceSectionNav } from '../../_components/service-section-nav'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { Badge } from '@repo/ui/components/shadcn/badge'

export default function DashboardServiceConfigurationProviderPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const project = useMemo(() => MOCK_PROJECTS.find((item) => item.id === projectId) ?? null, [projectId])
  const services = useMemo(() => MOCK_SERVICES_BY_PROJECT[projectId] ?? [], [projectId])
  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])
  const providerEntity = useMemo(() => MOCK_SERVICE_PROVIDERS_BY_PROJECT[projectId]?.[serviceId] ?? null, [projectId, serviceId])
  const serviceConfig = useMemo(() => MOCK_SERVICE_CONFIGS_BY_PROJECT[projectId]?.[serviceId] ?? null, [projectId, serviceId])

  if (!project || !service) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>Unable to load project/service for provider configuration.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/configuration/general`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to configuration
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Provider configuration</h1>
          <p className="text-sm text-muted-foreground">Source and integration configuration scoped to this service.</p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="configuration" />
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="provider" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">provider {serviceConfig?.providerType ?? 'unknown'}</Badge>
          <Badge variant="outline">auth {serviceConfig?.providerConfig.authSecretRef ? 'configured' : 'missing'}</Badge>
          <Badge variant={serviceConfig?.providerConfig.webhookEnabled ? 'default' : 'secondary'}>
            webhook {serviceConfig?.providerConfig.webhookEnabled ? 'on' : 'off'}
          </Badge>
          <Badge variant={serviceConfig?.providerConfig.autoSyncEnabled ? 'default' : 'secondary'}>
            auto-sync {serviceConfig?.providerConfig.autoSyncEnabled ? 'on' : 'off'}
          </Badge>
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Provider details</CardTitle>
          <CardDescription>Same structure as v2 provider section, refreshed with current UI treatment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p><span className="text-muted-foreground">Provider type:</span> {serviceConfig?.providerType ?? '—'}</p>
            <p><span className="text-muted-foreground">Name:</span> {providerEntity?.name ?? '—'}</p>
            <p><span className="text-muted-foreground">Integration ref:</span> {providerEntity?.integrationRef ?? '—'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">sync {serviceConfig?.providerConfig.autoSyncEnabled ? 'enabled' : 'disabled'}</Badge>
              <Badge variant="outline">webhook {serviceConfig?.providerConfig.webhookEnabled ? 'enabled' : 'disabled'}</Badge>
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p><span className="text-muted-foreground">Source URL:</span> {serviceConfig?.providerConfig.sourceUrl ?? '—'}</p>
            <p><span className="text-muted-foreground">Branch:</span> {serviceConfig?.providerConfig.branch ?? '—'}</p>
            <p><span className="text-muted-foreground">Root path:</span> {serviceConfig?.providerConfig.rootPath ?? '—'}</p>
            <p><span className="text-muted-foreground">Build context:</span> {serviceConfig?.providerConfig.buildContext ?? '—'}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/configuration/general`}>Edit full provider settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
