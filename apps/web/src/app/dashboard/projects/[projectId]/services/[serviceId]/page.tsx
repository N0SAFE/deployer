'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  MOCK_DEPENDENCIES_BY_PROJECT,
  MOCK_DEPLOYMENTS,
  MOCK_INCIDENTS,
  MOCK_NOTIFICATIONS,
  MOCK_PROJECTS,
  MOCK_SERVICE_CONFIGS_BY_PROJECT,
  MOCK_SERVICES_BY_PROJECT,
} from '@/mocks/platform'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowLeft, BarChart3, FileText, Layers3, Settings } from 'lucide-react'
import { ENV_NAMES } from '@repo/contracts-common'
import { ServiceSectionNav } from './_components/service-section-nav'
import { ServiceOpsOverviewCards } from './_components/service-ops-overview-cards'

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy' || normalized === 'passing') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'down' || normalized === 'failing') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'degraded' || normalized === 'warning') {
    return 'secondary'
  }
  return 'outline'
}

export default function DashboardServiceOverviewPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const project = useMemo(() => MOCK_PROJECTS.find((item) => item.id === projectId) ?? null, [projectId])
  const services = useMemo(() => MOCK_SERVICES_BY_PROJECT[projectId] ?? [], [projectId])
  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])
  const serviceConfig = useMemo(() => MOCK_SERVICE_CONFIGS_BY_PROJECT[projectId]?.[serviceId] ?? null, [projectId, serviceId])

  const dependencies = useMemo(
    () => (MOCK_DEPENDENCIES_BY_PROJECT[projectId] ?? []).filter((dependency) => dependency.serviceId === serviceId),
    [projectId, serviceId],
  )
  const deployments = useMemo(
    () => MOCK_DEPLOYMENTS.filter((deployment) => deployment.projectId === projectId).slice(0, 8),
    [projectId],
  )
  const incidents = useMemo(
    () => MOCK_INCIDENTS.filter((incident) => incident.projectId === projectId && incident.affectedServiceIds.includes(serviceId)),
    [projectId, serviceId],
  )
  const notifications = useMemo(
    () => MOCK_NOTIFICATIONS.filter((notification) => notification.projectId === projectId),
    [projectId],
  )

  const healthByEnvironment = useMemo(() => {
    if (!serviceConfig) return []

    return ENV_NAMES
      .map((env) => {
        const status = serviceConfig.statusByEnvironment[env] ?? serviceConfig.statusByEnvironment.production
        return {
          env,
          health: status.health,
          lifecycle: status.lifecycle,
        }
      })
      .filter((item, index, arr) => arr.findIndex((candidate) => candidate.env === item.env) === index)
  }, [serviceConfig])

  if (!project) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>This project does not exist in the mock entities dataset.</AlertDescription>
      </Alert>
    )
  }

  if (!service) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist in the selected project mock dataset.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link href={`/dashboard/projects/${projectId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to project
            </Link>
          </Button>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{service.name}</h1>
            <p className="text-sm text-muted-foreground">
              Service workspace organized in focused pages: overview, configuration, deployments, logs, previews and monitoring.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/projects/${projectId}/configuration`}>Project configuration</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/configuration`}>
              <Settings className="mr-2 h-4 w-4" />
              Configure service
            </Link>
          </Button>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="overview" />

  <ServiceOpsOverviewCards projectId={projectId} serviceId={serviceId} />

      <div className="rounded-xl border border-border/60 bg-card/30 p-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">type {service.type}</Badge>
          <Badge variant="outline">runtime {service.runtime}</Badge>
          <Badge variant={service.isActive ? 'default' : 'secondary'}>{service.isActive ? 'active' : 'inactive'}</Badge>
          <Badge variant="outline">layer {service.layer}</Badge>
          {healthByEnvironment.slice(0, 3).map((item) => (
            <Badge key={item.env} variant={toBadgeVariant(item.health)}>
              {item.env} {item.health}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{service.description}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Dependencies</CardDescription>
            <CardTitle>{dependencies.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deployments (sampled)</CardDescription>
            <CardTitle>{deployments.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Incidents</CardDescription>
            <CardTitle>{incidents.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Notifications</CardDescription>
            <CardTitle>{notifications.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Service workspace map</CardTitle>
          <CardDescription>Same visual system, split into dedicated pages for faster workflows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Configuration</CardTitle>
              <CardDescription>General, provider, network, and environment sections.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/configuration`}>
                  <Settings className="mr-2 h-4 w-4" />
                  Open configuration
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Deployments</CardTitle>
              <CardDescription>Deployment status timeline for this service.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/deployments`}>
                  <Layers3 className="mr-2 h-4 w-4" />
                  Open deployments
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Logs</CardTitle>
              <CardDescription>Recent operational logs and deployment traces.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/logs`}>
                  <FileText className="mr-2 h-4 w-4" />
                  Open logs
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Previews</CardTitle>
              <CardDescription>Preview environments related to this service/project.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/previews`}>
                  <Layers3 className="mr-2 h-4 w-4" />
                  Open previews
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Monitoring</CardTitle>
              <CardDescription>Health and latency metrics by environment.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href={`/dashboard/projects/${projectId}/services/${serviceId}/monitoring`}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Open monitoring
                </Link>
              </Button>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
