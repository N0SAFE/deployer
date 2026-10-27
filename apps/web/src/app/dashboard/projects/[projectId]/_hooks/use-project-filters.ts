'use client'

import { useSafeQueryParamStatesFromZod } from '@deployer/use-safe-query-param-states-from-zod'
import { projectFilterSchema, deploymentFilterSchema, type ProjectFilterParams } from '../_models/project-filters-schema'
import { useCallback } from 'react'

/**
 * Project filters hook
 *
 * Provides URL-synced filter state for the project detail page tabs.
 * Filters are shared across Overview and Dependencies tabs;
 * the Deployments tab uses a separate schema.
 *
 * Uses the @deployer/use-safe-query-param-states-from-zod pattern
 * for bidirectional URL sync with debounced writes.
 */

const FILTER_DEFAULTS: ProjectFilterParams = {
  search: '',
  status: 'all',
  risk: 'all',
  env: 'all',
  runtime: 'all',
  type: 'all',
  provider: 'all',
  runner: 'all',
  tags: [],
  fl: '_and',
  ar: undefined,
  tab: 'overview',
}

/** A patch that puts a single filter back to its default. */
function defaultPatch<K extends keyof ProjectFilterParams>(key: K): Partial<ProjectFilterParams> {
  const patch: Partial<ProjectFilterParams> = {}
  patch[key] = FILTER_DEFAULTS[key]
  return patch
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
      setFilters(defaultPatch(key))
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
