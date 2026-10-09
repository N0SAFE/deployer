import type { CSSProperties } from 'react'
import type { HighlightedSegment } from '../_lib/highlight'

function styleFor(segment: HighlightedSegment): CSSProperties {
  const { style } = segment
  return {
    color: style.fg,
    backgroundColor: style.bg,
    fontWeight: style.bold ? 700 : undefined,
    opacity: style.dim ? 0.7 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
  }
}

/**
 * Renders parsed ANSI segments as React text nodes with inline styles. Values come
 * from the parser's validated palette; there is no HTML injection path.
 */
export function AnsiText({ segments }: { segments: HighlightedSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <span key={index} style={styleFor(segment)}>
          {segment.match ? (
            <mark className="rounded-sm bg-amber-300 px-px text-slate-950">{segment.text}</mark>
          ) : (
            segment.text
          )}
        </span>
      ))}
    </>
  )
}
