import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusToneClasses, type StatusTone } from './status'

/**
 * StatStrip — the dense, single-row replacement for a 4-up KPI card grid.
 *
 * WHY THIS EXISTS
 * ---------------
 * A top-of-page strip of tall metric cards spends an enormous amount of ink to
 * communicate very little: each card surrounds one integer with a border,
 * padding, a title row, an icon and often a hover state. On a page whose real
 * content (a table, a timeline, a form) sits underneath, that strip is the
 * reason the thing people came for starts below the fold.
 *
 * This renders the same facts as one wrapping row: `icon label value · hint`.
 * It is denser, it survives narrow viewports by wrapping rather than stacking
 * four full-width cards, and it keeps the numbers visually subordinate to the
 * page's actual subject.
 *
 * USE IT FOR numbers that give the section below its scale. Not for navigation
 * (use a link), and not when the "value" is not a number.
 *
 * A11y: each pair is a plain label + value in reading order, and the value uses
 * `tabular-nums` so columns of figures line up. Deliberately NOT a `<dl>`: `<dt>`
 * and `<dd>` may not be separated by other elements, which would forbid the icon
 * and hint spans this component needs. A label sitting immediately before its
 * value reads correctly without it.
 */
export function StatStrip({
	children,
	className,
	/** Right-aligned trailing content, e.g. a single action link. */
	trailing,
	/**
	 * Drop the border/fill. Use when the strip already sits inside a bordered
	 * surface (a card footer, a table baseline) and its own chrome would nest
	 * a second box inside the first.
	 */
	bare = false,
}: {
	children: ReactNode
	className?: string
	trailing?: ReactNode
	bare?: boolean
}) {
	return (
		<div
			className={cn(
				'flex flex-wrap items-center gap-x-6 gap-y-3',
				!bare && 'rounded-xl border border-border/60 bg-card/30 px-4 py-3',
				className,
			)}
		>
			{children}
			{trailing ? <div className="ml-auto">{trailing}</div> : null}
		</div>
	)
}

/**
 * One label/value pair inside a `StatStrip`.
 *
 * Read-only by design: a strip summarises the section below it, and every page
 * that needs a link to that section already places one where the section is.
 * Making individual figures navigable turned them into unexplained jump targets.
 */
export function StatStripItem({
	icon: Icon,
	label,
	value,
	hint,
	tone,
	className,
}: {
	icon?: LucideIcon
	label: string
	/** `undefined` renders an em dash — "unknown" is not "zero". */
	value: ReactNode
	hint?: ReactNode
	tone?: StatusTone
	className?: string
}) {
	return (
		<div className={cn('flex items-center gap-2', className)}>
			{Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
			<span className="text-xs text-muted-foreground">{label}</span>
			<span
				className={cn(
					'text-sm font-medium tabular-nums',
					tone ? statusToneClasses[tone] : 'text-foreground',
				)}
			>
				{value ?? '—'}
			</span>
			{hint ? (
				<span className="hidden truncate text-xs text-muted-foreground sm:inline">· {hint}</span>
			) : null}
		</div>
	)
}
