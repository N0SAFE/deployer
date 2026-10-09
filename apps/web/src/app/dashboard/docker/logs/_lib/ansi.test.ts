import { describe, expect, it } from 'vitest'
import { color256, parseAnsi, stripAnsi } from './ansi'

const ESC = String.fromCharCode(27)
const sgr = (codes: string) => `${ESC}[${codes}m`

describe('parseAnsi', () => {
  it('returns one unstyled segment for plain text', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', style: {} }])
  })

  it('returns nothing for empty input', () => {
    expect(parseAnsi('')).toEqual([])
  })

  it('applies colour and resets', () => {
    const segments = parseAnsi(`a${sgr('31')}red${sgr('0')}b`)
    expect(segments.map((s) => s.text)).toEqual(['a', 'red', 'b'])
    expect(segments[1]?.style.fg).toBeDefined()
    expect(segments[2]?.style).toEqual({})
  })

  it('treats bare ESC[m as reset', () => {
    const segments = parseAnsi(`${sgr('1')}bold${ESC}[mplain`)
    expect(segments[0]?.style.bold).toBe(true)
    expect(segments[1]?.style).toEqual({})
  })

  it('combines attributes in one sequence', () => {
    const [segment] = parseAnsi(`${sgr('1;4;32')}x`)
    expect(segment?.style).toMatchObject({ bold: true, underline: true })
    expect(segment?.style.fg).toBeDefined()
  })

  it('supports 256 and truecolor and clamps out-of-range channels', () => {
    expect(parseAnsi(`${sgr('38;5;196')}x`)[0]?.style.fg).toBe('rgb(255, 0, 0)')
    expect(parseAnsi(`${sgr('38;2;300;10;0')}x`)[0]?.style.fg).toBe('rgb(255, 10, 0)')
    expect(parseAnsi(`${sgr('48;5;232')}x`)[0]?.style.bg).toBe('rgb(8, 8, 8)')
  })

  it('ignores invalid 256 indices', () => {
    expect(color256(999)).toBeUndefined()
    expect(parseAnsi(`${sgr('38;5;999')}x`)[0]?.style.fg).toBeUndefined()
  })

  it('drops non-SGR sequences (cursor moves, erase, OSC) without leaking them', () => {
    const input = `${ESC}[2K${ESC}[1Aok${ESC}]0;title\u0007!`
    expect(stripAnsi(input)).toBe('ok!')
  })

  it('never emits markup: angle brackets stay literal text', () => {
    const [segment] = parseAnsi(`${sgr('31')}<script>alert(1)</script>`)
    expect(segment?.text).toBe('<script>alert(1)</script>')
    expect(Object.keys(segment?.style ?? {})).toEqual(['fg'])
  })

  it('merges adjacent segments with identical style', () => {
    expect(parseAnsi(`${sgr('31')}a${sgr('31')}b`)).toHaveLength(1)
  })

  it('removes control characters but keeps tabs', () => {
    expect(stripAnsi('a\u0007b\tc\u0000')).toBe('ab\tc')
  })

  it('tolerates a truncated escape at end of input', () => {
    expect(stripAnsi(`ok${ESC}[3`)).toContain('ok')
  })
})
