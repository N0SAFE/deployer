/**
 * Utilisation percentage → the colour of its bar. `null` means the node
 * publishes no limit (unbounded), a different state from "empty".
 */
export function utilisationIndicatorClass(pct: number | null): string {
  if (pct === null) return '*:data-[slot=progress-indicator]:bg-status-idle'
  if (pct >= 90) return '*:data-[slot=progress-indicator]:bg-status-danger'
  if (pct >= 70) return '*:data-[slot=progress-indicator]:bg-status-pending'
  return '*:data-[slot=progress-indicator]:bg-status-live'
}

export function utilisationPct(used: number, max: number | null | undefined): number | null {
  return max != null && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : null
}

export function formatMemory(mb: number | null | undefined): string {
  if (mb == null) return 'no limit'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${String(mb)} MB`
}

export function formatCpu(millicores: number | null | undefined): string {
  if (millicores == null) return 'no limit'
  return `${(millicores / 1000).toFixed(1)} vCPU`
}

export const ALLOCATION_MODE_LABEL: Record<string, string> = {
  shared_slice: 'Shared slice',
  dedicated_slice: 'Dedicated slice',
  dedicated_full: 'Whole node',
}
