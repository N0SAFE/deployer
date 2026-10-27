'use client'

import type { ReactNode } from 'react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Hint } from '../../_components/hint'

/** Loading / error / empty states shared by the analytics cards, so one failing query never blanks the page. */
export function CardBody({
	loading, error, onRetry, empty, emptyText, emptyAction, height = 'h-60', children,
}: {
	loading: boolean
	error: boolean
	onRetry: () => void
	empty: boolean
	emptyText: ReactNode
	/** The next step when empty (UI-PRINCIPLES §1: an empty state names its next action). */
	emptyAction?: ReactNode
	height?: string
	children: ReactNode
}) {
	if (loading) return <Skeleton aria-busy="true" className={`${height} w-full`} />
	if (error) {
		return (
			<div role="alert" className={`flex ${height} flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground`}>
				<p>This card could not be loaded.</p>
				<Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
			</div>
		)
	}
	if (empty) {
		return (
			<div className={`flex ${height} flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground`}>
				<p>{emptyText}</p>
				{emptyAction}
			</div>
		)
	}
	return <>{children}</>
}

const SOURCE_HELP: Record<string, string> = {
	docker: 'Read from the Docker engine on the node serving this console.',
	deployments: 'Computed from the deployments recorded by this platform.',
	services: 'Computed from the services registered in this platform.',
	reports: 'Read from generated reports.',
	unavailable: 'No source is connected for this data, so nothing is plotted rather than guessing.',
}

export function DataSourceBadge({ source }: { source: string | undefined }) {
	const key = source ?? 'unavailable'
	return (
		<Hint content={SOURCE_HELP[key] ?? SOURCE_HELP.unavailable}>
			{key === 'unavailable' ? (
				<Badge variant="outline" className="border-dashed text-muted-foreground">No data source</Badge>
			) : (
				<Badge variant="secondary">Source: {key}</Badge>
			)}
		</Hint>
	)
}
