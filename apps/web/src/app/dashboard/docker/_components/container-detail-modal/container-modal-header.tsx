'use client'

import type { DockerContainer } from '@repo/contracts-entities'
import { DialogDescription, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { DockerCopyableId } from '../docker-copy-button'
import { DockerNodeBadge } from '../docker-node-context'
import { shortId } from '../../_utils/format'
import { ContainerQuickActions } from './container-quick-actions'
import { ContainerStatusBadges } from './container-status-badge'
import type { ContainerOp } from '../../_hooks/use-container-actions'

interface ContainerModalHeaderProps {
  id: string
  detail: DockerContainer | null
  notice: string | null
  actionsPending: boolean
  inspectState: 'refreshing' | 'failed' | 'ready'
  runtimeStreamStatus: 'shared' | 'live'
  lastRuntimeAction: string | null
  lastMetricAt: string | null
  onAction: (op: ContainerOp) => void
}

const INSPECT_LABEL = { refreshing: 'refreshing', failed: 'failed', ready: 'up to date' } as const

/** Modal header: name, status, node, id with copy, lifecycle actions and the live-data indicators. */
export function ContainerModalHeader({
  id,
  detail,
  notice,
  actionsPending,
  inspectState,
  runtimeStreamStatus,
  lastRuntimeAction,
  lastMetricAt,
  onAction,
}: ContainerModalHeaderProps) {
  return (
    <DialogHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <DialogTitle className="flex flex-wrap items-center gap-2 break-all">
            <span>{detail?.name ?? 'Container details'}</span>
            {detail ? <ContainerStatusBadges status={detail.status} health={detail.health} /> : null}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <DockerNodeBadge />
              <DockerCopyableId value={id} short={shortId(id)} label="container ID" />
            </div>
          </DialogDescription>
        </div>
        <ContainerQuickActions status={detail?.status ?? null} disabled={actionsPending} onAction={onAction} />
      </div>
      {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
      <div role="status" aria-label="Live data status" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Details: {INSPECT_LABEL[inspectState]}</span>
        <span>
          Live events: {runtimeStreamStatus === 'live' ? 'receiving' : 'waiting for the first event'}
          {lastRuntimeAction ? ` (last: ${lastRuntimeAction})` : ''}
        </span>
        <span>
          Metrics: {lastMetricAt ? <time dateTime={lastMetricAt} title={lastMetricAt}>last sample {lastMetricAt.slice(11, 19)} UTC</time> : 'waiting for the first sample'}
        </span>
      </div>
    </DialogHeader>
  )
}
