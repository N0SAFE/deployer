'use client'

import { formatDistanceToNowStrict } from 'date-fns'
import { Globe, Lock, Waypoints, type LucideIcon } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { StatusBadge } from '@/components/dashboard'
import { formatDateTime } from '@/lib/format/date'
import type { EdgeHealth, IngressState } from '@repo/api-contracts/modules/reachability/index'

/**
 * Words and small badges every Network page shares, so the same thing is never
 * called two names on two pages.
 */

export type LaneKey = 'local' | 'private' | 'public'

/** What each lane binds and what it costs. Least → most exposed, like the API's `INGRESS_LANES`. */
export const LANE_COPY: Record<LaneKey, { label: string; icon: LucideIcon; blurb: string; cost: string }> = {
  local: {
    label: 'Local',
    icon: Lock,
    blurb: 'A door on loopback on every node. Always on — the one lane that cannot expose the machine.',
    cost: 'Nothing leaves the machine.',
  },
  private: {
    label: 'Private',
    icon: Waypoints,
    blurb: 'A door on each node’s mesh address, so members reach the stack over WireGuard.',
    cost: 'No public address, no inbound port. Only mesh members can connect.',
  },
  public: {
    label: 'Public',
    icon: Globe,
    blurb: 'The internet, carried by ONE edge provider for the whole stack.',
    cost: 'Whatever the chosen edge costs: a provider account, or inbound ports.',
  },
}

export function enabledLaneKeys(lanes: IngressState['lanes']): LaneKey[] {
  return (['local', 'private', 'public'] as const).filter(
    (lane) => lane === 'local' || (lane === 'private' && lanes.private.enabled) || (lane === 'public' && lanes.public !== null),
  )
}

/** The edge's health as a status chip. */
export function EdgeHealthBadge({ health }: { health: EdgeHealth }) {
  const status = health === 'healthy' ? 'healthy' : health === 'degraded' ? 'degraded' : health === 'down' ? 'failed' : 'unknown'
  return <StatusBadge status={status}>{health}</StatusBadge>
}

type LinkPath = IngressState['mesh']['members'][number]['link']['path']

const LINK_COPY: Record<LinkPath, { label: string; status: string; hint: string }> = {
  self: { label: 'this node', status: 'active', hint: 'The node answering this page.' },
  direct: { label: 'direct', status: 'healthy', hint: 'A WireGuard handshake is fresh — traffic flows peer to peer.' },
  trying: { label: 'connecting', status: 'pending', hint: 'Trying candidate endpoints (LAN, declared, STUN) one after another.' },
  relay: { label: 'relayed', status: 'degraded', hint: 'No direct path; traffic would go through another member.' },
  passive: { label: 'waiting', status: 'pending', hint: 'This peer must dial us (it is behind NAT and so are we, or it has no endpoint yet).' },
}

export function LinkPathBadge({ path }: { path: LinkPath }) {
  const copy = LINK_COPY[path]
  return (
    <span title={copy.hint}>
      <StatusBadge status={copy.status}>{copy.label}</StatusBadge>
    </span>
  )
}

/** Every link path with what it means, so “relayed” and “waiting” are never left unexplained. */
export function LinkPathLegend() {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {(Object.keys(LINK_COPY) as LinkPath[]).map((path) => (
        <div key={path} className="flex items-start gap-2">
          <dt className="shrink-0">
            <LinkPathBadge path={path} />
          </dt>
          <dd className="text-muted-foreground">{LINK_COPY[path].hint}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "12s ago" style age, or an em dash. */
export function Age({ at }: { at: string | null }) {
  if (at === null) return <span className="text-muted-foreground">—</span>
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return <span className="text-muted-foreground">—</span>
  return (
    <time dateTime={at} title={formatDateTime(date)}>
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </time>
  )
}

/** A monospace value chip for addresses, ids and hostnames. */
export function Mono({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
}

export function KindBadge({ kind }: { kind: 'tunnel' | 'inbound' }) {
  return <Badge variant="outline">{kind === 'tunnel' ? 'outbound tunnel' : 'inbound ports'}</Badge>
}
