/**
 * Pure helpers shared by the workload pages (projects, services, deployments).
 *
 * Deployment statuses come from the contract:
 * pending | queued | building | deploying | success | failed | cancelled.
 * There is NO "in-progress" or "rolled-back" status — pages that filtered on
 * those matched nothing, so "in progress" was permanently zero.
 */

export const IN_PROGRESS_STATUSES = ['pending', 'queued', 'building', 'deploying'] as const
export const DEPLOYMENT_STATUSES = ['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled'] as const

export type DeploymentStatusValue = (typeof DEPLOYMENT_STATUSES)[number]

export function isInProgress(status: string | null | undefined): boolean {
  return (IN_PROGRESS_STATUSES as readonly string[]).includes((status ?? '').toLowerCase())
}

type DateLike = string | number | Date | null | undefined

export function toTime(value: DateLike): number | null {
  if (value === null || value === undefined || value === '') return null
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

/** "45s", "3m 05s", "2h 10m". Null for negative / unknown. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—'
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${String(totalSeconds)}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(totalSeconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** "just now", "3 min ago", "2 h ago", "5 d ago". Future or unknown → "—". */
export function formatRelative(value: DateLike, now: number): string {
  const t = toTime(value)
  if (t === null) return '—'
  const diff = now - t
  if (diff < 0) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 1) return '1 min ago'
  if (m < 60) return `${String(m)} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${String(h)} h ago`
  const d = Math.floor(h / 24)
  if (d < 60) return `${String(d)} d ago`
  const mo = Math.floor(d / 30)
  return `${String(mo)} mo ago`
}

export interface DeploymentTimes {
  createdAt?: DateLike
  buildStartedAt?: DateLike
  buildCompletedAt?: DateLike
  deployStartedAt?: DateLike
  deployCompletedAt?: DateLike
}

export function deploymentStartedAt(d: DeploymentTimes): DateLike {
  return d.buildStartedAt ?? d.deployStartedAt ?? d.createdAt
}

/** Start→finish duration; a still-running deployment ages against `now`. */
export function deploymentDurationMs(d: DeploymentTimes, status: string, now: number): number | null {
  const start = toTime(deploymentStartedAt(d))
  if (start === null) return null
  const end = toTime(d.deployCompletedAt ?? d.buildCompletedAt)
  if (end !== null) return end >= start ? end - start : null
  return isInProgress(status) ? Math.max(0, now - start) : null
}

export interface DeploymentSummary {
  total: number
  success: number
  failed: number
  inProgress: number
  /** null when no deployment has finished — "0%" would be a claim without evidence. */
  successRate: number | null
}

export function summarizeDeployments(list: readonly { status: string }[]): DeploymentSummary {
  const success = list.filter((d) => d.status === 'success').length
  const failed = list.filter((d) => d.status === 'failed').length
  const inProgress = list.filter((d) => isInProgress(d.status)).length
  const finished = success + failed
  return {
    total: list.length,
    success,
    failed,
    inProgress,
    successRate: finished > 0 ? Math.round((success / finished) * 1000) / 10 : null,
  }
}

export interface RollbackCandidate {
  id: string
  serviceId: string
  environment?: string | null
  status: string
  createdAt?: DateLike
}

/**
 * Rolling back needs a `targetDeploymentId`: the most recent SUCCESSFUL
 * deployment of the same service + environment that is older than `current`.
 */
export function findRollbackTarget<T extends RollbackCandidate>(
  list: readonly T[],
  current: RollbackCandidate,
): T | null {
  const currentTime = toTime(current.createdAt)
  let best: T | null = null
  let bestTime = -Infinity
  for (const d of list) {
    if (d.id === current.id || d.status !== 'success') continue
    if (d.serviceId !== current.serviceId) continue
    if ((d.environment ?? null) !== (current.environment ?? null)) continue
    const t = toTime(d.createdAt)
    if (t === null) continue
    if (currentTime !== null && t >= currentTime) continue
    if (t > bestTime) {
      best = d
      bestTime = t
    }
  }
  return best
}

/** Latest item per key, by `createdAt` (the API does not guarantee ordering). */
export function latestBy<T extends { createdAt?: DateLike }>(
  list: readonly T[],
  key: (item: T) => string | null | undefined,
): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of list) {
    const k = key(item)
    if (!k) continue
    const existing = map.get(k)
    if (!existing || (toTime(item.createdAt) ?? 0) > (toTime(existing.createdAt) ?? 0)) map.set(k, item)
  }
  return map
}
