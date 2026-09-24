/**
 * @fileoverview Feature Error Fallback Component
 * 
 * Specialized fallback UI for feature-specific errors.
 * Provides contextual error messages based on the feature that failed.
 */

'use client'

import React from 'react'
import { AlertCircle, RotateCcw, LayoutDashboard } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { AuthDashboard } from '@/routes'
import { ErrorDetails } from './ErrorDetails'

interface FeatureErrorFallbackProps {
  /** The error that was caught */
  error: Error
  /** Feature/domain name for context */
  feature: string
  /** Function to reset the error boundary */
  onReset?: () => void
}

/**
 * Fallback UI with feature-specific context and actions
 * 
 * Features:
 * - Feature-specific error messages
 * - Contextual recovery suggestions
 * - Navigation options (reset or go home)
 * - Development error details
 * 
 * @example
 * ```tsx
 * <FeatureErrorBoundary
 *   feature="UserProfile"
 *   fallback={(error, reset, feature) => (
 *     <FeatureErrorFallback error={error} feature={feature} onReset={reset} />
 *   )}
 * >
 *   <UserProfile />
 * </FeatureErrorBoundary>
 * ```
 */
export function FeatureErrorFallback({
  error,
  feature,
  onReset,
}: FeatureErrorFallbackProps): React.ReactElement {
  // Feature-specific error messages
  const getFeatureMessage = (): string => {
    const lowerFeature = feature.toLowerCase()

    if (lowerFeature.includes('user') || lowerFeature.includes('profile')) {
      return 'We had trouble loading your profile. Your data is safe.'
    }
    if (lowerFeature.includes('admin') || lowerFeature.includes('dashboard')) {
      return 'We had trouble loading the admin dashboard. Please try again.'
    }
    if (lowerFeature.includes('settings')) {
      return 'We had trouble loading settings. Your changes are still saved.'
    }

    return `We had trouble loading ${feature}. Please try again.`
  }

  return (
    <div className="flex min-h-100 flex-col items-center justify-center p-8">
      <div className="max-w-md space-y-5 text-center">
        <div className="flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-8 text-destructive" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">{feature} failed to load</h2>
          <p className="text-sm text-muted-foreground">{getFeatureMessage()}</p>
        </div>

        {/* Scope reassurance: the failure is contained to this feature. */}
        <p className="rounded-xl bg-card/60 px-4 py-3 text-sm text-muted-foreground ring-1 ring-border/60">
          Only <span className="font-medium text-foreground">{feature}</span> is affected —
          the rest of the console keeps working.
        </p>

        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          {onReset ? (
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="size-3.5" />
              Try again
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <AuthDashboard.Link>
              <LayoutDashboard className="size-3.5" />
              Back to dashboard
            </AuthDashboard.Link>
          </Button>
        </div>

        <ErrorDetails error={error} feature={feature} />
      </div>
    </div>
  )
}
