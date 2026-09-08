'use client'

import { useClusterSnapshot } from '@/domains/cluster/hooks'
import { StatusDot, type StatusTone } from './status'

/**
 * HeaderLiveStatus — the one meaningful live region on every dashboard page.
 * Shows the Swarm cluster state (control-plane reachability) with a pulse
 * dot. Uses `role="status"` with an atomic label so screen readers announce
 * state changes without flooding the page with competing live regions.
 *
 * The fleet console consumes the `cluster.*` contract surface here — not the
 * docker engine runtime stream, which belongs to the engine workspace where
 * `DockerRuntimeEventsProvider` is mounted.
 */
export function HeaderLiveStatus() {
  const { data: snapshot, isPending, isError } = useClusterSnapshot()

  const connected = snapshot?.controlAvailable === true

  const tone: StatusTone = isError ? 'danger' : isPending ? 'pending' : connected ? 'live' : 'neutral'
  const label = isError
    ? 'Mesh offline'
    : isPending
      ? 'Connecting…'
      : connected
        ? 'Mesh live'
        : 'Mesh idle'

  return (
    <span
      role="status"
      aria-atomic="true"
      className="hidden items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground lg:inline-flex"
    >
      <StatusDot tone={tone} pulse={isPending} label={label} />
      {label}
    </span>
  )
}
