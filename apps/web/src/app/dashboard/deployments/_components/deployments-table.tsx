'use client'

import { Button } from '@repo/ui/components/shadcn/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { RotateCw, ExternalLink } from 'lucide-react'
import { StatusBadge, EnvironmentBadge } from '@/components/dashboard'
import { AuthDashboardProjectsProjectIdServicesServiceId, AuthDashboardProjectsProjectIdServicesServiceIdDeployments } from '@/routes'
import { formatDateTime } from '@/lib/format/date'
import { RelativeTime } from '../../projects/_components/workload/RelativeTime'
import { IdChip } from '../../projects/_components/workload/CopyButton'
import { deploymentDurationMs, deploymentStartedAt, formatDuration } from '../../projects/_utils/workload'

export interface DeploymentTableRow {
  id: string
  serviceId: string
  status: string
  environment?: string | null
  triggeredBy?: string | null
  domainUrl?: string | null
  createdAt?: string | Date | null
  buildStartedAt?: string | Date | null
  buildCompletedAt?: string | Date | null
  deployStartedAt?: string | Date | null
  deployCompletedAt?: string | Date | null
}

export interface ServiceRef { name: string; projectId: string }

export function DeploymentsTable({
  rows,
  services,
  now,
  retryPending,
  onRetry,
}: {
  rows: readonly DeploymentTableRow[]
  services: ReadonlyMap<string, ServiceRef>
  now: number
  retryPending: boolean
  onRetry: (id: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead>Initiated by</TableHead>
            <TableHead>Deployment</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => {
            const svc = services.get(d.serviceId)
            const durationMs = deploymentDurationMs(d, d.status, now)
            return (
              <TableRow key={d.id} className="hover:bg-muted/40">
                <TableCell className="font-medium">
                  {svc ? (
                    <AuthDashboardProjectsProjectIdServicesServiceId.Link projectId={svc.projectId} serviceId={d.serviceId} className="hover:underline">
                      {svc.name}
                    </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                  ) : (
                    <span className="text-muted-foreground" title={d.serviceId}>Deleted service</span>
                  )}
                  {d.domainUrl ? (
                    <a
                      href={d.domainUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex max-w-56 items-center gap-1 truncate font-mono text-xs font-normal text-primary hover:underline"
                    >
                      <span className="truncate">{d.domainUrl.replace(/^https?:\/\//, '')}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : null}
                </TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
                <TableCell><EnvironmentBadge environment={d.environment} /></TableCell>
                <TableCell>
                  <RelativeTime value={deploymentStartedAt(d)} className="text-sm text-muted-foreground" />
                  <span className="sr-only">{formatDateTime(deploymentStartedAt(d))}</span>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatDuration(durationMs)}</TableCell>
                <TableCell className="text-sm">{d.triggeredBy ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><IdChip id={d.id} label="Copy deployment id" /></TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {d.status === 'failed' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={retryPending}
                        onClick={() => { onRetry(d.id) }}
                      >
                        <RotateCw className="mr-1.5 size-3.5" />
                        Retry
                      </Button>
                    ) : null}
                    {svc ? (
                      <Button asChild variant="ghost" size="sm">
                        <AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link projectId={svc.projectId} serviceId={d.serviceId}>
                          Details
                        </AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link>
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
