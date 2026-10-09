import { describe, expect, it } from 'vitest'
import { countNewLines, formatLogTime, mergeLines } from './merge-lines'

const line = (id: string) => ({ id })

describe('mergeLines', () => {
  it('appends new lines in arrival order', () => {
    expect(mergeLines([line('a')], [line('b'), line('c')], 10).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not duplicate lines replayed after a reconnect and keeps the buffer', () => {
    const buffer = [line('a'), line('b'), line('c')]
    const merged = mergeLines(buffer, [line('b'), line('c'), line('d')], 10)
    expect(merged.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same reference when nothing is new', () => {
    const buffer = [line('a')]
    expect(mergeLines(buffer, [line('a')], 10)).toBe(buffer)
    expect(mergeLines(buffer, [], 10)).toBe(buffer)
  })

  it('dedupes within the incoming batch', () => {
    expect(mergeLines([], [line('x'), line('x')], 10)).toHaveLength(1)
  })

  it('caps to the newest lines', () => {
    const merged = mergeLines([line('1'), line('2'), line('3')], [line('4'), line('5')], 3)
    expect(merged.map((l) => l.id)).toEqual(['3', '4', '5'])
  })
})

describe('countNewLines', () => {
  const lines = [line('a'), line('b'), line('c'), line('d')]
  it('counts lines after the anchor', () => {
    expect(countNewLines(lines, 'b')).toBe(2)
    expect(countNewLines(lines, 'd')).toBe(0)
  })
  it('is zero without an anchor', () => {
    expect(countNewLines(lines, null)).toBe(0)
  })
  it('counts everything when the anchor was evicted', () => {
    expect(countNewLines(lines, 'gone')).toBe(4)
  })
})

describe('formatLogTime', () => {
  it('formats UTC time with milliseconds', () => {
    expect(formatLogTime('2026-10-09T12:34:56.789Z')).toBe('12:34:56.789')
  })
  it('falls back for invalid input', () => {
    expect(formatLogTime('nope')).toBe('--:--:--')
  })
})
