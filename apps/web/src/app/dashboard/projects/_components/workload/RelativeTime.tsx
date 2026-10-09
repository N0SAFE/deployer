'use client'

import { useNow } from '@/components/dashboard/use-now'
import { formatDateTime } from '@/lib/format/date'
import { formatRelative } from '../../_utils/workload'

/**
 * "3 min ago" with the absolute UTC time in the tooltip (UI-PRINCIPLES 5).
 * Ages on its own clock so a static screen does not lie about recency.
 */
export function RelativeTime({ value, className }: { value: string | number | Date | null | undefined; className?: string }) {
  const now = useNow(30_000)
  if (value === null || value === undefined || value === '') {
    return <span className={className}>—</span>
  }
  return (
    <time
      dateTime={value instanceof Date ? value.toISOString() : String(value)}
      title={formatDateTime(value)}
      className={className}
      suppressHydrationWarning
    >
      {formatRelative(value, now)}
    </time>
  )
}
