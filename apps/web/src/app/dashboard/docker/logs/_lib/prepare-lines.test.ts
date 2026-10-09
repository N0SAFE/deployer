import { describe, expect, it } from 'vitest'
import { formatLinesAsText, prepareLine, searchLines } from './prepare-lines'
import type { LogLineProjection } from '../_models/logs.types'

const ESC = String.fromCharCode(27)
const make = (id: string, message: string, extra: Partial<LogLineProjection> = {}): LogLineProjection => ({
  id, containerId: 'c1', containerName: 'web', source: 'container', status: 'info', message,
  timestamp: '2026-10-09T10:00:00.000Z', ...extra,
})

describe('prepareLine', () => {
  it('strips ANSI for the plain text and memoises per line object', () => {
    const line = make('1', `${ESC}[31mfail${ESC}[0m now`)
    const prepared = prepareLine(line)
    expect(prepared.plain).toBe('fail now')
    expect(prepareLine(line)).toBe(prepared)
  })
})

describe('searchLines', () => {
  const lines = [make('1', 'alpha beta'), make('2', `${ESC}[32mBeta${ESC}[0m beta`), make('3', 'gamma')].map(prepareLine)

  it('returns everything and no matches for an empty query', () => {
    const result = searchLines(lines, '')
    expect(result.lines).toHaveLength(3)
    expect(result.matchCount).toBe(0)
  })

  it('filters lines and counts all occurrences, ignoring colour codes', () => {
    const result = searchLines(lines, 'beta')
    expect(result.lines.map((l) => l.line.id)).toEqual(['1', '2'])
    expect(result.matchCount).toBe(3)
  })

  it('returns no lines when nothing matches', () => {
    expect(searchLines(lines, 'zzz').lines).toEqual([])
  })
})

describe('formatLinesAsText', () => {
  it('exports plain text with optional timestamps and tags', () => {
    const lines = [
      make('1', `${ESC}[31mboom${ESC}[0m`, { stream: 'stderr' }),
      make('2', 'container.start', { source: 'runtime' }),
    ].map(prepareLine)
    expect(formatLinesAsText(lines, false)).toBe('[stderr] boom\n[event] container.start')
    expect(formatLinesAsText(lines, true).split('\n')[0]).toBe('2026-10-09T10:00:00.000Z [stderr] boom')
  })
})
