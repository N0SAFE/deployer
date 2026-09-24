'use client'

import { RouteError } from '@/components/error/RouteError'

/**
 * Project-scoped error boundary. Renders inside the project layout, so the
 * project's own navigation stays available while one view fails.
 */
export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError error={error} reset={reset} scope="This project" />
}
