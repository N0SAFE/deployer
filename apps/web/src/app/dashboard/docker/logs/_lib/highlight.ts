import type { AnsiSegment } from './ansi'

export interface MatchRange {
  start: number
  end: number
}

export interface HighlightedSegment extends AnsiSegment {
  match: boolean
}

/** Case-insensitive, non-overlapping literal matches of `query` in `text`. */
export function findMatchRanges(text: string, query: string): MatchRange[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const haystack = text.toLowerCase()
  // Lowercasing can change length for exotic characters; offsets would then drift.
  if (haystack.length !== text.length) return []
  const ranges: MatchRange[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) break
    ranges.push({ start: index, end: index + needle.length })
    from = index + needle.length
  }
  return ranges
}

/**
 * Split styled segments at match boundaries. Ranges are expressed against the
 * concatenated segment text, so a match may span a colour change.
 */
export function applyMatchRanges(segments: AnsiSegment[], ranges: MatchRange[]): HighlightedSegment[] {
  if (ranges.length === 0) return segments.map((segment) => ({ ...segment, match: false }))
  const result: HighlightedSegment[] = []
  let offset = 0
  let rangeIndex = 0

  for (const segment of segments) {
    const segmentEnd = offset + segment.text.length
    let cursor = offset
    while (cursor < segmentEnd) {
      while (rangeIndex < ranges.length && (ranges[rangeIndex]?.end ?? 0) <= cursor) rangeIndex += 1
      const range = ranges[rangeIndex]
      if (!range || range.start >= segmentEnd) {
        result.push({ text: segment.text.slice(cursor - offset), style: segment.style, match: false })
        cursor = segmentEnd
      } else if (range.start > cursor) {
        result.push({ text: segment.text.slice(cursor - offset, range.start - offset), style: segment.style, match: false })
        cursor = range.start
      } else {
        const end = Math.min(range.end, segmentEnd)
        result.push({ text: segment.text.slice(cursor - offset, end - offset), style: segment.style, match: true })
        cursor = end
      }
    }
    offset = segmentEnd
  }
  return result
}

/** Convenience: highlight segments directly against a query. */
export function highlightSegments(segments: AnsiSegment[], query: string): HighlightedSegment[] {
  const text = segments.map((segment) => segment.text).join('')
  return applyMatchRanges(segments, findMatchRanges(text, query))
}
