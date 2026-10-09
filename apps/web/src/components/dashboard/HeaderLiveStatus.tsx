'use client'

import { useClusterSnapshot } from '@/domains/cluster/hooks'
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/shadcn/tooltip'
import { StatusDot, type StatusTone } from './status'

interface LiveStatusCopy {
  tone: StatusTone
  label: string
  explanation: string
}

/** Pure mapping, exported for tests. */
export function liveStatusCopy(state: { isError: boolean; isPending: boolean; connected: boolean }): LiveStatusCopy {
  if (state.isError) {
    return {
      tone: 'danger',
      label: 'Offline',
      explanation: 'Live updates: disconnected. The platform API is not answering, so data on this page may be stale. It retries automatically.',
    }
  }
  if (state.isPending) {
    return {
      tone: 'pending',
      label: 'Connecting…',
      explanation: 'Live updates: reconnecting. Data on this page may be stale until the connection to the platform API is back.',
    }
  }
  if (state.connected) {
    return {
      tone: 'live',
      label: 'Live',
      explanation: 'Live updates: connected. The platform API and its cluster control plane are reachable; this page updates as things change.',
    }
  }
  return {
    tone: 'neutral',
    label: 'Idle',
    explanation: 'Live updates: connected to the API, but the cluster control plane reports no active manager, so cluster data may be stale.',
  }
}

/**
 * HeaderLiveStatus — the one meaningful live region on every dashboard page.
 * Reads the cluster snapshot (control-plane reachability) and explains in a
 * tooltip what the chip means and what it affects. Visible at every width: a
 * dot on phones, dot + label from `sm` up. `role="status"` carries the full
 * sentence for screen readers.
 */
export function HeaderLiveStatus() {
  const { data: snapshot, isPending, isError } = useClusterSnapshot()
  const copy = liveStatusCopy({ isError, isPending, connected: snapshot?.controlAvailable === true })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-atomic="true"
          tabIndex={0}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatusDot tone={copy.tone} pulse={isPending} />
          <span className="sr-only sm:not-sr-only">{copy.label}</span>
          <span className="sr-only">{copy.explanation}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-sm">{copy.explanation}</TooltipContent>
    </Tooltip>
  )
}
