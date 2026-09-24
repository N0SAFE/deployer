/**
 * @fileoverview Default Error Fallback Component
 * 
 * Generic error fallback UI for any React error.
 * Used by base ErrorBoundary when no custom fallback is provided.
 */

'use client'

import React from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { ErrorDetails } from './ErrorDetails'

interface DefaultErrorFallbackProps {
  /** The error that was caught */
  error: Error
  /** Function to reset the error boundary */
  onReset?: () => void
}

/**
 * Default fallback UI for error boundaries
 * 
 * Features:
 * - Clean, user-friendly error message
 * - Error details in development mode
 * - Reset button to recover
 * - Accessible design
 * 
 * @example
 * ```tsx
 * <ErrorBoundary fallback={(error, reset) => <DefaultErrorFallback error={error} onReset={reset} />}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export function DefaultErrorFallback({ error, onReset }: DefaultErrorFallbackProps): React.ReactElement {
  return (
    <div className="flex min-h-100 flex-col items-center justify-center p-8">
      <div className="max-w-md space-y-5 text-center">
        {/* Tinted icon disc — matches PageErrorState / QueryErrorFallback. */}
        <div className="flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-8 text-destructive" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            This section failed to render. Trying again usually fixes it — if it keeps
            happening, the details below will help us track it down.
          </p>
        </div>

        {onReset ? (
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
        ) : null}

        <ErrorDetails error={error} />
      </div>
    </div>
  )
}
