/**
 * Platform verdict — the pure derivation behind the Command center's headline.
 *
 * The rule (UI-PRINCIPLES §1): never claim a good state that has no evidence
 * behind it. "Healthy" is only returned when nodes were read, at least one is
 * reporting, and nothing else we could check is wrong. Everything that has not
 * been read yet is left out of the claim instead of being assumed fine.
 */

/** A node counts as stale when its last sign of life is older than this. */
export const NODE_STALE_MS = 10 * 60 * 1000

/** Above this, resource pressure starts delaying scheduling. */
export const RESOURCE_PRESSURE_PERCENT = 80

export interface NodeEvidence {
	state: 'active' | 'down'
	lastSeenAt: string | null
}

export type AttentionTarget =
	| 'cluster'
	| 'nodes'
	| 'nodes-capacity'
	| 'network-mesh'
	| 'network-ingress'
	| 'deployment'
	| 'analytics'

export interface AttentionItem {
	key: string
	label: string
	detail: string
	tone: 'danger' | 'pending'
	target: AttentionTarget
	targetLabel: string
	/** Set for `deployment` items so the link can name the service. */
	serviceId?: string
	projectId?: string
}

export interface LatestDeployment {
	serviceId: string
	projectId?: string
	label: string
	status: string
}

export interface VerdictInput {
	now: number
	nodes: { status: 'loading' | 'error' | 'ready'; rows: NodeEvidence[] }
	snapshot?: { localNodeState: string; controlAvailable: boolean }
	pendingAdmissions?: number
	/** Latest deployment of each service (already de-duplicated). */
	latestDeployments?: LatestDeployment[]
	ingress?: {
		publicLaneProvider: string | null
		edge: { provisioned: boolean; health: 'healthy' | 'degraded' | 'down' | 'unknown'; detail: string | null } | null
		meshLastError: string | null
	}
	system?: { cpu?: number; memory?: number }
}

export type VerdictLevel = 'loading' | 'unknown' | 'critical' | 'attention' | 'healthy'

export interface NodeSummary {
	total: number
	live: number
	stale: number
	down: number
}

export interface PlatformVerdict {
	level: VerdictLevel
	headline: string
	detail: string
	items: AttentionItem[]
	nodeSummary: NodeSummary
}

