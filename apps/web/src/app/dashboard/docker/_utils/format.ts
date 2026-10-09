/**
 * Pure formatting helpers for the Node engine pages (sizes, relative times, ids).
 * Deterministic on purpose: no locale/timezone lookups, so server and client agree.
 */

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const

/** `1536` -> `"1.5 KiB"`. Returns `fallback` for absent / non-finite / negative input. */
export function formatBytes(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return fallback
  let size = value
  let unit = 0
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  const digits = unit === 0 || size >= 100 ? 0 : size >= 10 ? 1 : 2
  const text = unit === 0 ? String(Math.round(size)) : size.toFixed(digits).replace(/\.?0+$/, '')
  return `${text} ${BYTE_UNITS[unit] ?? 'B'}`
}

const RELATIVE_UNITS: readonly (readonly [number, string])[] = [
  [1, 's'],
  [60, 'min'],
  [3600, 'h'],
  [86400, 'd'],
  [86400 * 30, 'mo'],
  [86400 * 365, 'y'],
]

/**
 * `"3 min ago"` / `"in 2 h"`. `now` is injectable for tests and for rendering a
 * stable value during a single pass. Returns `fallback` when the input is unparseable.
 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now: number = Date.now(),
  fallback = '—',
): string {
  if (value === null || value === undefined || value === '') return fallback
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (Number.isNaN(time)) return fallback
  const deltaSeconds = Math.round((now - time) / 1000)
  const seconds = Math.abs(deltaSeconds)
  if (seconds < 5) return 'just now'
  let chosen: readonly [number, string] = [1, 's']
  for (const unit of RELATIVE_UNITS) {
    if (seconds >= unit[0]) chosen = unit
  }
  const text = `${String(Math.floor(seconds / chosen[0]))} ${chosen[1]}`
  return deltaSeconds < 0 ? `in ${text}` : `${text} ago`
}

/** First `length` characters of an id, dropping a `sha256:` prefix. */
export function shortId(id: string | null | undefined, length = 12): string {
  if (!id) return '—'
  const bare = id.startsWith('sha256:') ? id.slice(7) : id
  return bare.slice(0, length)
}

/** `3661` -> `"1h 1m"`; for container uptimes. */
export function formatDurationSeconds(totalSeconds: number | null | undefined, fallback = '—'): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return fallback
  const s = Math.floor(totalSeconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${String(d)}d ${String(h)}h`
  if (h > 0) return `${String(h)}h ${String(m)}m`
  if (m > 0) return `${String(m)}m ${String(s % 60)}s`
  return `${String(s)}s`
}
