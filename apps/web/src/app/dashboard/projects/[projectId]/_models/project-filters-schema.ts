import { z } from 'zod/v4'

/**
 * Project Detail Page — URL Filter Schema
 *
 * Unified filter schema shared across Overview and Dependencies tabs.
 * Uses useSafeQueryParamStatesFromZod for bidirectional URL sync.
 *
 * Core service filters: search, status, risk, env, runtime, type, provider, runner, tags
 * Advanced filter: logic connector (fl) + rules (stored in session storage, URL for small payloads)
 * Tab selection: tab param drives which view is shown
 */

export const projectFilterSchema = z.object({
  // Core text search
  search: z.string().default(''),

  // Enums with safe defaults
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  risk: z.enum(['all', 'at-risk', 'healthy']).default('all'),

  // String filters — "all" means no filter
  env: z.string().default('all'),
  runtime: z.string().default('all'),
  type: z.string().default('all'),
  provider: z.string().default('all'),
  runner: z.string().default('all'),

  // Quick-tag filters (multi-select via array)
  tags: z.array(z.string()).default([]),

  // Advanced filter logic connector
  fl: z.enum(['_and', '_or']).default('_and'),

  // Advanced filter rules as JSON string (URL fallback for small payloads)
  // Primary storage is session storage; URL is best-effort for shareability
  ar: z.string().optional(),

  // Tab selection
  tab: z.enum(['overview', 'dependencies', 'deployments']).default('overview'),
})

/** Filter schema for the Deployments tab (separate — different fields) */
export const deploymentFilterSchema = z.object({
  status: z.enum(['all', 'running', 'success', 'failed', 'cancelled']).default('all'),
  environment: z.string().default('all'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
})

export type ProjectFilterParams = z.infer<typeof projectFilterSchema>
export type DeploymentFilterParams = z.infer<typeof deploymentFilterSchema>
