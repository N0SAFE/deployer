import { describe, expect, it } from 'vitest'
import { derivePlatformVerdict, latestPerService, summarizeNodes, type VerdictInput } from './platform-verdict'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const fresh = '2026-10-09T11:59:00Z'
const old = '2026-10-01T00:00:00Z'

const base = (over: Partial<VerdictInput>): VerdictInput => ({
	now: NOW,
	nodes: { status: 'ready', rows: [{ state: 'active', lastSeenAt: fresh }] },
	...over,
})

describe('derivePlatformVerdict', () => {
	it('is loading / unknown without node evidence', () => {
		expect(derivePlatformVerdict(base({ nodes: { status: 'loading', rows: [] } })).level).toBe('loading')
		expect(derivePlatformVerdict(base({ nodes: { status: 'error', rows: [] } })).level).toBe('unknown')
	})

	it('never reports healthy with zero nodes', () => {
		const v = derivePlatformVerdict(base({ nodes: { status: 'ready', rows: [] } }))
		expect(v.level).toBe('critical')
		expect(v.headline).toBe('No live nodes reporting')
		expect(v.items[0]?.target).toBe('network-mesh')
	})

	it('treats nodes last seen long ago as not live', () => {
		const v = derivePlatformVerdict(base({ nodes: { status: 'ready', rows: [{ state: 'active', lastSeenAt: old }] } }))
		expect(v.level).toBe('critical')
		expect(v.nodeSummary).toEqual({ total: 1, live: 0, stale: 1, down: 0 })
	})

	it('is healthy only with live nodes and nothing flagged', () => {
		const v = derivePlatformVerdict(base({ snapshot: { localNodeState: 'active', controlAvailable: true }, pendingAdmissions: 0 }))
		expect(v.level).toBe('healthy')
	})

	it('flags partial nodes, admissions, failed deployments and edge problems', () => {
		const v = derivePlatformVerdict(
			base({
				nodes: { status: 'ready', rows: [{ state: 'active', lastSeenAt: fresh }, { state: 'down', lastSeenAt: old }] },
				pendingAdmissions: 2,
				latestDeployments: [{ serviceId: 's1', label: 'api', status: 'failed' }],
				ingress: { publicLaneProvider: 'cloudflared', edge: { provisioned: false, health: 'unknown', detail: null }, meshLastError: null },
			}),
		)
		expect(v.items.map((i) => i.key)).toEqual(['nodes-partial', 'admissions', 'dep-s1', 'edge-not-provisioned'])
		expect(v.level).toBe('critical')
	})

	it('is attention (not critical) for warnings only', () => {
		const v = derivePlatformVerdict(base({ pendingAdmissions: 1 }))
		expect(v.level).toBe('attention')
	})
})

describe('helpers', () => {
	it('summarizeNodes treats a missing timestamp as live', () => {
		expect(summarizeNodes([{ state: 'active', lastSeenAt: null }], NOW).live).toBe(1)
	})
	it('latestPerService keeps the newest', () => {
		const r = latestPerService([
			{ serviceId: 'a', createdAt: '2026-01-01' },
			{ serviceId: 'a', createdAt: '2026-02-01' },
		])
		expect(r).toEqual([{ serviceId: 'a', createdAt: '2026-02-01' }])
	})
})
