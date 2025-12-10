/**
 * Shared formatting utilities for the dashboard
 */

/**
 * Format a date/time value as a relative time string (e.g., "5m ago", "2h ago")
 */
export function formatRelativeTime(value?: string | number | Date | null): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const diff = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.round(diff / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${String(minutes)}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`

  const days = Math.round(hours / 24)
  if (days < 7) return `${String(days)}d ago`

  const weeks = Math.round(days / 7)
  if (weeks < 4) return `${String(weeks)}w ago`

  return date.toLocaleDateString()
}

/**
 * Format a duration in seconds to a human-readable string
 */
export function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null) return '—'
  if (seconds < 60) return `${String(Math.round(seconds))}s`
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m`
  return `${String(Math.round(seconds / 3600))}h`
}

/**
 * Format bytes to a human-readable string (e.g., "1.5 GB")
 */
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return '—'
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${String(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`
  return `${String(Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10)} GB`
}

/**
 * Format a percentage value
 */
export function formatPercent(value?: number | null, decimals = 1): string {
  if (value === undefined || value === null) return '—'
  return `${String(Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals))}%`
}

/**
 * Truncate a string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength - 3)}...`
}

/**
 * Format a commit hash (short form)
 */
export function formatCommitHash(hash?: string | null): string {
  if (!hash) return '—'
  return hash.slice(0, 7)
}
