'use client'

import { RouteError } from '@/components/error/RouteError'

/**
 * App-level error boundary — catches anything the dashboard-scoped boundary
 * does not (auth, setup, and the root `(app)` group). The root layout's
 * html/body and providers are still mounted here, so this renders inside the
 * theme.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError error={error} reset={reset} />
}
