import { describe, expect, it } from 'vitest'
import { formatBytes, formatDurationSeconds, formatRelativeTime, shortId } from './format'

describe('formatBytes', () => {
  it('formats units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(1024 * 1024)).toBe('1 MiB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GiB')
  })
  it('falls back on bad input', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN, 'n/a')).toBe('n/a')
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  it('renders past and future', () => {
    expect(formatRelativeTime('2026-10-08T11:57:00Z', now)).toBe('3 min ago')
    expect(formatRelativeTime('2026-10-08T10:00:00Z', now)).toBe('2 h ago')
    expect(formatRelativeTime('2026-10-08T14:00:00Z', now)).toBe('in 2 h')
    expect(formatRelativeTime('2026-10-08T11:59:59Z', now)).toBe('just now')
  })
  it('falls back on unparseable input', () => {
    expect(formatRelativeTime('nope', now)).toBe('—')
    expect(formatRelativeTime(null, now)).toBe('—')
  })
})

describe('shortId / duration', () => {
  it('drops the sha256 prefix', () => {
    expect(shortId('sha256:abcdef0123456789')).toBe('abcdef012345')
    expect(shortId(null)).toBe('—')
  })
  it('formats durations', () => {
    expect(formatDurationSeconds(59)).toBe('59s')
    expect(formatDurationSeconds(3661)).toBe('1h 1m')
    expect(formatDurationSeconds(90000)).toBe('1d 1h')
  })
})
