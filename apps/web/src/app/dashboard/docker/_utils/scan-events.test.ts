import { describe, expect, it } from 'vitest'
import { mergeScanEvents } from './scan-events'

const event = (message: string) => ({ timestamp: 't', type: 'log', stage: 'scanning', scanner: null, message })

describe('mergeScanEvents', () => {
  it('skips duplicates and keeps order', () => {
    const first = mergeScanEvents([], [event('a'), event('b')], 10)
    const second = mergeScanEvents(first, [event('b'), event('c')], 10)
    expect(second.map((e) => e.message)).toEqual(['a', 'b', 'c'])
  })
  it('returns the same array when nothing is new', () => {
    const list = [event('a')]
    expect(mergeScanEvents(list, [event('a')], 10)).toBe(list)
  })
  it('keeps only the newest entries', () => {
    expect(mergeScanEvents([], [event('a'), event('b'), event('c')], 2).map((e) => e.message)).toEqual(['b', 'c'])
  })
})
