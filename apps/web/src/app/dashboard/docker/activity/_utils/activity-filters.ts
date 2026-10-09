import { z } from 'zod'
import type { DockerRuntimeActivityEntity } from '@repo/contracts-entities'
import { activityKind, describeActivity } from './describe-activity'
import { resolveResourceName, resolveSwarmTaskErrors } from './activity-fields'

export const KIND_FILTERS = ['all', 'container', 'image', 'network', 'volume', 'swarm', 'other'] as const
export const SEVERITY_FILTERS = ['all', 'info', 'warning', 'error'] as const
export const STATUS_FILTERS = ['all', 'queued', 'running', 'completed', 'error', 'info'] as const

export const ACTIVITY_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  kind: z.enum(KIND_FILTERS).default('all'),
  severity: z.enum(SEVERITY_FILTERS).default('all'),
  status: z.enum(STATUS_FILTERS).default('all'),
})

export type ActivityFilters = z.infer<typeof ACTIVITY_QUERY_SCHEMA>

export function hasActiveFilters(filters: ActivityFilters): boolean {
  return filters.q.trim() !== '' || filters.kind !== 'all' || filters.severity !== 'all' || filters.status !== 'all'
}

export function filterActivities(
  activities: readonly DockerRuntimeActivityEntity[],
  filters: ActivityFilters,
): DockerRuntimeActivityEntity[] {
  const needle = filters.q.trim().toLowerCase()
  return activities.filter((activity) => {
    if (filters.kind !== 'all' && activityKind(activity.source) !== filters.kind) return false
    if (filters.severity !== 'all' && activity.severity !== filters.severity) return false
    if (filters.status !== 'all' && activity.status !== filters.status) return false
    if (!needle) return true
    const resourceName = resolveResourceName(activity)
    const haystack = [
      describeActivity({ source: activity.source, action: activity.action, resourceName }),
      activity.source,
      activity.action,
      resourceName,
      activity.stage,
      activity.scanner,
      activity.message,
      activity.swarmService?.serviceName,
      ...resolveSwarmTaskErrors(activity),
    ]
    return haystack.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
  })
}
