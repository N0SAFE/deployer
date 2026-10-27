import { useCallback, useSyncExternalStore } from 'react'

/**
 * localStorage helpers that never throw: storage can be missing or blocked
 * (private windows, disabled site data, SSR). Callers must render correctly
 * when every read returns the fallback.
 */
export function readStoredJson<T>(key: string, fallback: T, validate: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return validate(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function writeStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Persistence is a convenience; losing it must not break the UI.
  }
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Move `id` to the front, de-duplicate, cap the length. */
export function pushRecent(list: readonly string[], id: string, max = 5): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max)
}

// ─── useSyncExternalStore-backed string list ────────────────────────────────
// Reads storage lazily so SSR/hydration render the fallback and the client then
// re-renders with the stored value, without setState-in-effect.
const listeners = new Set<() => void>()
const EMPTY_LIST: string[] = []
const snapshotCache = new Map<string, { raw: string | null; value: string[] }>()

function readSnapshot(key: string): string[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    // Storage blocked: serve what this tab last wrote, if anything.
    return snapshotCache.get(key)?.value ?? EMPTY_LIST
  }
  const cached = snapshotCache.get(key)
  if (cached?.raw === raw) return cached.value
  let value = EMPTY_LIST
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isStringArray(parsed)) value = parsed
    } catch {
      value = EMPTY_LIST
    }
  }
  snapshotCache.set(key, { raw, value })
  return value
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  window.addEventListener('storage', callback)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}

/** A persisted `string[]` (e.g. ids of collapsed groups). Never throws. */
export function useStoredStringList(key: string): [string[], (next: string[]) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readSnapshot(key),
    () => EMPTY_LIST,
  )
  const set = useCallback(
    (next: string[]) => {
      writeStoredJson(key, next)
      // localStorage can be blocked: keep this tab consistent anyway.
      snapshotCache.set(key, { raw: JSON.stringify(next), value: next })
      listeners.forEach((l) => {
        l()
      })
    },
    [key],
  )
  return [value, set]
}

/** Toggle membership of `id` in `list`. */
export function toggleInList(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}
