'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { formatDateTime } from '@/lib/format/date'

/**
 * "3 minutes ago" with the absolute UTC time in the tooltip.
 * Renders the absolute time on the server and first paint (a relative string
 * would differ between server and browser and break hydration), then switches
 * to relative and ticks every 30 s.
 */
export function RelativeTime({ value, fallback = '—', className }: { value: string | Date | null | undefined; fallback?: string; className?: string }) {
	const [now, setNow] = useState<number | null>(null)
	useEffect(() => {
		setNow(Date.now())
		const id = setInterval(() => { setNow(Date.now()) }, 30_000)
		return () => { clearInterval(id) }
	}, [])

	const date = value === null || value === undefined || value === '' ? null : new Date(value)
	if (date === null || Number.isNaN(date.getTime())) return <span className={className}>{fallback}</span>
	const absolute = formatDateTime(date)
	const text = now === null ? absolute : now - date.getTime() < 45_000 ? 'just now' : `${formatDistanceToNowStrict(date)} ago`
	return (
		<time dateTime={date.toISOString()} title={absolute} className={className}>
			{text}
		</time>
	)
}
