import { parseAnsi, type AnsiSegment } from './ansi'
import { findMatchRanges, applyMatchRanges, type HighlightedSegment, type MatchRange } from './highlight'
import { formatLogTime } from './merge-lines'
import type { LogLineProjection } from '../_models/logs.types'

export interface PreparedLine {
  line: LogLineProjection
  segments: AnsiSegment[]
  /** Message with every escape sequence removed; what search and export operate on. */
  plain: string
}

// Lines are immutable once buffered, so parse each one exactly once.
const cache = new WeakMap<LogLineProjection, PreparedLine>()

export function prepareLine(line: LogLineProjection): PreparedLine {
  const cached = cache.get(line)
  if (cached) return cached
  const segments = parseAnsi(line.message)
  const prepared: PreparedLine = { line, segments, plain: segments.map((segment) => segment.text).join('') }
  cache.set(line, prepared)
  return prepared
}

export interface SearchResult {
  lines: PreparedLine[]
  matchCount: number
  ranges: Map<string, MatchRange[]>
}

/** Keep only lines containing `query` (case-insensitive) and count every occurrence. */
export function searchLines(lines: readonly PreparedLine[], query: string): SearchResult {
  if (query.trim() === '') return { lines: [...lines], matchCount: 0, ranges: new Map() }
  const ranges = new Map<string, MatchRange[]>()
  const kept: PreparedLine[] = []
  let matchCount = 0
  for (const prepared of lines) {
    const found = findMatchRanges(prepared.plain, query)
    if (found.length === 0) continue
    ranges.set(prepared.line.id, found)
    matchCount += found.length
    kept.push(prepared)
  }
  return { lines: kept, matchCount, ranges }
}

export function highlightLine(prepared: PreparedLine, ranges: MatchRange[] | undefined): HighlightedSegment[] {
  return applyMatchRanges(prepared.segments, ranges ?? [])
}

/** Plain-text export of the visible lines (no ANSI), one per row. */
export function formatLinesAsText(lines: readonly PreparedLine[], withTimestamps: boolean): string {
  return lines
    .map(({ line, plain }) => {
      const parts: string[] = []
      if (withTimestamps) parts.push(`${line.timestamp} `)
      if (line.source === 'runtime') parts.push('[event] ')
      else if (line.stream === 'stderr') parts.push('[stderr] ')
      parts.push(plain)
      return parts.join('')
    })
    .join('\n')
}

export { formatLogTime }
