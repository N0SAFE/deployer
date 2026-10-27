'use client'

import { Loader2 } from 'lucide-react'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { TableCell, TableRow } from '@deployer/ui/components/shadcn/table'
import { cn } from '@/lib/utils'

interface DockerInlineLoadingStateProps {
  label?: string
  className?: string
}

interface DockerTableLoadingRowsProps {
  columns: number
  rows?: number
}

interface DockerDetailLoadingStateProps {
  label?: string
}

export function DockerInlineLoadingState({ label = 'Loading runtime data…', className }: DockerInlineLoadingStateProps) {
  return (
    <div className={cn('flex items-center gap-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground', className)}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{label}</span>
    </div>
  )
}

export function DockerTableLoadingRows({ columns, rows = 6 }: DockerTableLoadingRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <TableRow key={`docker-table-loading-row-${String(rowIndex)}`}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <TableCell key={`docker-table-loading-cell-${String(rowIndex)}-${String(columnIndex)}`}>
              <Skeleton className="h-4 w-full max-w-55" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

export function DockerDetailLoadingState({ label = 'Loading details…' }: DockerDetailLoadingStateProps) {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-border/70 bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-28 w-full" />
    </div>
  )
}

/** Table-in-a-card skeleton: header strip plus rows. Use instead of a bare spinner. */
export function DockerTableSkeleton({ columns = 5, rows = 6, label }: { columns?: number; rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-xl border border-border/60">
      <span className="sr-only">{label ?? 'Loading…'}</span>
      <div className="flex gap-4 border-b border-border/60 bg-muted/30 px-4 py-2.5">
        {Array.from({ length: columns }, (_, i) => <Skeleton key={i} className="h-3 w-20" />)}
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4">
            {Array.from({ length: columns }, (__, c) => <Skeleton key={c} className="h-4 flex-1" />)}
          </div>
        ))}
      </div>
      {label ? <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">{label}</p> : null}
    </div>
  )
}

/** Whole-page skeleton: toolbar line plus a table skeleton. */
export function DockerPageSkeleton({ label, columns = 5 }: { label?: string; columns?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-24" />
      </div>
      <DockerTableSkeleton columns={columns} label={label} />
    </div>
  )
}
