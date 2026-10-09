'use client'

import { formatDateTime } from '@/lib/format/date'
import { useHydrated } from '@/lib/use-hydrated'
import { formatRelativeTime } from '../_utils/format'

/** Relative time ("3 min ago") with the absolute UTC time in the title. Stable until hydrated. */
export function DockerRelativeTime({ value }: { value: string | number | Date | null | undefined }) {
  const hydrated = useHydrated()
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>
  return (
    <time dateTime={new Date(value).toISOString()} title={formatDateTime(value)} className="whitespace-nowrap">
      {hydrated ? formatRelativeTime(value) : formatDateTime(value)}
    </time>
  )
}
