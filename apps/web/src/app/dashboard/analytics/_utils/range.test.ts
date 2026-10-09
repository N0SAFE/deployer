import { describe, expect, it } from 'vitest'
import { allowedGranularities, bucketLabel, coerceGranularity, usageRangeFor } from './range'

describe('analytics range helpers', () => {
	it('only offers granularities that give a readable series', () => {
		expect(allowedGranularities('1h')).toEqual(['minute'])
		expect(allowedGranularities('1d')).toEqual(['hour'])
		expect(allowedGranularities('30d')).toEqual(['day'])
		expect(allowedGranularities('1y')).toEqual(['day'])
	})
	it('coerces an invalid granularity', () => {
		expect(coerceGranularity('30d', 'minute')).toBe('day')
		expect(coerceGranularity('3d', 'hour')).toBe('hour')
	})
	it('maps ranges to a covering usage window and says when inexact', () => {
		expect(usageRangeFor('1d')).toEqual({ range: '1d', exact: true })
		expect(usageRangeFor('1h')).toEqual({ range: '1d', exact: false })
		expect(usageRangeFor('1y')).toEqual({ range: '90d', exact: false })
	})
	it('labels buckets in UTC', () => {
		expect(bucketLabel('2026-10-09T14:05:00Z', 'hour', '1d')).toBe('14:05')
		expect(bucketLabel('2026-10-09T14:05:00Z', 'hour', '7d')).toBe('Oct 9 14:05')
		expect(bucketLabel('2026-10-09T14:05:00Z', 'day', '30d')).toBe('Oct 9')
	})
})
