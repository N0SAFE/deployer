'use client'

import { RouteError } from '@/components/error/RouteError'

/**
 * Service-scoped error boundary. Renders inside the service layout, so the
 * service's tab bar stays available while one tab fails.
 */
export default function ServiceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError error={error} reset={reset} scope="This service" />
}
