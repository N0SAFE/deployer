/**
 * Pure helpers for the log buffer: reconnect-safe merging, capping and the
 * "N new lines" counter used while following is paused.
 */

export interface IdentifiedLine {
  id: string
}

/**
 * Append `incoming` to `previous`, skipping ids already present (a reconnect
 * replays the tail), keep arrival order, and cap to the newest `limit` lines.
 * Returns `previous` unchanged (same reference) when nothing new arrived so React
 * can bail out of the re-render.
 */
export function mergeLines<T extends IdentifiedLine>(previous: readonly T[], incoming: readonly T[], limit: number): readonly T[] {
  if (incoming.length === 0) return previous
  const seen = new Set(previous.map((line) => line.id))
  const fresh: T[] = []
  for (const line of incoming) {
    if (seen.has(line.id)) continue
    seen.add(line.id)
    fresh.push(line)
  }
  if (fresh.length === 0) return previous
  const merged = [...previous, ...fresh]
  return merged.length > limit ? merged.slice(merged.length - limit) : merged
}

/**
 * Lines that arrived after the line with id `anchorId`. If the anchor was evicted
 * from the capped buffer every line is newer than it.
 */
export function countNewLines(lines: readonly IdentifiedLine[], anchorId: string | null): number {
  if (anchorId === null) return 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.id === anchorId) return lines.length - 1 - i
  }
  return lines.length
}

/** `HH:MM:SS.mmm` in UTC (deterministic, matches the app's UTC convention). */
export function formatLogTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toISOString().slice(11, 23)
}
