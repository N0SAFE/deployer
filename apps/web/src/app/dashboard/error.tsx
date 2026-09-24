'use client'

import { RouteError } from '@/components/error/RouteError'

/**
 * Dashboard-scoped error boundary.
 *
 * Next renders this INSIDE `app/dashboard/layout.tsx`, so the sidebar,
 * breadcrumbs and header stay mounted — the operator can navigate straight to
 * another section instead of losing the whole console to a single failing page.
 * Without it, an error anywhere under /dashboard replaces the entire viewport.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError error={error} reset={reset} />
}
