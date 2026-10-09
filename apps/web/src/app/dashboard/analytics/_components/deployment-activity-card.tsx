'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@repo/ui/components/shadcn/chart'
import { CardBody, DataSourceBadge } from './card-states'

const config = {
	deployments: { label: 'Deployments', color: 'var(--chart-1)' },
	rollbacks: { label: 'Rollbacks', color: 'var(--chart-4)' },
} satisfies ChartConfig

export interface DeploymentBucket { label: string; deployments: number; rollbacks: number }

export function DeploymentActivityCard({
	buckets, source, rangeLabel, loading, error, onRetry,
}: { buckets: DeploymentBucket[]; source: string | undefined; rangeLabel: string; loading: boolean; error: boolean; onRetry: () => void }) {
	const total = buckets.reduce((s, b) => s + b.deployments, 0)
	const rollbacks = buckets.reduce((s, b) => s + b.rollbacks, 0)
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
				<div>
					<CardTitle className="text-base">Deployment activity</CardTitle>
					<CardDescription>Deployments and rollbacks per time bucket · {rangeLabel} · times in UTC</CardDescription>
				</div>
				<DataSourceBadge source={source} />
			</CardHeader>
			<CardContent>
				<CardBody loading={loading} error={error} onRetry={onRetry} empty={total === 0 && rollbacks === 0} height="h-64"
					emptyText="No deployments were recorded in this range. Deploy a service, or pick a longer range.">
					<ChartContainer
						config={config} className="h-64 w-full" role="img"
						aria-label={`Bar chart: ${String(total)} deployments and ${String(rollbacks)} rollbacks over ${rangeLabel}. The same numbers are in the table below for screen readers.`}
					>
						<BarChart data={buckets} accessibilityLayer>
							<CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
							<XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
							<YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={32} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar dataKey="deployments" fill="var(--color-deployments)" radius={[2, 2, 0, 0]} />
							<Bar dataKey="rollbacks" fill="var(--color-rollbacks)" radius={[2, 2, 0, 0]} />
						</BarChart>
					</ChartContainer>
					<table className="sr-only">
						<caption>Deployments and rollbacks per bucket</caption>
						<thead><tr><th scope="col">Bucket</th><th scope="col">Deployments</th><th scope="col">Rollbacks</th></tr></thead>
						<tbody>
							{buckets.map((b) => (<tr key={b.label}><th scope="row">{b.label}</th><td>{b.deployments}</td><td>{b.rollbacks}</td></tr>))}
						</tbody>
					</table>
				</CardBody>
			</CardContent>
		</Card>
	)
}
