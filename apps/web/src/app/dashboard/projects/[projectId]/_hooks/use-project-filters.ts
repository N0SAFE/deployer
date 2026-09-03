'use client'

import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'
import { projectFilterSchema, deploymentFilterSchema, type ProjectFilterParams } from '../_models/project-filters-schema'
import { useCallback, useMemo } from 'react'

/**
 * Project filters hook
 *
 * Provides URL-synced filter state for the project detail page tabs.
 * Filters are shared across Overview and Dependencies tabs;
 * the Deployments tab uses a separate schema.
 *
 * Uses the @repo/use-safe-query-param-states-from-zod pattern
 * for bidirectional URL sync with debounced writes.
 */

const FILTER_DEFAULTS = {
  search: '',
  status: 'all' as const,
  risk: 'all' as const,
  env: 'all',
  runtime: 'all',
  type: 'all',
  provider: 'all',
  runner: 'all',
  tags: [] as string[],
  fl: '_and' as const,
  tab: 'overview' as const,
}

export function useProjectFilters() {
  const [filters, setFilters] = useSafeQueryParamStatesFromZod(projectFilterSchema, {
    delay: 200,
  })

  const resetAllFilters = useCallback(() => {
    setFilters(null)
  }, [setFilters])

  const clearFilter = useCallback(
    (key: keyof ProjectFilterParams) => {
      setFilters({ [key]: FILTER_DEFAULTS[key as keyof typeof FILTER_DEFAULTS] as any })
    },
    [setFilters],
  )

  return { filters, setFilters, resetAllFilters, clearFilter }
}

/**
 * Deployments tab filters hook
 */
export function useDeploymentFilters() {
  const [filters, setFilters] = useSafeQueryParamStatesFromZod(deploymentFilterSchema)

  const resetFilters = useCallback(() => {
    setFilters(null)
  }, [setFilters])

  return { filters, setFilters, resetFilters }
}
