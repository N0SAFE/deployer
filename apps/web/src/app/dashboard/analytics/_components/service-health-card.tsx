'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { StatusBadge } from '@/components/dashboard'
import { CardBody, DataSourceBadge } from './card-states'
import { Button } from '@deployer/ui/components/shadcn/button'
import { AuthDashboardProjects } from '@/routes'

export interface ServiceHealthRow { serviceName: string; status: string; uptime: number }

export function formatUptime(seconds: number): string {
	if (seconds < 60) return `${String(Math.round(seconds))} s`
	if (seconds < 3600) return `${String(Math.round(seconds / 60))} min`
	if (seconds < 86400) return `${String(Math.round(seconds / 3600))} h`
	return `${String(Math.round(seconds / 86400))} d`
}

export function ServiceHealthCard({ rows, source, loading, error, onRetry }: { rows: ServiceHealthRow[]; source: string | undefined; loading: boolean; error: boolean; onRetry: () => void }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
				<div>
					<CardTitle className="text-base">Service health</CardTitle>
					<CardDescription>Status of each service from its latest deployment, with its uptime since then.</CardDescription>
				</div>
				<DataSourceBadge source={source} />
			</CardHeader>
			<CardContent>
				<CardBody loading={loading} error={error} onRetry={onRetry} empty={rows.length === 0} height="h-64"
					emptyText="No services are registered yet, so there is no health to report."
					emptyAction={<Button asChild size="sm" variant="outline"><AuthDashboardProjects.Link>Go to projects</AuthDashboardProjects.Link></Button>}>
					<ul className="max-h-64 divide-y divide-border/50 overflow-y-auto">
						{rows.map((row) => (
							<li key={row.serviceName} className="flex items-center justify-between gap-3 py-2">
								<span className="truncate text-sm font-medium">{row.serviceName}</span>
								<span className="flex shrink-0 items-center gap-3">
									<span className="text-xs tabular-nums text-muted-foreground">up {formatUptime(row.uptime)}</span>
									<StatusBadge status={row.status} />
								</span>
							</li>
						))}
					</ul>
				</CardBody>
			</CardContent>
		</Card>
	)
}
