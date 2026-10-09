/** Ordering + dedupe for the activity feed. Generic so it can be tested without the entity. */
export interface MergeableActivity {
  id: string
  eventId?: string | null
  occurredAt: string | number | Date
}

export function activityKey(activity: MergeableActivity): string {
  return activity.eventId ?? activity.id
}

function time(activity: MergeableActivity): number {
  const value = new Date(activity.occurredAt).getTime()
  return Number.isNaN(value) ? 0 : value
}

/**
 * Merge `incoming` into `existing`, newest first, deduplicated by event key
 * (`incoming` wins), capped at `cap` entries so a long-lived tab cannot grow without bound.
 */
export function mergeActivities<T extends MergeableActivity>(existing: readonly T[], incoming: readonly T[], cap: number): T[] {
  const byKey = new Map<string, T>()
  for (const item of existing) byKey.set(activityKey(item), item)
  for (const item of incoming) byKey.set(activityKey(item), item)
  return Array.from(byKey.values()).sort((a, b) => time(b) - time(a)).slice(0, Math.max(0, cap))
}
