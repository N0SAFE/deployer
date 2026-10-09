import type { ClusterNodeInventoryRow } from '@repo/api-contracts'

/** A node that has not been heard from for this long is no longer "live". */
export const NODE_STALE_AFTER_MS = 5 * 60 * 1000

export type NodeEvidence = 'live' | 'stale' | 'down' | 'unknown'

/** Compact "3 min ago" — the absolute time belongs in a `title`. */
export function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${String(hours)} h ago`
  return `${String(Math.round(hours / 24))} d ago`
}

export interface NodeHealth {
  evidence: NodeEvidence
  /** Epoch ms of the last sign of life, when the API reported one. */
  lastSeenMs: number | null
  /** Human sentence for tooltips: why this node is shown the way it is. */
  reason: string
}

/**
 * Derive a node's status from evidence, never from the registry flag alone:
 * an "active" row last seen days ago is stale, not healthy.
 */
export function deriveNodeHealth(
  node: Pick<ClusterNodeInventoryRow, 'state' | 'availability' | 'lastSeenAt' | 'lastHeartbeatAt'>,
  now: number,
): NodeHealth {
  const stamp = node.lastSeenAt ?? node.lastHeartbeatAt
  const parsed = stamp ? Date.parse(stamp) : Number.NaN
  const lastSeenMs = Number.isNaN(parsed) ? null : parsed

  if (node.state === 'down') {
    return { evidence: 'down', lastSeenMs, reason: 'The cluster reports this node as down.' }
  }
  if (node.availability === 'drain') {
    return { evidence: 'down', lastSeenMs, reason: 'This node is drained: it accepts no new workloads.' }
  }
  if (lastSeenMs === null) {
    return { evidence: 'unknown', lastSeenMs, reason: 'No heartbeat has been recorded for this node yet.' }
  }
  const age = now - lastSeenMs
  if (age > NODE_STALE_AFTER_MS) {
    return { evidence: 'stale', lastSeenMs, reason: `Last heard from ${formatAgo(age)}. Its state may be out of date.` }
  }
  return { evidence: 'live', lastSeenMs, reason: `Heard from ${formatAgo(age)}.` }
}

export interface PulseSummary {
  total: number
  live: number
  stale: number
  down: number
  unknown: number
  managers: number
}

export function summarizePulse(
  nodes: readonly ClusterNodeInventoryRow[],
  now: number,
): PulseSummary {
  const summary: PulseSummary = { total: nodes.length, live: 0, stale: 0, down: 0, unknown: 0, managers: 0 }
  for (const node of nodes) {
    summary[deriveNodeHealth(node, now).evidence] += 1
    if (node.swarmRole === 'manager') summary.managers += 1
  }
  return summary
}
