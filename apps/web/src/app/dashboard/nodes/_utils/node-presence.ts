/**
 * Node presence: the ONE place that decides whether a registered node is
 * actually there. The registry (`nodes.listServers`) keeps every node that ever
 * joined, and its `status`/`healthy` fields describe the registry row, not the
 * machine — a node dead for days still reads `active`. Presence is therefore
 * derived from evidence only:
 *
 *   this-node  the node serving this dashboard (it is answering, by definition)
 *   online     present in the live mesh membership, OR reported within ONLINE_WINDOW_MS
 *   stale      not online, but reported within STALE_WINDOW_MS (probably restarting
 *              or briefly partitioned)
 *   offline    revoked, never reported, or silent for longer than STALE_WINDOW_MS
 */
export type NodePresence = 'this-node' | 'online' | 'stale' | 'offline'

/** A node that reported this recently counts as connected (heartbeats are far more frequent). */
export const ONLINE_WINDOW_MS = 5 * 60_000
/** Beyond this silence a node is considered gone rather than late. */
export const STALE_WINDOW_MS = 24 * 60 * 60_000

export interface PresenceNode {
  nodeId: string
  status?: string
  lastSeenAt?: string | null
}

/** Mesh lifecycle states that mean the node is currently reachable in the membership. */
const LIVE_LIFECYCLE = new Set(['healthy', 'degraded'])

/** Ids of the snapshot members that are currently live. */
export function liveNodeIds(
  members: readonly { nodeId: string; lifecycleState: string }[],
): Set<string> {
  return new Set(members.filter((m) => LIVE_LIFECYCLE.has(m.lifecycleState)).map((m) => m.nodeId))
}

export function nodePresence(
  node: PresenceNode,
  now: number,
  liveIds: ReadonlySet<string>,
  localNodeId?: string | null,
): NodePresence {
  if (node.status === 'revoked') return 'offline'
  if (localNodeId != null && node.nodeId === localNodeId) return 'this-node'
  if (liveIds.has(node.nodeId)) return 'online'
  if (!node.lastSeenAt) return 'offline'
  const seen = Date.parse(node.lastSeenAt)
  if (Number.isNaN(seen)) return 'offline'
  const age = now - seen
  if (age <= ONLINE_WINDOW_MS) return 'online'
  if (age <= STALE_WINDOW_MS) return 'stale'
  return 'offline'
}

const ORDER: Record<NodePresence, number> = { 'this-node': 0, online: 1, stale: 2, offline: 3 }

/** Sort key: this node, online, stale, offline; most recently seen first within a group. */
export function comparePresence<T extends PresenceNode>(
  a: { node: T; presence: NodePresence },
  b: { node: T; presence: NodePresence },
): number {
  const byGroup = ORDER[a.presence] - ORDER[b.presence]
  if (byGroup !== 0) return byGroup
  return Date.parse(b.node.lastSeenAt ?? '') - Date.parse(a.node.lastSeenAt ?? '') || 0
}

export function isPresent(presence: NodePresence): boolean {
  return presence === 'this-node' || presence === 'online'
}
