'use client'

import { cn } from '@/lib/utils'
import { Button } from '@repo/ui/components/shadcn/button'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * EmptyState — action-oriented empty panel.
 * A blank panel is never an empty state: icon → title → description
 * (why it's empty + what happens next) → one primary action.
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
  action?: { label: string; onClick?: () => void; href?: string; asChild?: boolean }
  className?: string
  compact?: boolean
}) {
  const Action =
    action && action.asChild && action.href ? (
      <Button asChild size="sm" variant="outline" className="mt-1">
        <a href={action.href}>{action.label}</a>
      </Button>
    ) : action ? (
      <Button size="sm" variant="outline" className="mt-1" onClick={action.onClick}>
        {action.label}
      </Button>
    ) : null

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
      {Action}
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
