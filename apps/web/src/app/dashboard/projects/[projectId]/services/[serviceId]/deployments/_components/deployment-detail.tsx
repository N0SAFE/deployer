'use client'

import { ExternalLink } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { EnvironmentBadge, StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import { AuthDashboardProjectsProjectIdServicesServiceIdLogs } from '@/routes'
import { formatDateTime } from '@/lib/format/date'
import { RelativeTime } from '../../../../../_components/workload/RelativeTime'
import { IdChip } from '../../../../../_components/workload/CopyButton'
import { deploymentDurationMs, deploymentStartedAt, formatDuration } from '../../../../../_utils/workload'
import { DeploymentLogsViewer } from './deployment-logs-viewer'

export interface DetailDeployment {
  id: string
  status: string
  environment: string
  sourceType: string
  containerImage: string | null
  domainUrl: string | null
  healthCheckUrl: string | null
  errorMessage: string | null
  triggeredBy: string | null
  createdAt: string | Date
  buildStartedAt: string | Date | null
  buildCompletedAt: string | Date | null
  deployStartedAt: string | Date | null
  deployCompletedAt: string | Date | null
}

export interface DetailReplica {
  id: string
  name: string
  status: string
  health: string
  cpuPercent: number | null
  memoryPercent: number | null
  restartCount: number
}

function percent(value: number | null): string {
  return value === null || Number.isNaN(value) ? '—' : `${value.toFixed(1)}%`
}

export function DeploymentDetail({
  deployment,
  replicas,
  projectId,
  serviceId,
  now,
}: {
  deployment: DetailDeployment
  replicas: readonly DetailReplica[]
  projectId: string
  serviceId: string
  now: number
}) {
  const healthy = replicas.filter((r) => r.health === 'healthy').length
  const url = deployment.domainUrl ?? deployment.healthCheckUrl
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={deployment.status} />
        <EnvironmentBadge environment={deployment.environment} />
        <Badge variant="outline">{deployment.sourceType}</Badge>
        <IdChip id={deployment.id} label="Copy deployment id" />
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link projectId={projectId} serviceId={serviceId}>
            Service activity
          </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
        </Button>
      </div>

      {deployment.errorMessage ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {deployment.errorMessage}
        </p>
      ) : null}

      <StatStrip bare>
        <StatStripItem label="Started" value={<RelativeTime value={deploymentStartedAt(deployment)} />} hint={formatDateTime(deploymentStartedAt(deployment))} />
        <StatStripItem label="Duration" value={formatDuration(deploymentDurationMs(deployment, deployment.status, now))} />
        <StatStripItem label="Initiated by" value={deployment.triggeredBy ?? undefined} />
        <StatStripItem
          label="Containers"
          value={replicas.length === 0 ? undefined : `${String(healthy)}/${String(replicas.length)} healthy`}
          hint={replicas.length === 0 ? 'none running in this environment' : undefined}
          tone={replicas.length === 0 ? undefined : healthy === replicas.length ? 'live' : 'pending'}
        />
      </StatStrip>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Image</dt>
        <dd className="break-all font-mono text-xs">{deployment.containerImage ?? '—'}</dd>
        <dt className="text-muted-foreground">URL</dt>
        <dd>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
              {url.replace(/^https?:\/\//, '')}
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : '—'}
        </dd>
      </dl>

      <section aria-label="Containers" className="space-y-2">
        <h3 className="text-sm font-semibold">Containers in {deployment.environment}</h3>
        {replicas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No container of this service is running in this environment.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">CPU</TableHead>
                  <TableHead className="text-right">Memory</TableHead>
                  <TableHead className="text-right">Restarts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replicas.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.name}</TableCell>
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
      </section>

      <section aria-label="Logs" className="space-y-2">
        <h3 className="text-sm font-semibold">Build and deploy output</h3>
        <DeploymentLogsViewer deploymentId={deployment.id} status={deployment.status} />
      </section>
    </div>
  )
}
