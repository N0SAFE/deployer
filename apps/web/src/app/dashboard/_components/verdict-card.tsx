'use client'

import { CheckCircle2, CircleAlert, CircleHelp, OctagonAlert } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { StatusDot } from '@/components/dashboard'
import { cn } from '@/lib/utils'
import type { PlatformVerdict } from '../_utils/platform-verdict'
import { AttentionLink } from './attention-link'

const LEVEL_STYLE = {
	healthy: { icon: CheckCircle2, text: 'text-status-live', ring: 'ring-status-live/20 bg-status-live/5', label: 'Healthy' },
	attention: { icon: CircleAlert, text: 'text-status-pending', ring: 'ring-status-pending/30 bg-status-pending/5', label: 'Needs attention' },
	critical: { icon: OctagonAlert, text: 'text-status-danger', ring: 'ring-status-danger/30 bg-status-danger/5', label: 'Action required' },
	unknown: { icon: CircleHelp, text: 'text-muted-foreground', ring: 'ring-border bg-muted/30', label: 'Unknown' },
} as const

/**
 * The page's verdict: one headline derived from evidence, then the concrete
 * items behind it, each with the page that fixes it.
 */
export function VerdictCard({ verdict, onRetry }: { verdict: PlatformVerdict; onRetry: () => void }) {
	if (verdict.level === 'loading') {
		return (
			<Card aria-busy="true" className="border-border/60 bg-card/40">
				<CardContent className="space-y-3 py-5">
					<Skeleton className="h-5 w-64" />
					<Skeleton className="h-4 w-96 max-w-full" />
					<Skeleton className="h-10 w-full" />
				</CardContent>
			</Card>
		)
	}
	const style = LEVEL_STYLE[verdict.level]
	const Icon = style.icon
	const [only] = verdict.items
	return (
		<Card className="border-border/60 bg-card/40">
			<CardContent className="space-y-4 py-5">
				<div role="status" className={cn('flex items-start gap-3 rounded-lg px-4 py-3 ring-1', style.ring)}>
					<Icon className={cn('mt-0.5 size-5 shrink-0', style.text)} aria-hidden />
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{style.label}</p>
						<p className="text-base font-semibold">{verdict.headline}</p>
						{verdict.detail ? <p className="mt-0.5 text-sm text-muted-foreground">{verdict.detail}</p> : null}
					</div>
					{verdict.level === 'unknown' ? (
						<Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
					) : null}
				</div>
				{verdict.items.length > 1 || (verdict.items.length === 1 && verdict.level === 'attention') ? (
					<ul className="divide-y divide-border/50">
						{verdict.items.map((item) => (
							<li key={item.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
								<StatusDot tone={item.tone} className="mt-1.5" />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium">{item.label}</p>
									<p className="text-sm text-muted-foreground">{item.detail}</p>
								</div>
								<AttentionLink item={item}>{item.targetLabel}</AttentionLink>
							</li>
						))}
					</ul>
				) : only !== undefined ? (
					<div className="px-1">
						<AttentionLink item={only}>{only.targetLabel} →</AttentionLink>
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
