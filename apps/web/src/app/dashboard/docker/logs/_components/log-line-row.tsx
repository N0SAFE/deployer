import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { MatchRange } from '../_lib/highlight'
import { formatLogTime } from '../_lib/merge-lines'
import { highlightLine, type PreparedLine } from '../_lib/prepare-lines'
import { AnsiText } from './ansi-text'

function levelTag(prepared: PreparedLine): { label: string; className: string } | null {
  const { line } = prepared
  if (line.source === 'runtime') return { label: 'event', className: 'text-sky-300' }
  if (line.status === 'error') return { label: 'error', className: 'text-red-300' }
  if (line.status === 'warn') return { label: 'warn', className: 'text-amber-300' }
  if (line.stream === 'stderr') return { label: 'stderr', className: 'text-orange-300' }
  return null
}

function borderFor(prepared: PreparedLine): string {
  const { line } = prepared
  if (line.status === 'error') return 'border-l-red-400'
  if (line.status === 'warn') return 'border-l-amber-400'
  return 'border-l-transparent'
}

/** One log row. Memoised: a new line must not re-render the other 1,499. */
export const LogLineRow = memo(function LogLineRow({
  prepared,
  ranges,
  showTimestamps,
  wrap,
}: {
  prepared: PreparedLine
  ranges: MatchRange[] | undefined
  showTimestamps: boolean
  wrap: boolean
}) {
  const tag = levelTag(prepared)
  return (
    <div className={cn('flex gap-2 border-l-2 px-3 py-px hover:bg-white/5', borderFor(prepared))}>
      {showTimestamps ? (
        <time dateTime={prepared.line.timestamp} title={prepared.line.timestamp} className="shrink-0 select-none text-slate-400">
          {formatLogTime(prepared.line.timestamp)}
        </time>
      ) : null}
      {tag ? <span className={cn('w-12 shrink-0 select-none text-xs uppercase leading-5', tag.className)}>{tag.label}</span> : null}
      <span className={cn('min-w-0 flex-1', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>
        <AnsiText segments={highlightLine(prepared, ranges)} />
      </span>
    </div>
  )
})
