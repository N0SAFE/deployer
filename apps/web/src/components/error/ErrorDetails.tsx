'use client'

import { cn } from '@/lib/utils'

/**
 * ErrorDetails — the development-only error inspector.
 *
 * The block is identical everywhere an error can surface (default, feature and
 * query fallbacks), so it lives here once instead of being copy-pasted with
 * slightly different greys each time. Renders NOTHING in production: an
 * operator should see a recoverable message, never a stack trace.
 */
export function ErrorDetails({
  error,
  feature,
  className,
}: {
  error: Error
  /** Optional feature/context label, shown above the message. */
  feature?: string
  className?: string
}) {
  if (process.env.NODE_ENV !== 'development') return null

  return (
    <div
      className={cn(
        'rounded-xl bg-card/60 p-4 text-left ring-1 ring-border/60',
        className,
      )}
    >
      <p className="mb-2 text-sm font-medium text-foreground">Error details (development)</p>
      {feature ? (
        <p className="mb-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Feature:</span> {feature}
        </p>
      ) : null}
      <p className="text-xs wrap-break-word text-muted-foreground">{error.message}</p>
      {error.stack ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
            Stack trace
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto text-xs text-muted-foreground">
            {error.stack}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
