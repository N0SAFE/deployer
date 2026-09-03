/**
 * Project Detail Page — Shared Types
 *
 * Extracted from the monolithic projects/[projectId]/page.tsx
 * to support the multi-tab decomposition.
 */

/** Source of truth for an environment scope derivation */
export type EnvironmentScopeSource =
  | 'core-default'
  | 'status-by-environment'
  | 'execution-override'
  | 'deployment-scope'

/** Environment contract for a single service */
export interface ServiceEnvironmentContract {
  serviceId: string
  declaredScopes: string[]
  scopeSourceMap: Record<string, EnvironmentScopeSource>
  variableKeysByScope: Record<string, string[]>
}

/** Dependency route accessibility preview */
export interface DependencyRoutePreview {
  dependencyId: string
  targetServiceId: string
  sourceScope: string
  targetScope: string
  accessible: boolean
}

/** Filterable fields on a service record */
export interface ServiceFilterRecord {
  name: string
  id: string
  type: string
  runtime: string
  providerType: string
  runnerType: string
  state: string
  health: string
  environments: string
}

/** A single rule in the advanced filter builder */
export interface AdvancedServiceFilterRule {
  id: string
  field: string
  operator: string
  value: string
}

export type AdvancedFilterLogic = '_and' | '_or'
export type AdvancedFilterField = (typeof ADVANCED_FILTER_FIELDS)[number]
export type AdvancedFilterOperator = (typeof ADVANCED_FILTER_OPERATORS)[number]

/** Quick-service filter tags */
export const QUICK_SERVICE_FILTER_TAGS = [
  'at-risk',
  'healthy',
  'has-dependencies',
  'no-dependencies',
  'active',
  'inactive',
] as const

/** Fields available for advanced filtering */
export const ADVANCED_FILTER_FIELDS = [
  { id: 'name', label: 'Name', type: 'string' as const },
  { id: 'id', label: 'ID', type: 'string' as const },
  { id: 'type', label: 'Type', type: 'string' as const },
  { id: 'runtime', label: 'Runtime', type: 'string' as const },
  { id: 'providerType', label: 'Provider', type: 'string' as const },
  { id: 'runnerType', label: 'Runner', type: 'string' as const },
  { id: 'state', label: 'State', type: 'string' as const },
  { id: 'health', label: 'Health', type: 'string' as const },
  { id: 'environments', label: 'Environments', type: 'string' as const },
] as const

/** Operators available for advanced filtering */
export const ADVANCED_FILTER_OPERATORS = [
  { id: '_icontains', label: 'Contains', type: 'string' as const },
  { id: '_eq', label: 'Equals', type: 'string' as const },
  { id: '_neq', label: 'Not equals', type: 'string' as const },
  { id: '_starts_with', label: 'Starts with', type: 'string' as const },
  { id: '_ends_with', label: 'Ends with', type: 'string' as const },
  { id: '_in', label: 'In list', type: 'string' as const },
  { id: '_nin', label: 'Not in list', type: 'string' as const },
] as const
