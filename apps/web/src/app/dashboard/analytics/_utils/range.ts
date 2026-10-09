import type { Granularity, TimeRange } from '@/domains/analytics/types'

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
	'1h': 'Last hour',
	'6h': 'Last 6 hours',
	'12h': 'Last 12 hours',
	'1d': 'Last 24 hours',
	'3d': 'Last 3 days',
	'7d': 'Last 7 days',
	'30d': 'Last 30 days',
	'90d': 'Last 90 days',
	'1y': 'Last year',
}

const HOUR = 3_600_000
const WINDOW_MS: Record<TimeRange, number> = {
	'1h': HOUR, '6h': 6 * HOUR, '12h': 12 * HOUR, '1d': 24 * HOUR, '3d': 72 * HOUR,
	'7d': 168 * HOUR, '30d': 720 * HOUR, '90d': 2160 * HOUR, '1y': 8760 * HOUR,
}
const BUCKET_MS: Record<Granularity, number> = { minute: 60_000, hour: HOUR, day: 24 * HOUR }
/** The API caps a series at 200 buckets. */
const MAX_BUCKETS = 200

/** Granularities that give 2..200 buckets for a range; `day` is always the fallback. */
export function allowedGranularities(range: TimeRange): Granularity[] {
	const ok = (['minute', 'hour', 'day'] as const).filter((g) => {
		const buckets = WINDOW_MS[range] / BUCKET_MS[g]
		return buckets >= 2 && buckets <= MAX_BUCKETS
	})
	return ok.length > 0 ? ok : ['day']
}

/** Keep the current granularity when valid, else the finest valid one. */
export function coerceGranularity(range: TimeRange, current: Granularity): Granularity {
	const allowed = allowedGranularities(range)
	return allowed.includes(current) ? current : (allowed[allowed.length - 1] ?? 'day')
}

export type UsageRange = '1d' | '3d' | '7d' | '30d' | '90d'
const USAGE_RANGES: { range: UsageRange; ms: number }[] = [
	{ range: '1d', ms: 24 * HOUR }, { range: '3d', ms: 72 * HOUR }, { range: '7d', ms: 168 * HOUR },
	{ range: '30d', ms: 720 * HOUR }, { range: '90d', ms: 2160 * HOUR },
]

/**
 * The deployment summary only exists for 1d..90d. Pick the smallest window that
 * covers the selected range and say whether it is exact, so the page never labels
 * a 30-day figure with a 1-hour range.
 */
export function usageRangeFor(range: TimeRange): { range: UsageRange; exact: boolean } {
	const want = WINDOW_MS[range]
	const hit = USAGE_RANGES.find((r) => r.ms >= want) ?? USAGE_RANGES[USAGE_RANGES.length - 1]
	const chosen = hit ?? { range: '90d' as const, ms: 2160 * HOUR }
	return { range: chosen.range, exact: chosen.ms === want }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Deterministic UTC axis label: time within a day, date across days. */
export function bucketLabel(value: string | Date, granularity: Granularity, range: TimeRange): string {
	const d = new Date(value)
	if (Number.isNaN(d.getTime())) return '—'
	const date = `${MONTHS[d.getUTCMonth()] ?? ''} ${String(d.getUTCDate())}`
	if (granularity === 'day') return date
	const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
	return WINDOW_MS[range] <= 24 * HOUR ? time : `${date} ${time}`
}
