'use client'

import { cn } from '@/lib/utils'
import { Button } from '@repo/ui/components/shadcn/button'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * EmptyState — action-oriented empty panel.
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
  className,
  compact = false,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: { label: string; onClick?: () => void }
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
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {action ? (
        <Button size="sm" variant="outline" className="mt-1" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * FilteredEmptyState — compact "no results match filters" with a clear action.
 */
export function FilteredEmptyState({
  onClear,
  label = 'No results match these filters.',
  className,
}: {
  onClear?: () => void
  label?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground', className)}>
      <span>{label}</span>
      {onClear ? (
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
