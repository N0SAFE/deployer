'use client'

import { Rocket } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { EmptyState, EnvironmentBadge, PageErrorState, StatusBadge } from '@/components/dashboard'
import {
	AuthDashboardDeployments,
	AuthDashboardProjects,
	AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
} from '@/routes'
import { useRouter } from 'next/navigation'
import { RelativeTime } from './relative-time'

export interface RecentDeployment {
	id: string
	serviceId: string
	serviceName: string | null
	projectId: string | null
	status: string
	environment: string
	createdAt: string
}

/** The last rollouts, named after their service, each linking to that service's history. */
export function RecentDeploymentsCard({
	deployments,
	loading,
	error,
	onRetry,
}: {
	deployments: RecentDeployment[]
	loading: boolean
	error: boolean
	onRetry: () => void
}) {
	const router = useRouter()
	return (
		<Card className="border-border/60 bg-card/40">
			<CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
				<div>
					<CardTitle className="text-sm">Recent deployments</CardTitle>
					<CardDescription className="text-xs">Latest rollouts across all services and environments.</CardDescription>
				</div>
				<AuthDashboardDeployments.Link>
					<Button variant="ghost" size="sm" className="h-7 px-2 text-xs">View all</Button>
				</AuthDashboardDeployments.Link>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div aria-busy="true" className="space-y-1.5">
						{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
					</div>
				) : error ? (
					<PageErrorState title="Could not load deployments" onRetry={onRetry} />
				) : deployments.length === 0 ? (
					<EmptyState
						compact
						icon={Rocket}
						title="No deployments yet"
						description="Each rollout of a service shows up here with its status. Create a project and deploy a service to get started."
						action={{ label: 'Create a project', onClick: () => { router.push(AuthDashboardProjects()) } }}
					/>
				) : (
					<ul className="space-y-0.5">
						{deployments.map((dep) => (
							<li key={dep.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/30">
								<div className="min-w-0 flex-1">
									{dep.projectId !== null ? (
										<AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link
											projectId={dep.projectId}
											serviceId={dep.serviceId}
											className="block truncate text-sm font-medium hover:underline"
										>
											{dep.serviceName ?? 'Unnamed service'}
										</AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link>
									) : (
										<span className="block truncate text-sm font-medium">{dep.serviceName ?? 'Deleted service'}</span>
									)}
								</div>
								<EnvironmentBadge environment={dep.environment} className="hidden sm:inline-flex" />
								<StatusBadge status={dep.status} className="shrink-0" />
								<RelativeTime value={dep.createdAt} className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground" />
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}
