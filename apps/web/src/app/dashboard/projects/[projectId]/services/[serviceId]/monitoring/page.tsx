'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useProject } from '@/domains/project/hooks'
import { useService, useServiceDependencies } from '@/domains/service/hooks'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, Activity } from 'lucide-react'
import { ENV_NAMES } from '@repo/contracts-common'
import { statusBadgeVariant } from '../../../_utils/helpers'

const LIST_INPUT = { query: { limit: 300, offset: 0 } } as const

export default function DashboardServiceMonitoringPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId ?? ''
  const serviceId = params.serviceId ?? ''

  const { data: projectData, isLoading: projectLoading } = useProject(projectId)
  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const { data: depsData } = useServiceDependencies(serviceId)
  const { data: containerData } = useDockerContainerList(LIST_INPUT)

  const replicas = useMemo(() => {
    return (containerData?.data ?? [])
      .filter((c: any) => c.projectId === projectId && c.serviceId === serviceId)
  }, [containerData?.data, projectId, serviceId])

  const dependencies = useMemo(() => {
    if (!depsData) return []
    return Array.isArray(depsData) ? depsData : (depsData as any).dependencies ?? []
  }, [depsData])

  if (projectLoading || serviceLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!projectData || !serviceData) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Not found</AlertTitle>
        <AlertDescription>The requested service or project could not be found.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{ENV_NAMES.length} environments</Badge>
        <Badge variant="outline">{dependencies.length} dependencies</Badge>
        <Badge variant="outline">{replicas.length} replicas</Badge>
      </div>

      {/* Environment health cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ENV_NAMES.map((env) => {
          const envReplicas = replicas.filter((r: any) => r.environment === env)
          const healthy = envReplicas.filter((r: any) => ['healthy', 'passing', 'running'].includes((r.health ?? '').toLowerCase()))
          const allHealthy = envReplicas.length > 0 && healthy.length === envReplicas.length
          return (
            <Card key={env} className={allHealthy ? 'border-emerald-500/40' : envReplicas.length > 0 ? 'border-amber-500/40' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base capitalize">{env}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="text-2xl font-bold">{envReplicas.length}</p>
                  <p className="text-xs text-muted-foreground">{healthy.length} healthy replica{healthy.length === 1 ? '' : 's'}</p>
                  <Badge variant={allHealthy ? 'default' : envReplicas.length > 0 ? 'secondary' : 'outline'}>
                    {envReplicas.length === 0 ? 'No replicas' : allHealthy ? 'Healthy' : 'Degraded'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Replica status */}
      {replicas.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Replicas</CardTitle><CardDescription>Container-level health for this service.</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replicas.map((r: any, i: number) => (
                  <TableRow key={r.id ?? i}>
                    <TableCell className="font-mono text-xs">{r.name ?? r.containerName ?? r.container_name ?? r.id}</TableCell>
                    <TableCell className="capitalize">{r.environment ?? '—'}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(r.status ?? 'unknown') as 'default' | 'secondary' | 'destructive' | 'outline'} className="capitalize">{r.status ?? 'unknown'}</Badge></TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(r.health ?? 'unknown') as 'default' | 'secondary' | 'destructive' | 'outline'} className="capitalize">{r.health ?? 'unknown'}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Dependency telemetry */}
      <Card>
        <CardHeader>
          <CardTitle>Dependency Telemetry</CardTitle>
          <CardDescription>Service dependencies and their routing state.</CardDescription>
        </CardHeader>
        <CardContent>
          {dependencies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No dependencies</p>
              <p className="text-sm text-muted-foreground">This service has no declared dependencies.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target Service</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Enabled In</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dependencies.map((dep: any, i: number) => (
                  <TableRow key={dep.id ?? i}>
                    <TableCell className="font-mono text-xs">
                      {dep.targetId ?? dep.target_service_id ?? dep.dependsOnServiceId ?? dep.depends_on_service_id ?? '-'}
                    </TableCell>
                    <TableCell><Badge variant="outline">{dep.type ?? 'default'}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {dep.enabledIn?.join(', ') ?? 'all environments'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
