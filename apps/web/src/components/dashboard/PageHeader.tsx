import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * PageHeader — the single page-title pattern for the dashboard.
 *
 * Consistent anatomy:
 *   eyebrow  → uppercase micro-label (context, e.g. "Docker workspace")
 *   title    → h1, `text-2xl font-semibold tracking-tight`
 *   badge    → inline status chip next to the title (e.g. "v3")
 *   description → muted, max-w-3xl
 *   actions  → right-aligned action cluster (buttons, links)
 *
 * The eyebrow carries structure (what section you're in), the title says
 * what the page is, and actions live at the top-right for scannability.
 */
export function PageHeader({
  eyebrow,
  title,
  badge,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  badge?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