export function summarizeNodes(rows: NodeEvidence[], now: number): NodeSummary {
	let live = 0
	let stale = 0
	let down = 0
	for (const row of rows) {
		if (row.state === 'down') {
			down += 1
			continue
		}
		const seen = row.lastSeenAt === null ? Number.NaN : new Date(row.lastSeenAt).getTime()
		// No timestamp = no staleness evidence; the swarm state is all we have.
		if (!Number.isNaN(seen) && now - seen > NODE_STALE_MS) stale += 1
		else live += 1
	}
	return { total: rows.length, live, stale, down }
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`

export function derivePlatformVerdict(input: VerdictInput): PlatformVerdict {
	const empty: NodeSummary = { total: 0, live: 0, stale: 0, down: 0 }
	if (input.nodes.status === 'loading') {
		return { level: 'loading', headline: 'Reading platform state…', detail: '', items: [], nodeSummary: empty }
	}
	if (input.nodes.status === 'error') {
		return {
			level: 'unknown',
			headline: 'Platform state unavailable',
			detail: 'The node inventory could not be read, so nothing can be said about the platform yet.',
			items: [],
			nodeSummary: empty,
		}
	}

	const summary = summarizeNodes(input.nodes.rows, input.now)
	const items: AttentionItem[] = []

	if (summary.total === 0) {
		items.push({
			key: 'no-nodes',
			label: 'No live nodes reporting',
			detail:
				'No node has registered with this stack. Usual causes: the Docker engine is not in Swarm mode, or node setup did not finish.',
			tone: 'danger',
			target: 'network-mesh',
			targetLabel: 'Open Network › Mesh',
		})
	} else if (summary.live === 0) {
		items.push({
			key: 'no-live-nodes',
			label: 'No live nodes reporting',
			detail: `${plural(summary.total, 'node is', 'nodes are')} registered but none has been seen in the last ${String(NODE_STALE_MS / 60000)} minutes.`,
			tone: 'danger',
			target: 'nodes',
			targetLabel: 'Open Nodes',
		})
	} else if (summary.live < summary.total) {
		items.push({
			key: 'nodes-partial',
			label: `${String(summary.total - summary.live)} of ${String(summary.total)} nodes not reporting`,
			detail: `${String(summary.down)} down, ${String(summary.stale)} silent for more than ${String(NODE_STALE_MS / 60000)} minutes.`,
			tone: 'pending',
			target: 'nodes',
			targetLabel: 'Open Nodes',
		})
	}

	const snap = input.snapshot
	if (snap !== undefined && summary.total > 0) {
		if (snap.localNodeState !== 'active') {
			items.push({
				key: 'cluster-state',
				label: 'Cluster is not active',
				detail: `This node is ${snap.localNodeState} — workloads cannot be scheduled.`,
				tone: 'danger',
				target: 'cluster',
				targetLabel: 'Open Cluster',
			})
		} else if (!snap.controlAvailable) {
			items.push({
				key: 'cluster-control',
				label: 'Control plane unreachable',
				detail: 'No swarm manager is answering. Managers must keep a majority (quorum) to accept changes.',
				tone: 'danger',
				target: 'cluster',
				targetLabel: 'Open Cluster',
			})
		}
	}

	if (input.pendingAdmissions !== undefined && input.pendingAdmissions > 0) {
		items.push({
			key: 'admissions',
			label: `${plural(input.pendingAdmissions, 'admission request', 'admission requests')} waiting`,
			detail: 'Someone asked for capacity on a node and is waiting for a decision.',
			tone: 'pending',
			target: 'nodes-capacity',
			targetLabel: 'Review in Capacity & admissions',
		})
	}

	for (const dep of input.latestDeployments ?? []) {
		if (dep.status !== 'failed' && dep.status !== 'error') continue
		items.push({
			key: `dep-${dep.serviceId}`,
			label: `${dep.label} — last deployment failed`,
			detail: 'The newest rollout of this service failed; the previous version may still be serving.',
			tone: 'danger',
			target: 'deployment',
			targetLabel: 'Open deployments',
			serviceId: dep.serviceId,
			projectId: dep.projectId,
		})
	}

	const ing = input.ingress
	if (ing !== undefined) {
		if (ing.publicLaneProvider !== null && (ing.edge === null || !ing.edge.provisioned)) {
			items.push({
				key: 'edge-not-provisioned',
				label: 'Public edge is not provisioned',
				detail: ing.edge?.detail ?? `The public lane names "${ing.publicLaneProvider}" but nothing has been created on that provider yet.`,
				tone: 'pending',
				target: 'network-ingress',
				targetLabel: 'Open Network › Ingress',
			})
		} else if (ing.edge !== null && (ing.edge.health === 'down' || ing.edge.health === 'degraded')) {
			items.push({
				key: 'edge-health',
				label: `Public edge is ${ing.edge.health}`,
				detail: ing.edge.detail ?? 'The edge provider reports a problem; public apps may be unreachable.',
				tone: ing.edge.health === 'down' ? 'danger' : 'pending',
				target: 'network-ingress',
				targetLabel: 'Open Network › Ingress',
			})
		}
		if (ing.meshLastError !== null && ing.meshLastError !== '') {
			items.push({
				key: 'mesh-error',
				label: 'Mesh reports an error',
				detail: ing.meshLastError,
				tone: 'pending',
				target: 'network-mesh',
				targetLabel: 'Open Network › Mesh',
			})
		}
	}

	const { cpu, memory } = input.system ?? {}
	if (cpu !== undefined && cpu > RESOURCE_PRESSURE_PERCENT) {
		items.push({ key: 'cpu', label: 'CPU pressure', detail: `${cpu.toFixed(0)}% of container CPU in use on the node serving this console.`, tone: 'pending', target: 'analytics', targetLabel: 'Open Analytics' })
	}
	if (memory !== undefined && memory > RESOURCE_PRESSURE_PERCENT) {
		items.push({ key: 'memory', label: 'Memory pressure', detail: `${memory.toFixed(0)}% of container memory limits in use on the node serving this console.`, tone: 'pending', target: 'analytics', targetLabel: 'Open Analytics' })
	}

	const critical = items.some((i) => i.tone === 'danger')
	if (critical) {
		const first = items[0]
		return { level: 'critical', headline: first?.label ?? 'Needs attention', detail: first?.detail ?? '', items, nodeSummary: summary }
	}
	if (items.length > 0) {
		return {
			level: 'attention',
			headline: `${plural(items.length, 'thing needs', 'things need')} your attention`,
			detail: 'Nodes are reporting, but something below is not as it should be.',
			items,
			nodeSummary: summary,
		}
	}
	return {
		level: 'healthy',
		headline: `${plural(summary.live, 'node', 'nodes')} reporting, nothing flagged`,
		detail: 'Checked: node heartbeats, cluster control plane and the data that loaded on this page.',
		items,
		nodeSummary: summary,
	}
}

/** Latest deployment per service from a list of deployments (any order). */
export function latestPerService<T extends { serviceId: string; createdAt: string }>(deployments: T[]): T[] {
	const map = new Map<string, T>()
	for (const d of deployments) {
		const existing = map.get(d.serviceId)
		if (!existing || d.createdAt > existing.createdAt) map.set(d.serviceId, d)
	}
	return [...map.values()]
}
