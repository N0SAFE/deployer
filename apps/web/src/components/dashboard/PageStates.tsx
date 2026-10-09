'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Check, Copy, RefreshCw, Siren } from 'lucide-react'
import { PageSkeleton } from './Skeletons'

/**
 * PageLoadingState — consistent loading state for dashboard pages: a skeleton
 * of the page plus one status line. If loading takes longer than `slowAfterMs`
 * (default 5 s) it says what it is waiting on, so a slow platform API does not
 * look like a frozen page.
 *
 * Existing `label` usage is unchanged. `description` names what is loading;
 * `slowHint` replaces the default timeout sentence; `skeleton={false}` falls
 * back to the compact spinner for tight spots (inside a small card).
 */
export function PageLoadingState({
  label = 'Loading…',
  description,
  slowAfterMs = 5000,
  slowHint = 'Still loading — the platform API may be starting.',
  skeleton = true,
}: {
  label?: string
  description?: ReactNode
  slowAfterMs?: number
  slowHint?: ReactNode
  skeleton?: boolean
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSlow(true)
    }, slowAfterMs)
    return () => {
      window.clearTimeout(id)
    }
  }, [slowAfterMs])

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      {skeleton ? (
        <PageSkeleton label={label} blocks={1} withStrip={false} />
      ) : (
        <div className="flex min-h-40 items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
        </div>
      )}
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{label}</p>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        {slow ? <p className="mt-1 text-sm font-medium text-status-pending">{slowHint}</p> : null}
      </div>
    </div>
  )
}

function CopyDetails({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => {
            setCopied(false)
          }, 1500)
        })
      }}
    >
      {copied ? <Check className="mr-1.5 size-3.5" /> : <Copy className="mr-1.5 size-3.5" />}
      {copied ? 'Copied' : 'Copy error details'}
    </Button>
  )
}

/**
 * PageErrorState — full-area error with a retry action. States what failed and
 * how to recover, never a blank panel. `details` (e.g. an error id or the raw
 * message) is shown in a small mono line with a copy button for support.
 * `secondaryAction` renders next to Retry (e.g. a "Back to dashboard" link).
 */
export function PageErrorState({
  title = 'Failed to load',
  message,
  onRetry,
  retryLabel = 'Retry',
  details,
  secondaryAction,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  retryLabel?: string
  details?: string
  secondaryAction?: ReactNode
}) {
  return (
    <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <Siren className="size-6 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {message ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p> : null}
        {details ? <p className="mx-auto max-w-md break-all font-mono text-xs text-muted-foreground">{details}</p> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {retryLabel}
          </Button>
        ) : null}
        {secondaryAction}
        {details ? <CopyDetails value={details} /> : null}
      </div>
    </div>
  )
}
