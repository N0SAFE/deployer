'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Activity } from 'lucide-react'
import { useProject } from '@/domains/project/hooks'
import { useService, useServiceDependencies } from '@/domains/service/hooks'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ENV_NAMES } from '@repo/contracts-common'
import { EmptyState, StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import { InlineError, SectionHeading } from '../../../../_components/workload/WorkloadStates'

const LIST_INPUT = { query: { limit: 300, offset: 0 } } as const

function percent(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${value.toFixed(1)}%`
}

export default function DashboardServiceMonitoringPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const projectQuery = useProject(projectId)
  const serviceQuery = useService(serviceId)
  const depsQuery = useServiceDependencies(serviceId)
  const containersQuery = useDockerContainerList(LIST_INPUT)

  const replicas = useMemo(
    () => (containersQuery.data?.data ?? []).filter((c) => c.projectId === projectId && c.serviceId === serviceId),
    [containersQuery.data, projectId, serviceId],
  )
  const dependencies = useMemo(() => depsQuery.data?.dependencies ?? [], [depsQuery.data])

  if (projectQuery.isLoading || serviceQuery.isLoading) {
    return <PageSkeleton label="Loading monitoring" blocks={2} />
  }
  const loadError = projectQuery.error ?? serviceQuery.error
  if (loadError) {
    return <InlineError title="Could not load this service" error={loadError} onRetry={() => { void projectQuery.refetch(); void serviceQuery.refetch() }} />
  }
  if (!projectQuery.data || !serviceQuery.data) {
    return <InlineError title="Service not found" error={new Error('The service or its project does not exist.')} />
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Monitoring"
        description="Health of this service’s containers right now, per environment. Values are the latest snapshot, not a history."
      />

      {containersQuery.isError ? (
        <InlineError title="Could not load containers" error={containersQuery.error} onRetry={() => void containersQuery.refetch()} />
      ) : (
        <StatStrip>
          {ENV_NAMES.map((env) => {
            const inEnv = replicas.filter((r) => r.environment === env)
            const healthy = inEnv.filter((r) => r.health === 'healthy').length
            return (
              <StatStripItem
                key={env}
                label={env}
                value={containersQuery.isLoading || inEnv.length === 0 ? undefined : inEnv.length}
                hint={containersQuery.isLoading ? 'loading' : inEnv.length === 0 ? 'no containers' : `${String(healthy)}/${String(inEnv.length)} healthy`}
                tone={inEnv.length > 0 ? (healthy === inEnv.length ? 'live' : 'pending') : undefined}
              />
            )
          })}
        </StatStrip>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Containers</CardTitle>
          <CardDescription>CPU and memory are percentages of the container’s limit at the last refresh.</CardDescription>
        </CardHeader>
        <CardContent>
          {containersQuery.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">Loading containers…</p>
          ) : replicas.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No containers running for this service"
              description="Nothing to monitor yet. Deploy the service and its containers will appear here with their health, CPU and memory."
              compact
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead className="text-right">CPU</TableHead>
                    <TableHead className="text-right">Memory</TableHead>
                    <TableHead className="text-right">Restarts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replicas.map((r) => (
                    <TableRow key={r.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-xs">{r.name}</TableCell>
                      <TableCell className="capitalize">{r.environment}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell><StatusBadge status={r.health} /></TableCell>
                      <TableCell className="text-right tabular-nums">{percent(r.cpuPercent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{percent(r.memoryPercent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.restartCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dependencies</CardTitle>
          <CardDescription>Services this one depends on.</CardDescription>
        </CardHeader>
        <CardContent>
          {depsQuery.isError ? (
            <InlineError title="Could not load dependencies" error={depsQuery.error} onRetry={() => void depsQuery.refetch()} />
          ) : depsQuery.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">Loading dependencies…</p>
          ) : dependencies.length === 0 ? (
            <EmptyState icon={Activity} title="No dependencies" description="This service has no declared dependencies." compact />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Depends on</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dependencies.map((dep) => (
                    <TableRow key={dep.id}>
                      <TableCell className="font-medium">{dep.dependsOnService.name}</TableCell>
                      <TableCell><Badge variant="outline">{dep.dependsOnService.type}</Badge></TableCell>
                      <TableCell className="text-sm">{dep.isRequired ? 'Required' : 'Optional'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
