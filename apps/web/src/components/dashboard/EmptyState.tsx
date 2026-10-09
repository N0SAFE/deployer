'use client'

import { cn } from '@/lib/utils'
import { Button } from '@repo/ui/components/shadcn/button'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * EmptyState — "nothing exists yet" panel (NOT for filtered-out lists: use
 * `FilteredEmptyState`). Say what the list would hold and the next action:
 * "No deployments yet — deploy a service".
 * A blank panel is never an empty state: icon → title → description
 * (why it's empty + what happens next) → one primary action.
 *
 * The action is a click handler, never an `href`. An earlier revision also
 * accepted `href`+`asChild` and rendered a bare `<a>`, which bypasses the
 * declarative router (full page reload, and a link that survives a route
 * rename without the compiler noticing). No caller ever used it; navigation
 * belongs to the caller, which knows the route and can call `router.push`.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  /** Primary action — the one thing that makes the list non-empty. */
  action?: { label: string; onClick?: () => void }
  /** Optional quieter second action (e.g. "Read the docs"). */
  secondaryAction?: { label: string; onClick?: () => void }
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 bg-background/30 px-6 text-center',
        compact ? 'py-6' : 'py-12',
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-muted/60">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action ? (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button size="sm" variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * FilteredEmptyState — a list that HAS data but everything is filtered out.
 * Only for views with filters applied; a list that is simply empty uses
 * `EmptyState`.
 */
export function FilteredEmptyState({
  onClear,
  label = 'Nothing matches the current filters.',
  className,
}: {
  onClear?: () => void
  label?: string
  className?: string
}) {
  return (
    <div role="status" className={cn('flex flex-wrap items-center justify-center gap-2 py-6 text-sm text-muted-foreground', className)}>
      <span>{label}</span>
      {onClear ? (
        <Button variant="link" size="sm" className="h-auto p-0 text-sm" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
