'use client'

import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { PageHeader, ScopeLabel } from '@/components/dashboard'
import type { Granularity, TimeRange } from '@/domains/analytics/types'
import { useDeploymentMetrics, useDeploymentUsage, useRealTimeMetrics, useServiceHealth } from '@/domains/analytics/hooks'
import { allowedGranularities, bucketLabel, coerceGranularity, TIME_RANGE_LABELS, usageRangeFor } from './_utils/range'
import { DeploymentActivityCard } from './_components/deployment-activity-card'
import { ResourceSnapshotCard } from './_components/resource-snapshot-card'
import { ServiceHealthCard } from './_components/service-health-card'

const GRANULARITY_LABELS: Record<Granularity, string> = { minute: 'Per minute', hour: 'Per hour', day: 'Per day' }

/**
 * Analytics — what the platform is doing now (resources, service health) and
 * what it did over a range (deployments). The range and bucket size apply to the
 * deployment cards only; resources are a live reading.
 */
export default function AnalyticsPage() {
	const [timeRange, setTimeRange] = useState<TimeRange>('1d')
	const [requestedGranularity, setGranularity] = useState<Granularity>('hour')
	const granularity = coerceGranularity(timeRange, requestedGranularity)
	const usage = usageRangeFor(timeRange)

	const realTime = useRealTimeMetrics()
	const deploymentMetrics = useDeploymentMetrics(timeRange, granularity)
	const serviceHealth = useServiceHealth()
	const deploymentUsage = useDeploymentUsage(usage.range)

	const refreshAll = () => {
		void realTime.refetch()
		void deploymentMetrics.refetch()
		void serviceHealth.refetch()
		void deploymentUsage.refetch()
	}
	const isRefreshing = realTime.isFetching || deploymentMetrics.isFetching || serviceHealth.isFetching || deploymentUsage.isFetching

	const rt = realTime.data
	const buckets = useMemo(
		() => (deploymentMetrics.data?.data ?? []).map((d) => ({
			label: bucketLabel(d.timestamp, granularity, timeRange),
			deployments: d.deploymentsCount,
			rollbacks: d.rollbackCount,
		})),
		[deploymentMetrics.data, granularity, timeRange],
	)
	const summary = deploymentUsage.data?.summary
	const usageLabel = usage.exact ? TIME_RANGE_LABELS[timeRange] : `${TIME_RANGE_LABELS[usage.range]} (shortest window available for this summary)`

	return (
		<div className="space-y-6">
			<PageHeader
				eyebrow="Platform"
				title="Analytics"
				badge={<ScopeLabel scope="node" />}
				description="Live resource use on the node serving this console, service health, and deployment activity over the range you pick. Range and bucket size apply to the deployment cards."
				actions={
					<>
						<Select value={timeRange} onValueChange={(v) => { setTimeRange(v as TimeRange) }}>
							<SelectTrigger className="w-40" aria-label="Time range for deployment data"><SelectValue /></SelectTrigger>
							<SelectContent>
								{Object.entries(TIME_RANGE_LABELS).map(([key, label]) => (<SelectItem key={key} value={key}>{label}</SelectItem>))}
							</SelectContent>
						</Select>
						<Select value={granularity} onValueChange={(v) => { setGranularity(v as Granularity) }}>
							<SelectTrigger className="w-32" aria-label="Bucket size"><SelectValue /></SelectTrigger>
							<SelectContent>
								{allowedGranularities(timeRange).map((g) => (<SelectItem key={g} value={g}>{GRANULARITY_LABELS[g]}</SelectItem>))}
							</SelectContent>
						</Select>
						<Button variant="outline" size="sm" onClick={refreshAll} aria-label="Refresh analytics">
							<RefreshCw className={`mr-1.5 size-4 ${isRefreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
							Refresh
						</Button>
					</>
				}
			/>

			<ResourceSnapshotCard
				loading={realTime.isPending}
				error={realTime.isError}
				onRetry={() => { void realTime.refetch() }}
				reading={rt ? { cpu: rt.system.cpu, memory: rt.system.memory, disk: rt.system.disk, inbound: rt.system.network.inbound, outbound: rt.system.network.outbound, dataSource: rt.dataSource, timestamp: rt.timestamp } : undefined}
			/>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<DeploymentActivityCard
					buckets={buckets}
					source={deploymentMetrics.data?.dataSource}
					rangeLabel={TIME_RANGE_LABELS[timeRange]}
					loading={deploymentMetrics.isPending}
					error={deploymentMetrics.isError}
					onRetry={() => { void deploymentMetrics.refetch() }}
				/>
				<ServiceHealthCard
					rows={(serviceHealth.data?.data ?? []).map((s) => ({ serviceName: s.serviceName, status: s.status, uptime: s.uptime }))}
					source={serviceHealth.data?.dataSource}
					loading={serviceHealth.isPending}
					error={serviceHealth.isError}
					onRetry={() => { void serviceHealth.refetch() }}
				/>
			</div>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Deployment summary</CardTitle>
					<CardDescription>Aggregated over {usageLabel}.</CardDescription>
				</CardHeader>
				<CardContent>
					{deploymentUsage.isError ? (
						<div role="alert" className="flex items-center gap-3 text-sm text-muted-foreground">
							<span>The summary could not be loaded.</span>
							<Button size="sm" variant="outline" onClick={() => { void deploymentUsage.refetch() }}>Retry</Button>
						</div>
					) : summary === undefined ? (
						<p className="text-sm text-muted-foreground">Loading summary…</p>
					) : summary.totalDeployments === 0 ? (
						<p className="text-sm text-muted-foreground">No deployments in this window, so there are no rates or durations to report.</p>
					) : (
						<dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
							<div><dt className="text-xs text-muted-foreground">Deployments</dt><dd className="text-lg font-semibold tabular-nums">{summary.totalDeployments}</dd></div>
							<div><dt className="text-xs text-muted-foreground">Success rate</dt><dd className="text-lg font-semibold tabular-nums">{summary.successRate}%</dd></div>
							<div><dt className="text-xs text-muted-foreground">Average deploy time</dt><dd className="text-lg font-semibold tabular-nums">{summary.averageDeployTime > 0 ? `${String(Math.round(summary.averageDeployTime / 1000))} s` : '—'}</dd></div>
							<div><dt className="text-xs text-muted-foreground">Most active project</dt><dd className="truncate text-lg font-semibold">{summary.mostActiveProjects[0]?.projectName ?? '—'}</dd></div>
						</dl>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
