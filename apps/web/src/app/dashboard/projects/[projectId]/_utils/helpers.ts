/**
 * Project Detail Page — Helper Utilities
 *
 * Generic utility functions extracted from the monolithic page.tsx.
 */

import { statusMeta } from '@/components/dashboard'

/**
 * Format an ISO date string to a locale date string.
 */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
}

/**
 * Return the first 8 characters of a string (for display IDs).
 */
export function shortId(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 8)
}

/**
 * Map a service status string to a badge variant.
 *
 * SSOT: delegates to the semantic status matrix in `@/components/dashboard`
 * (statusMeta) so the two systems can never drift. Prefer the full
 * `StatusBadge` component (icon + dot + label) for new UI — this helper
 * exists only for call sites that need a plain variant string.
 */
export function statusBadgeVariant(
  status: string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  return statusMeta(status).variant
}

/**
 * Normalize an identifier string to UPPER_SNAKE_CASE.
 */
export function normalizeIdentifierSegment(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Check if a dependency is reachable for a given environment scope.
 */
export function isDependencyEnabledInScope(
  _dependency: any,
  _scope: string,
): boolean {
  // Placeholder — actual logic depends on service config data
  return true
}

/**
 * Resolve which target scope a dependency routes to.
 */
export function resolveDependencyTargetScope(_input: any): string {
  // Placeholder — actual logic depends on dependency policy
  return 'production'
}
