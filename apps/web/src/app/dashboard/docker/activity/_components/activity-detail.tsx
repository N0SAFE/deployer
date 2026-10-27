'use client'

import type { DockerRuntimeActivityEntity } from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { StatusBadge } from '@/components/dashboard'
import { formatDateTime } from '@/lib/format/date'
import { DockerContainerDetailModalTrigger } from '../../_components/container-detail-modal'
import { DockerCopyableId } from '../../_components/docker-copy-button'
import { describeActivity } from '../_utils/describe-activity'
import { resolveContainerId, resolveResourceName, resolveSwarmSummary } from '../_utils/activity-fields'
import { severityVariant } from './activity-severity'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  )
}

/** Detail of one event: facts first, swarm task breakdown, then the raw payload on demand. */
export function ActivityDetail({ activity, isFetching, isError, onClose }: {
  activity: DockerRuntimeActivityEntity
  isFetching: boolean
  isError: boolean
  onClose: () => void
}) {
  const resourceName = resolveResourceName(activity)
  const containerId = resolveContainerId(activity)
  const swarmSummary = resolveSwarmSummary(activity)
  return (
    <section aria-label="Event details" className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{describeActivity({ source: activity.source, action: activity.action, resourceName })}</h2>
          <p className="font-mono text-xs text-muted-foreground">{activity.source}.{activity.action}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={activity.status} />
          <Badge variant={severityVariant(activity.severity)}>{activity.severity}</Badge>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>

      {isFetching ? <p role="status" className="text-xs text-muted-foreground">Refreshing this event…</p> : null}
      {isError ? <p className="text-sm text-destructive">Could not refresh this event; showing the version from the list.</p> : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Occurred">{formatDateTime(activity.occurredAt)}</Field>
        <Field label="Resource">
          {containerId ? <DockerContainerDetailModalTrigger id={containerId}>{resourceName}</DockerContainerDetailModalTrigger> : resourceName}
        </Field>
        <Field label="Flow"><DockerCopyableId value={activity.flowId} short={activity.flowId.slice(0, 12)} label="flow id" /></Field>
        <Field label="Progress">{typeof activity.progress === 'number' ? `${String(activity.progress)}%` : '—'}</Field>
        <Field label="Stage">{activity.stage ?? '—'}</Field>
        <Field label="Scanner">{activity.scanner ?? '—'}</Field>
        {activity.swarmService ? (
          <>
            <Field label="Service">{activity.swarmService.serviceName}</Field>
            <Field label="Mode">{activity.swarmService.mode}</Field>
            <Field label="Tasks">{swarmSummary ?? '—'}</Field>
            <Field label="Image"><code className="font-mono text-xs">{activity.swarmService.image}</code></Field>
          </>
        ) : null}
      </dl>

      {activity.swarmTasks.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs font-medium">Swarm tasks</h3>
          {activity.swarmTasks.map((task) => (
            <div key={task.taskId} className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-background px-2 py-1.5 text-sm">
              <Badge variant="outline">slot {task.slot ?? '—'}</Badge>
              <span className="text-muted-foreground">{task.state}</span>
              {task.error ? <span className="font-medium text-destructive">{task.error}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {activity.swarmService?.updateMessage ? (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-sm text-destructive">{activity.swarmService.updateMessage}</p>
      ) : null}
      {activity.message ? <p className="rounded border border-border/60 bg-background px-2 py-1.5 text-sm">{activity.message}</p> : null}

      <details className="rounded border border-border/60 bg-background/60 p-2">
        <summary className="cursor-pointer text-sm font-medium">Raw payload and attributes</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted/40 p-2 font-mono text-xs">
          {JSON.stringify({ actorAttributes: activity.actorAttributes, payload: activity.payload, raw: activity.raw }, null, 2)}
        </pre>
      </details>
    </section>
  )
}
