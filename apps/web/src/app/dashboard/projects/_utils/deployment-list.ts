import { deploymentStartedAt, isInProgress, toTime } from './workload'

export type DeploymentSort = 'newest' | 'oldest' | 'status' | 'environment' | 'service'
export type StatusFilter = 'all' | 'in-progress' | 'success' | 'failed' | 'cancelled'

export interface ListedDeployment {
  id: string
  serviceId: string
  status: string
  environment?: string | null
  triggeredBy?: string | null
  createdAt?: string | Date | null
  buildStartedAt?: string | Date | null
  deployStartedAt?: string | Date | null
}

export interface DeploymentFilters {
  search: string
  status: StatusFilter
  environment: string
  serviceId?: string
}

export function hasActiveFilters(f: DeploymentFilters): boolean {
  return f.search.trim() !== '' || f.status !== 'all' || f.environment !== 'all' || (f.serviceId !== undefined && f.serviceId !== 'all')
}

/** `serviceName` resolves a service id to its display name so searching by name works. */
export function filterDeployments<T extends ListedDeployment>(
  list: readonly T[],
  f: DeploymentFilters,
  serviceName: (id: string) => string,
): T[] {
  const q = f.search.trim().toLowerCase()
  return list.filter((d) => {
    if (f.status === 'in-progress' ? !isInProgress(d.status) : f.status !== 'all' && d.status !== f.status) return false
    if (f.environment !== 'all' && d.environment !== f.environment) return false
    if (f.serviceId !== undefined && f.serviceId !== 'all' && d.serviceId !== f.serviceId) return false
    if (!q) return true
    return (
      d.id.toLowerCase().includes(q)
      || serviceName(d.serviceId).toLowerCase().includes(q)
      || (d.triggeredBy ?? '').toLowerCase().includes(q)
    )
  })
}

export function sortDeployments<T extends ListedDeployment>(
  list: readonly T[],
  sort: DeploymentSort,
  serviceName: (id: string) => string,
): T[] {
  const started = (d: T) => toTime(deploymentStartedAt(d)) ?? 0
  const copy = [...list]
  copy.sort((a, b) => {
    switch (sort) {
      case 'oldest': return started(a) - started(b)
      case 'status': return a.status.localeCompare(b.status) || started(b) - started(a)
      case 'environment': return (a.environment ?? '').localeCompare(b.environment ?? '') || started(b) - started(a)
      case 'service': return serviceName(a.serviceId).localeCompare(serviceName(b.serviceId)) || started(b) - started(a)
      default: return started(b) - started(a)
    }
  })
  return copy
}
