'use client'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type StatTone = 'default' | 'success' | 'destructive' | 'warning' | 'info'

const toneChip: Record<StatTone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  destructive: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
}

/**
 * StatCard — the glass KPI card used across the dashboard.
 *
 * Modern anatomy: muted micro-label on top, icon chip top-right,
 * large tabular value, optional hint line. Loading shows a skeleton.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'default',
  loading = false,
  className,
}: {
  label: string
  value: ReactNode
  icon?: LucideIcon
  hint?: string
  tone?: StatTone
  loading?: boolean
  className?: string
}) {
  return (
    <Card className={cn('border-border/60 bg-card/40 backdrop-blur-xl', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          {Icon ? (
            <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', toneChip[tone])}>
              <Icon className="size-4" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-8 w-14" />
        ) : (
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        )}
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
