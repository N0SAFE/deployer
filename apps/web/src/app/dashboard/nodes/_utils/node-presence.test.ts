import { describe, expect, it } from 'vitest'
import {
  comparePresence,
  liveNodeIds,
  nodePresence,
  type NodePresence,
  type PresenceNode,
  ONLINE_WINDOW_MS,
  STALE_WINDOW_MS,
} from './node-presence'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const none = new Set<string>()

describe('nodePresence', () => {
  it('marks the serving node as this-node even with no lastSeenAt', () => {
    expect(nodePresence({ nodeId: 'a' }, NOW, none, 'a')).toBe('this-node')
  })
  it('is online when live in the mesh, regardless of lastSeenAt', () => {
    expect(nodePresence({ nodeId: 'a', lastSeenAt: ago(3 * 86_400_000) }, NOW, new Set(['a']))).toBe('online')
  })
  it('is online when reported within the online window', () => {
    expect(nodePresence({ nodeId: 'a', lastSeenAt: ago(ONLINE_WINDOW_MS - 1) }, NOW, none)).toBe('online')
  })
  it('is stale between the online and stale windows', () => {
    expect(nodePresence({ nodeId: 'a', lastSeenAt: ago(ONLINE_WINDOW_MS + 1) }, NOW, none)).toBe('stale')
    expect(nodePresence({ nodeId: 'a', lastSeenAt: ago(STALE_WINDOW_MS) }, NOW, none)).toBe('stale')
  })
  it('is offline when silent for days, never seen, unparseable or revoked', () => {
    expect(nodePresence({ nodeId: 'a', lastSeenAt: ago(3 * 86_400_000) }, NOW, none)).toBe('offline')
    expect(nodePresence({ nodeId: 'a', lastSeenAt: null }, NOW, none)).toBe('offline')
    expect(nodePresence({ nodeId: 'a', lastSeenAt: 'nope' }, NOW, none)).toBe('offline')
    expect(nodePresence({ nodeId: 'a', status: 'revoked', lastSeenAt: ago(1) }, NOW, new Set(['a']))).toBe('offline')
  })
})

describe('liveNodeIds', () => {
  it('keeps only healthy and degraded members', () => {
    const ids = liveNodeIds([
      { nodeId: 'a', lifecycleState: 'healthy' },
      { nodeId: 'b', lifecycleState: 'degraded' },
      { nodeId: 'c', lifecycleState: 'isolated' },
      { nodeId: 'd', lifecycleState: 'leaving' },
    ])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })
})

describe('comparePresence', () => {
  it('orders this-node, online, stale, offline then by recency', () => {
    const rows: { node: PresenceNode; presence: NodePresence }[] = [
      { node: { nodeId: 'o', lastSeenAt: ago(9e9) }, presence: 'offline' },
      { node: { nodeId: 's', lastSeenAt: ago(ONLINE_WINDOW_MS * 2) }, presence: 'stale' },
      { node: { nodeId: 'n2', lastSeenAt: ago(2000) }, presence: 'online' },
      { node: { nodeId: 'n1', lastSeenAt: ago(1000) }, presence: 'online' },
      { node: { nodeId: 'me', lastSeenAt: null }, presence: 'this-node' },
    ]
    expect(rows.sort(comparePresence).map((r) => r.node.nodeId)).toEqual(['me', 'n1', 'n2', 's', 'o'])
  })
})
