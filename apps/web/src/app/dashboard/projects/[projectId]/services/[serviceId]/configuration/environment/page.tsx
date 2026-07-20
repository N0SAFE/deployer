'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft } from 'lucide-react'
import { ServiceSectionNav } from '../../_components/service-section-nav'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'

export default function DashboardServiceConfigurationEnvironmentPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])

  if (!project || !service || !serviceConfig) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Environment config not found</AlertTitle>
        <AlertDescription>Unable to load service environment configuration.</AlertDescription>
      </Alert>
    )
  }

  const overrides = Object.entries(serviceConfig.executionOverrides)

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
          <h1 className="text-2xl font-semibold tracking-tight">Environment configuration</h1>
          <p className="text-sm text-muted-foreground">Environment-specific runtime overrides and health state.</p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="configuration" />
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="environment" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">overrides {overrides.length}</Badge>
          <Badge variant="default">enabled {overrides.filter(([, override]) => !override.disabled).length}</Badge>
          <Badge variant="secondary">disabled {overrides.filter(([, override]) => Boolean(override.disabled)).length}</Badge>
          <Badge variant="outline">env-specific replica envelopes</Badge>
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Execution overrides</CardTitle>
          <CardDescription>Same information scope as v2 environment tab.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {overrides.map(([env, override]) => (
            <div key={env} className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium capitalize">{env}</p>
                <Badge variant={override.disabled ? 'outline' : 'default'}>{override.disabled ? 'disabled' : 'enabled'}</Badge>
              </div>
              <p><span className="text-muted-foreground">Strategy:</span> {override.strategy ?? serviceConfig.runnerConfig.strategy}</p>
              <p><span className="text-muted-foreground">Replicas:</span> {override.replicas?.min ?? serviceConfig.minReplicas} → {override.replicas?.max ?? serviceConfig.maxReplicas}</p>
              <p><span className="text-muted-foreground">Health:</span> {serviceConfig.statusByEnvironment[env]?.health ?? serviceConfig.statusByEnvironment.production.health}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">
                  deps mode {override.dependencyLinkPolicy ? override.dependencyLinkPolicy.target.mode : 'same-environment'}
                </Badge>
                <Badge variant="outline">
                  provisioning {override.dependencyLinkPolicy ? override.dependencyLinkPolicy.provisioning.provisioningMode : 'default'}
                </Badge>
              </div>
            </div>
          ))}
          <Button asChild variant="outline">
            <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/configuration/general`}>Edit full environment settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
