'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft } from 'lucide-react'
import { ServiceSectionNav } from '../../_components/service-section-nav'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { Badge } from '@repo/ui/components/shadcn/badge'

export default function DashboardServiceConfigurationNetworkPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])

  if (!project || !service || !serviceConfig) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Network config not found</AlertTitle>
        <AlertDescription>Unable to load service network configuration.</AlertDescription>
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
          <h1 className="text-2xl font-semibold tracking-tight">Network configuration</h1>
          <p className="text-sm text-muted-foreground">Runtime network and port settings for this service.</p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="configuration" />
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="network" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">network {serviceConfig.runnerConfig.networkMode}</Badge>
          <Badge variant="outline">ports {serviceConfig.runnerConfig.ports.length}</Badge>
          <Badge variant="outline">volumes {serviceConfig.runnerConfig.volumeMounts.length}</Badge>
          <Badge variant="outline">secrets {serviceConfig.runnerConfig.secretRefs.length}</Badge>
          <Badge variant="outline">health {serviceConfig.healthCheck.protocol}</Badge>
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Network + ports</CardTitle>
          <CardDescription>v2-equivalent network tab content in the updated UI style.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p><span className="text-muted-foreground">Network mode:</span> {serviceConfig.runnerConfig.networkMode}</p>
            <p><span className="text-muted-foreground">Ports:</span> {serviceConfig.runnerConfig.ports.join(', ') || '—'}</p>
            <p><span className="text-muted-foreground">Volume mounts:</span> {serviceConfig.runnerConfig.volumeMounts.join(', ') || '—'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">graceful shutdown {serviceConfig.runnerConfig.gracefulShutdownSeconds}s</Badge>
              <Badge variant="outline">secrets {serviceConfig.runnerConfig.secretRefs.length}</Badge>
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p><span className="text-muted-foreground">Health target:</span> {serviceConfig.healthCheck.target}</p>
            <p><span className="text-muted-foreground">Health protocol:</span> {serviceConfig.healthCheck.protocol}</p>
            <p><span className="text-muted-foreground">Interval / timeout:</span> {serviceConfig.healthCheck.intervalSeconds}s / {serviceConfig.healthCheck.timeoutSeconds}s</p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/configuration/general`}>Edit full network settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
