'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Button } from '@repo/ui/components/shadcn/button'
import { RefreshCw, Siren } from 'lucide-react'
import { isDefinedORPCError, getErrorMessage } from '@/lib/orpc/typed-errors'
import { TableSkeleton } from '@/components/dashboard/Skeletons'

/** True once `loading` has lasted longer than `afterMs` — then say what we wait on. */
export function useSlowLoading(loading: boolean, afterMs = 5000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!loading) return
    const id = window.setTimeout(() => { setSlow(true) }, afterMs)
    return () => {
      window.clearTimeout(id)
      setSlow(false)
    }
  }, [loading, afterMs])
  return loading && slow
}

/** Readable reason for any thrown query error. */
export function errorReason(error: unknown): string {
  if (isDefinedORPCError(error)) return getErrorMessage(error, 'An unexpected error occurred.')
  if (error instanceof Error && error.message) return error.message
  return 'An unexpected error occurred.'
}

/** Table-shaped loading block inside an already rendered card, with a slow-load hint. */
export function ListLoading({ label, waitingOn, rows = 6, columns = 5 }: { label: string; waitingOn: string; rows?: number; columns?: number }) {
  const slow = useSlowLoading(true)
  return (
    <div className="space-y-3">
      <TableSkeleton rows={rows} columns={columns} label={label} />
      {slow ? (
        <p role="status" className="text-sm font-medium text-status-pending">
          Still loading — waiting on {waitingOn}. The platform API may be starting.
        </p>
      ) : null}
    </div>
  )
}

/** Inline (non full-page) error with retry — for sections inside a page that still renders. */
export function InlineError({ title, error, onRetry, action }: { title: string; error: unknown; onRetry?: () => void; action?: ReactNode }) {
  return (
    <Alert variant="destructive">
      <Siren className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{errorReason(error)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1.5 size-3.5" /> Retry
            </Button>
          ) : null}
          {action}
        </div>
      </AlertDescription>
    </Alert>
  )
}

/** Small section heading used inside tabbed detail pages (the page h1 lives in the layout). */
export function SectionHeading({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
