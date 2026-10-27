'use client'

import { useSyncExternalStore } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { formatDateTime } from '@/lib/format/date'

/**
 * "3 minutes ago" with the absolute UTC time in the tooltip.
 * Renders the absolute time on the server and first paint (a relative string
 * would differ between server and browser and break hydration), then switches
 * to relative and ticks every 30 s.
 */
// One shared 30 s ticker for every <RelativeTime>. While nobody is subscribed the
// snapshot is null, which is also the server snapshot, so first paint (server and
// hydration) shows the absolute time.
const tickListeners = new Set<() => void>()
let tickNow = 0
let tickTimer: ReturnType<typeof setInterval> | undefined

function subscribeToTick(listener: () => void): () => void {
	if (tickListeners.size === 0) {
		tickNow = Date.now()
		tickTimer = setInterval(() => {
			tickNow = Date.now()
			tickListeners.forEach((l) => { l() })
		}, 30_000)
	}
	tickListeners.add(listener)
	return () => {
		tickListeners.delete(listener)
		if (tickListeners.size === 0 && tickTimer !== undefined) {
			clearInterval(tickTimer)
			tickTimer = undefined
		}
	}
}

function getTickSnapshot(): number | null {
	return tickListeners.size === 0 ? null : tickNow
}

export function RelativeTime({ value, fallback = '—', className }: { value: string | Date | null | undefined; fallback?: string; className?: string }) {
	const now = useSyncExternalStore(subscribeToTick, getTickSnapshot, () => null)

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
