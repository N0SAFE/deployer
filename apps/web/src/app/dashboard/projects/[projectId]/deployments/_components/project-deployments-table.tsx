'use client'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { Play, RotateCcw, ScrollText, Trash2, XCircle } from 'lucide-react'
import { EnvironmentBadge, StatusBadge } from '@/components/dashboard'
import { AuthDashboardProjectsProjectIdServicesServiceId, AuthDashboardProjectsProjectIdServicesServiceIdLogs } from '@/routes'
import { RelativeTime } from '../../../_components/workload/RelativeTime'
import { IdChip } from '../../../_components/workload/CopyButton'
import { deploymentDurationMs, deploymentStartedAt, formatDuration, isInProgress } from '../../../_utils/workload'

export interface ProjectDeploymentRow {
  id: string
  serviceId: string
  status: string
  environment?: string | null
  createdAt?: string | Date | null
  buildStartedAt?: string | Date | null
  buildCompletedAt?: string | Date | null
  deployStartedAt?: string | Date | null
  deployCompletedAt?: string | Date | null
}

export type RowAction = 'cancel' | 'rollback' | 'retry' | 'delete'

export function ProjectDeploymentsTable({
  rows,
  projectId,
  serviceNames,
  canRollback,
  now,
  busy,
  onAction,
}: {
  rows: readonly ProjectDeploymentRow[]
  projectId: string
  serviceNames: ReadonlyMap<string, string>
  /** Whether an earlier successful deployment of the same service+environment exists. */
  canRollback: (row: ProjectDeploymentRow) => boolean
  now: number
  busy: boolean
  onAction: (action: RowAction, row: ProjectDeploymentRow) => void
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
            <TableHead>Deployment</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => {
            const name = serviceNames.get(d.serviceId)
            const running = isInProgress(d.status)
            const label = name ?? 'sub-service'
            return (
              <TableRow key={d.id} className="hover:bg-muted/40">
                <TableCell className="font-medium">
                  {name ? (
                    <AuthDashboardProjectsProjectIdServicesServiceId.Link projectId={projectId} serviceId={d.serviceId} className="hover:underline">
                      {name}
                    </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                  ) : (
                    <span className="text-muted-foreground">Sub-service</span>
                  )}
                </TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
                <TableCell><EnvironmentBadge environment={d.environment} /></TableCell>
                <TableCell><RelativeTime value={deploymentStartedAt(d)} className="text-sm text-muted-foreground" /></TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatDuration(deploymentDurationMs(d, d.status, now))}</TableCell>
                <TableCell><IdChip id={d.id} label="Copy deployment id" /></TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button asChild variant="ghost" size="icon" className="size-8">
                      <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                        projectId={projectId}
                        serviceId={d.serviceId}
                        aria-label={`Logs of ${label}`}
                        title="Logs"
                      >
                        <ScrollText className="size-4" />
                      </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                    </Button>
                    {running ? (
                      <Button variant="ghost" size="icon" className="size-8" disabled={busy} title="Cancel run" aria-label={`Cancel the ${label} run`} onClick={() => { onAction('cancel', d) }}>
                        <XCircle className="size-4" />
                      </Button>
                    ) : null}
                    {d.status === 'failed' ? (
                      <Button variant="ghost" size="icon" className="size-8" disabled={busy} title="Retry" aria-label={`Retry the failed ${label} run`} onClick={() => { onAction('retry', d) }}>
                        <Play className="size-4" />
                      </Button>
                    ) : null}
                    {(d.status === 'success' || d.status === 'failed') && canRollback(d) ? (
                      <Button variant="ghost" size="icon" className="size-8" disabled={busy} title="Roll back to the previous successful run" aria-label={`Roll ${label} back to its previous successful run`} onClick={() => { onAction('rollback', d) }}>
                        <RotateCcw className="size-4" />
                      </Button>
                    ) : null}
                    {!running ? (
                      <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" disabled={busy} title="Delete record" aria-label={`Delete the ${label} deployment record`} onClick={() => { onAction('delete', d) }}>
                        <Trash2 className="size-4" />
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
