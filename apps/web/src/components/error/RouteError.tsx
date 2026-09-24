'use client'

import { AlertCircle, LayoutDashboard, RotateCcw } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { AuthDashboard } from '@/routes'
import { ErrorDetails } from './ErrorDetails'

/**
 * RouteError — the surface every route-level `error.tsx` renders.
 *
 * Next replaces only the failing route's content, so the dashboard shell
 * (sidebar, breadcrumbs, live status) stays mounted and the operator can
 * navigate somewhere useful instead of hitting a dead end. That is the whole
 * reason this exists per-route rather than only at the app root.
 *
 * Message resolution goes through the typed-error helpers, so a DEFINED ORPC
 * failure shows the contract's own message and an unknown error never leaks
 * "undefined" into the UI.
 */
export function RouteError({
  error,
  reset,
  /** What the operator was looking at, e.g. "Containers". */
  scope,
}: {
  error: Error & { digest?: string }
  reset: () => void
  scope?: string
}) {
  const message = isDefinedORPCError(error)
    ? getErrorMessage(error)
    : 'This page hit an unexpected problem while loading its data.'

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16">
      <div className="max-w-md space-y-5 text-center">
        <div className="flex justify-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-7 text-destructive" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">
            {scope ? `${scope} couldn’t load` : 'This page couldn’t load'}
          </h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>

        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
          <Button asChild variant="ghost" size="sm">
            <AuthDashboard.Link>
              <LayoutDashboard className="size-3.5" />
              Back to dashboard
            </AuthDashboard.Link>
          </Button>
        </div>

        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}

        <ErrorDetails error={error} />
      </div>
    </div>
  )
}
