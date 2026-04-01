'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { MOCK_PROJECTS, MOCK_SERVICE_CONFIGS_BY_PROJECT, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowLeft } from 'lucide-react'
import { ServiceSectionNav } from '../_components/service-section-nav'
import { MOCK_DEPENDENCIES_BY_PROJECT } from '@/mocks/platform'

export default function DashboardServiceMonitoringPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const project = useMemo(() => MOCK_PROJECTS.find((item) => item.id === projectId) ?? null, [projectId])
  const services = useMemo(() => MOCK_SERVICES_BY_PROJECT[projectId] ?? [], [projectId])
  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])
  const serviceConfig = useMemo(() => MOCK_SERVICE_CONFIGS_BY_PROJECT[projectId]?.[serviceId] ?? null, [projectId, serviceId])

  const envStatus = useMemo(() => {
    if (!serviceConfig) return []
    return Object.entries(serviceConfig.statusByEnvironment)
  }, [serviceConfig])

  const dependencyRows = useMemo(() => {
    return (MOCK_DEPENDENCIES_BY_PROJECT[projectId] ?? []).filter(
      (dependency) => dependency.serviceId === serviceId || dependency.dependsOnServiceId === serviceId,
    )
  }, [projectId, serviceId])

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

  if (!serviceConfig) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Configuration missing</AlertTitle>
        <AlertDescription>No runtime configuration found for this service.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/dashboard/projects/${projectId}/services/${serviceId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to service
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service monitoring</h1>
          <p className="text-sm text-muted-foreground">Health and reliability indicators by environment.</p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="monitoring" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{envStatus.length} env snapshots</Badge>
          <Badge variant="outline">{dependencyRows.length} dependency edges</Badge>
          <Badge variant="default">{envStatus.filter(([, status]) => status.health === 'passing').length} passing</Badge>
          <Badge variant="secondary">{envStatus.filter(([, status]) => status.health === 'warning').length} warning</Badge>
          <Badge variant="destructive">{envStatus.filter(([, status]) => status.health === 'failing').length} failing</Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {envStatus.map(([env, status]) => (
          <Card key={env} className="border-border/60 bg-card/40 backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardDescription>{env}</CardDescription>
              <CardTitle className="text-base">{status.health}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Lifecycle</span>
                <Badge variant="outline">{status.lifecycle}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Latency</span>
                <span>{status.averageLatencyMs}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Error rate</span>
                <span>{status.errorRatePercent}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Uptime</span>
                <span>{status.uptimePercent}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Dependency + environment telemetry</CardTitle>
          <CardDescription>
            Monitoring context includes dependency edges and environment-specific propagation.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Edge</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Enabled in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dependencyRows.map((dependency) => {
                const isOutgoing = dependency.serviceId === serviceId
                return (
                  <TableRow key={dependency.id}>
                    <TableCell className="font-mono text-xs">
                      {dependency.serviceId} → {dependency.dependsOnServiceId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isOutgoing ? 'default' : 'secondary'}>{isOutgoing ? 'outgoing' : 'incoming'}</Badge>
                    </TableCell>
                    <TableCell>{dependency.enabledIn?.join(', ') ?? 'all envs'}</TableCell>
                  </TableRow>
                )
              })}
              {dependencyRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                    No dependency telemetry edges found for this service.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
