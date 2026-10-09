/** Minimal shape of a security-scan stream event, enough to de-duplicate and cap a list of them. */
interface KeyedScanEvent {
  timestamp: string
  type: string
  stage: string
  scanner: string | null
  message: string
  logLine?: string | null
}

export function scanEventKey(event: KeyedScanEvent): string {
  return [event.timestamp, event.type, event.stage, event.scanner ?? 'none', event.message, event.logLine ?? ''].join('|')
}

/** Appends items not already present (by `keyOf`) and keeps only the newest `limit`. */
export function mergeByKey<T>(previous: readonly T[], incoming: readonly T[], limit: number, keyOf: (item: T) => string): T[] {
  const seen = new Set(previous.map(keyOf))
  const added: T[] = []
  for (const event of incoming) {
    const key = keyOf(event)
    if (seen.has(key)) continue
    seen.add(key)
    added.push(event)
  }
  if (added.length === 0) return previous as T[]
  return [...previous, ...added].slice(-limit)
}

export function mergeScanEvents<T extends KeyedScanEvent>(previous: readonly T[], incoming: readonly T[], limit: number): T[] {
  return mergeByKey(previous, incoming, limit, scanEventKey)
}
