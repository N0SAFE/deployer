import { describe, expect, it } from 'vitest'
import { parseAnsi } from './ansi'
import { applyMatchRanges, findMatchRanges, highlightSegments } from './highlight'

const ESC = String.fromCharCode(27)

describe('findMatchRanges', () => {
  it('is case-insensitive and non-overlapping', () => {
    expect(findMatchRanges('Error error ERROR', 'error')).toHaveLength(3)
    expect(findMatchRanges('aaaa', 'aa')).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }])
  })
  it('returns nothing for an empty or blank query', () => {
    expect(findMatchRanges('abc', '')).toEqual([])
    expect(findMatchRanges('abc', '   ')).toEqual([])
  })
  it('treats regex characters literally', () => {
    expect(findMatchRanges('a.b a*b', '.')).toHaveLength(1)
    expect(findMatchRanges('(x)', '(x)')).toHaveLength(1)
  })
})

describe('highlightSegments', () => {
  it('splits plain text into match / non-match parts', () => {
    const parts = highlightSegments(parseAnsi('foo bar foo'), 'foo')
    expect(parts.map((p) => [p.text, p.match])).toEqual([['foo', true], [' bar ', false], ['foo', true]])
  })

  it('returns the text untouched when nothing matches', () => {
    expect(highlightSegments(parseAnsi('hello'), 'zzz')).toEqual([{ text: 'hello', style: {}, match: false }])
  })

  it('keeps styles and highlights a match that spans a colour change', () => {
    const segments = parseAnsi(`ab${ESC}[31mcd${ESC}[0mef`)
    const parts = applyMatchRanges(segments, findMatchRanges('abcdef', 'bcd'))
    expect(parts.map((p) => p.text)).toEqual(['a', 'b', 'cd', 'ef'])
    expect(parts.map((p) => p.match)).toEqual([false, true, true, false])
    expect(parts[2]?.style.fg).toBeDefined()
    expect(parts.map((p) => p.text).join('')).toBe('abcdef')
  })
})
