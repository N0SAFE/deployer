'use client'

import { Button } from '@repo/ui/components/shadcn/button'
import { RefreshCw, Siren } from 'lucide-react'

/**
 * PageLoadingState — consistent full-area loading for dashboard pages.
 * Mirrors the "spinner + label" pattern already used across the app.
 */
export function PageLoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

/**
 * PageErrorState — consistent full-area error with a retry action.
 * Errors are informative: what failed + how to recover, never a blank panel.
 */
export function PageErrorState({
  title = 'Failed to load',
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  title?: string
  message?: string
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <Siren className="size-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {message ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
          <RefreshCw className="mr-1.5 size-3.5" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
