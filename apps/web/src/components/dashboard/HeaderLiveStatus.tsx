'use client'

import { useDockerRuntimeSseState } from '@/domains/docker/hooks'
import { StatusDot, type StatusTone } from './status'

const STREAM_TONE: Record<string, StatusTone> = {
  connected: 'live',
  connecting: 'pending',
  error: 'danger',
  disconnected: 'neutral',
}

/**
 * HeaderLiveStatus — the one meaningful live region on every dashboard page.
 * Shows the Docker runtime stream state with a pulse dot. Uses `role="status"`
 * with an atomic label so screen readers announce state changes without
 * flooding the page with competing live regions.
 */
export function HeaderLiveStatus() {
  const { status } = useDockerRuntimeSseState()

  const tone = STREAM_TONE[status] ?? 'neutral'
  const label = status === 'connected' ? 'Runtime live' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'Runtime offline' : 'Runtime idle'

  return (
    <span
      role="status"
      aria-atomic="true"
      className="hidden items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground lg:inline-flex"
    >
      <StatusDot tone={tone} pulse={status === 'connecting'} label={label} />
      {label}
    </span>
  )
}
