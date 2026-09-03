/**
 * @fileoverview Query Error Fallback Component
 *
 * Specialized fallback UI for TanStack Query errors.
 * Provides query-specific messaging and retry functionality.
 */

'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import React from 'react'
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { cn } from '@/lib/utils'

interface QueryErrorFallbackProps {
  /** The error that was caught */
  error: Error
  /** Function to reset and retry the query */
  onReset?: () => void
}

/**
 * Fallback UI specifically designed for query errors
 *
 * Features:
 * - Distinguishes network errors from other errors
 * - Clear retry action for users
 * - Helpful troubleshooting tips
 * - Accessible design
 * - Theme-token colors (works in light AND dark mode)
 *
 * @example
 * ```tsx
 * <QueryErrorBoundary fallback={(error, reset) => <QueryErrorFallback error={error} onReset={reset} />}>
 *   <DataFetchingComponent />
 * </QueryErrorBoundary>
 * ```
 */
export function QueryErrorFallback({ error, onReset }: QueryErrorFallbackProps): React.ReactElement {
  const isDevelopment = process.env.NODE_ENV === 'development'

  // A DEFINED ORPC error means the contract surfaced a typed failure
  // (payload.message explains it). Everything else is an unknown error:
  // network outage, unhandled 5xx, or a non-ORPC exception.
  const orpcErrorMessage = isDefinedORPCError(error) ? getErrorMessage(error) : null
  const isNetworkError = !orpcErrorMessage &&
    (error.message.toLowerCase().includes('network') ||
     error.message.toLowerCase().includes('fetch'))

  return (
    <div className="flex min-h-100 flex-col items-center justify-center p-8">
      <div className="max-w-md space-y-6 text-center">
        {/* Error Icon */}
        <div className="flex justify-center">
          <div
            className={cn(
              'flex size-20 items-center justify-center rounded-full',
              isNetworkError ? 'bg-amber-500/10' : 'bg-destructive/10',
            )}
          >
            {isNetworkError ? (
              <WifiOff className="size-10 text-amber-600 dark:text-amber-400" />
            ) : (
              <AlertCircle className="size-10 text-destructive" />
            )}
          </div>
        </div>

        {/* Error Message */}
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {isNetworkError ? 'Connection Problem' : 'Failed to Load Data'}
          </h2>
          <p className="text-muted-foreground">
            {orpcErrorMessage ?? (isNetworkError
              ? 'Unable to connect to the server. Please check your internet connection and try again.'
              : 'We had trouble loading the data. This might be a temporary issue.')}
          </p>
        </div>

        {/* Troubleshooting Tips */}
        <div className="rounded-md bg-card/60 p-4 text-left ring-1 ring-border/60">
          <p className="mb-2 text-sm font-medium text-foreground">What you can try:</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {isNetworkError ? (
              <>
                <li>• Check your internet connection</li>
                <li>• Disable VPN if you&apos;re using one</li>
                <li>• Try refreshing the page</li>
              </>
            ) : (
              <>
                <li>• Click &quot;Retry&quot; below</li>
                <li>• Refresh the page</li>
                <li>• Contact support if the problem persists</li>
              </>
            )}
          </ul>
        </div>

        {/* Error Details (Development Only) */}
        {isDevelopment && (
          <div className="rounded-md bg-card/60 p-4 text-left ring-1 ring-border/60">
            <p className="mb-2 text-sm font-medium text-foreground">Error Details (Development):</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </div>
        )}

        {/* Retry Button */}
        {onReset && (
          <Button onClick={onReset} size="default">
            <RefreshCw className="size-4" />
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
