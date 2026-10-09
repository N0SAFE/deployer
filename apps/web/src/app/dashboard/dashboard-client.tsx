'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/dashboard'
import { MeshPulse } from '@/components/dashboard/MeshPulse'
import { useClusterNodes, useClusterSnapshot } from '@/domains/cluster/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useFleetAdmissionRequests } from '@/domains/fleet/hooks'
import { useRealTimeMetrics } from '@/domains/analytics/hooks'
import { useIngress } from '@/domains/reachability/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { PlatformVitals, type Vitals } from './_components/platform-vitals'
import { QuickActions } from './_components/quick-actions'
import { RecentDeploymentsCard, type RecentDeployment } from './_components/recent-deployments-card'
import { VerdictCard } from './_components/verdict-card'
import { derivePlatformVerdict, latestPerService, type VerdictInput } from './_utils/platform-verdict'

const toIso = (value: string | Date): string => new Date(value).toISOString()

/**
 * Command center — the operator's landing surface.
 *
 *  1. Verdict: derived from evidence (nodes reporting, control plane, edge,
 *     failed deployments, pending admissions). Never "healthy" without nodes.
 *  2. Platform vitals, each explained; vitals with no data source are omitted.
 *  3. Mesh pulse + recent deployments, each with a real empty state.
 */
export function DashboardOverviewClient({ operatorName }: { operatorName: string }) {
	// A ticking clock so node staleness is re-evaluated without a refetch.
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		const id = setInterval(() => { setNow(Date.now()) }, 30_000)
		return () => { clearInterval(id) }
	}, [])
	const nodes = useClusterNodes({ includeDown: true })
	const snapshot = useClusterSnapshot()
	const admissions = useFleetAdmissionRequests({ status: 'pending' })
	const deployments = useDeploymentList({ query: { limit: 50, offset: 0 } })
	const services = useServiceList({ query: { limit: 100, offset: 0 } })
	const ingress = useIngress()
	const metrics = useRealTimeMetrics()

	const serviceById = useMemo(() => {
		const map = new Map<string, { name: string; projectId: string }>()
		for (const s of services.data?.data ?? []) map.set(s.id, { name: s.name, projectId: s.projectId })
		return map
	}, [services.data])

	const allDeployments = useMemo<RecentDeployment[]>(
		() =>
			(deployments.data?.data ?? [])
				.map((d) => {
					const svc = serviceById.get(d.serviceId)
					return {
						id: d.id,
						serviceId: d.serviceId,
						serviceName: svc?.name ?? null,
						projectId: svc?.projectId ?? null,
						status: d.status,
						environment: d.environment,
						createdAt: toIso(d.createdAt),
					}
				})
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		[deployments.data, serviceById],
	)

	const realSystem = metrics.data && metrics.data.dataSource !== 'unavailable' ? { cpu: metrics.data.system.cpu, memory: metrics.data.system.memory } : undefined
	const nodeRows = nodes.data
	const verdictInput: VerdictInput = {
		now,
		nodes: nodes.isError
			? { status: 'error', rows: [] }
			: nodeRows === undefined
				? { status: 'loading', rows: [] }
				: { status: 'ready', rows: nodeRows.map((n) => ({ state: n.state, lastSeenAt: n.lastSeenAt ?? n.lastHeartbeatAt })) },
		snapshot: snapshot.data ? { localNodeState: snapshot.data.localNodeState, controlAvailable: snapshot.data.controlAvailable } : undefined,
		pendingAdmissions: admissions.data?.items.length,
		latestDeployments: deployments.data
			? latestPerService(allDeployments).map((d) => ({ serviceId: d.serviceId, projectId: d.projectId ?? undefined, label: d.serviceName ?? 'A service', status: d.status }))
			: undefined,
		ingress: ingress.data
			? {
					publicLaneProvider: ingress.data.lanes.public?.provider ?? null,
					edge: ingress.data.edge.active ? ingress.data.edge.active.status : null,
					meshLastError: ingress.data.mesh.lastError,
				}
			: undefined,
		system: realSystem,
	}
	const verdict = derivePlatformVerdict(verdictInput)

	const vitals: Vitals = {
		nodes: nodeRows ? { live: verdict.nodeSummary.live, total: verdict.nodeSummary.total } : undefined,
		managers: snapshot.data?.managerCount,
		exposure: ingress.data
			? {
					label: ingress.data.exposure.reachableFromInternet ? 'the internet' : ingress.data.exposure.reachableOffMachine ? 'the mesh / LAN' : 'this machine only',
					hint: ingress.data.exposure.reachableFromInternet ? 'public lane on' : 'public lane off',
				}
			: undefined,
		mesh: ingress.data ? { members: ingress.data.mesh.members.filter((m) => m.state === 'active').length, up: ingress.data.mesh.interfaceUp } : undefined,
		system: realSystem,
	}

	return (
		<div className="space-y-5">
			<PageHeader
				eyebrow="Overview"
				title="Command center"
				description={`Welcome back, ${operatorName}. The state of the platform, what needs you, and where to go next.`}
				actions={<QuickActions />}
			/>
			<VerdictCard
				verdict={verdict}
				onRetry={() => {
					void nodes.refetch()
				}}
			/>
			<PlatformVitals vitals={vitals} />
			<div className="grid gap-4 lg:grid-cols-5">
				<div className="lg:col-span-2">
					<MeshPulse />
				</div>
				<div className="lg:col-span-3">
					<RecentDeploymentsCard
						deployments={allDeployments.slice(0, 6)}
						loading={deployments.isPending}
						error={deployments.isError}
						onRetry={() => {
							void deployments.refetch()
						}}
					/>
				</div>
			</div>
		</div>
	)
}
