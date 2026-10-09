import { describe, expect, it } from 'vitest'
import { deriveNodeHealth, formatAgo, summarizePulse, NODE_STALE_AFTER_MS } from '../mesh-pulse-model'
import { buildBreadcrumbs, shortId } from '../breadcrumbs-model'
import { pushRecent, toggleInList } from '../persisted-state'
import { fuzzyMatch } from '../fuzzy'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const row = (over: Record<string, unknown> = {}) =>
  ({ state: 'active', availability: 'active', lastSeenAt: null, lastHeartbeatAt: null, swarmRole: 'worker', ...over }) as never

describe('deriveNodeHealth', () => {
  it('is live only with a recent heartbeat', () => {
    const seen = new Date(NOW - 10_000).toISOString()
    expect(deriveNodeHealth(row({ lastSeenAt: seen }), NOW).evidence).toBe('live')
  })
  it('flags an "active" node silent for days as stale, not healthy', () => {
    const seen = new Date(NOW - NODE_STALE_AFTER_MS - 1000).toISOString()
    expect(deriveNodeHealth(row({ lastSeenAt: seen }), NOW).evidence).toBe('stale')
  })
  it('has no evidence without a heartbeat', () => {
    expect(deriveNodeHealth(row(), NOW).evidence).toBe('unknown')
  })
  it('reports down and drained nodes as down', () => {
    expect(deriveNodeHealth(row({ state: 'down' }), NOW).evidence).toBe('down')
    expect(deriveNodeHealth(row({ availability: 'drain' }), NOW).evidence).toBe('down')
  })
  it('summarises counts', () => {
    const seen = new Date(NOW - 1000).toISOString()
    const s = summarizePulse([row({ lastSeenAt: seen, swarmRole: 'manager' }), row({ state: 'down' }), row()], NOW)
    expect(s).toMatchObject({ total: 3, live: 1, down: 1, unknown: 1, managers: 1 })
  })
  it('formats ages', () => {
    expect(formatAgo(5_000)).toBe('just now')
    expect(formatAgo(3 * 60_000)).toBe('3 min ago')
    expect(formatAgo(5 * 3_600_000)).toBe('5 h ago')
  })
})

describe('buildBreadcrumbs', () => {
  const id = '3f2b8c1e-1111-4222-8333-444455556666'
  it('resolves names for dynamic ids', () => {
    const crumbs = buildBreadcrumbs(`/dashboard/projects/${id}`, (kind, v) => (kind === 'projects' && v === id ? 'Shop' : undefined))
    expect(crumbs.map((c) => c.label)).toEqual(['Dashboard', 'Projects', 'Shop'])
  })
  it('falls back to a neutral short id, never an empty crumb', () => {
    const crumbs = buildBreadcrumbs(`/dashboard/projects/${id}`)
    expect(crumbs.at(-1)).toMatchObject({ label: shortId(id), mono: true })
  })
  it('collapses duplicate consecutive labels', () => {
    const labels = buildBreadcrumbs('/dashboard/admin/settings').map((c) => c.label)
    expect(labels).toEqual(['Dashboard', 'Settings'])
  })
})

describe('persisted-state helpers', () => {
  it('pushRecent dedupes, fronts and caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
  it('toggleInList toggles', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('fuzzyMatch matches in order', () => {
    expect(fuzzyMatch('Command center', 'cmc')).toBe(true)
    expect(fuzzyMatch('Nodes', 'sn')).toBe(false)
  })
})
