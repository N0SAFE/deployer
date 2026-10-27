'use client'

import type { RefObject } from 'react'
import { ArrowDown, ScrollText } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { EmptyState } from '@/components/dashboard'
import type { MatchRange } from '../_lib/highlight'
import type { PreparedLine } from '../_lib/prepare-lines'
import type { useLogFollow } from '../_hooks/use-log-follow'
import { LogLineRow } from './log-line-row'

export function LogsViewer({
  lines,
  ranges,
  containerName,
  nodeName,
  query,
  connecting,
  wrap,
  showTimestamps,
  viewportRef,
  follow,
}: {
  lines: readonly PreparedLine[]
  ranges: Map<string, MatchRange[]>
  containerName: string
  nodeName: string
  query: string
  connecting: boolean
  wrap: boolean
  showTimestamps: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  follow: ReturnType<typeof useLogFollow>
}) {
  const searching = query.trim() !== ''

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-[#070b14]">
      <div
        ref={viewportRef}
        onScroll={follow.onScroll}
        role="log"
        aria-label={`Logs of ${containerName} on ${nodeName}`}
        tabIndex={0}
        className="h-[60vh] min-h-72 overflow-auto py-2 font-mono text-[13px] leading-5 text-slate-200 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {lines.length > 0 ? (
          <div className={wrap ? undefined : 'w-max min-w-full'}>
            {lines.map((prepared) => (
              <LogLineRow key={prepared.line.id} prepared={prepared} ranges={ranges.get(prepared.line.id)} showTimestamps={showTimestamps} wrap={wrap} />
            ))}
          </div>
        ) : connecting ? (
          <div role="status" aria-busy="true" className="space-y-2 px-3 py-2">
            <span className="sr-only">Connecting to the log stream of {containerName}…</span>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-4 bg-slate-700/40" style={{ width: `${String(40 + ((index * 13) % 55))}%` }} />
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={ScrollText}
            title={searching ? `No lines match “${query.trim()}”` : `No log output yet for ${containerName}`}
            description={searching
              ? 'Only lines currently buffered are searched. Clear the search to see everything.'
              : `Connected to ${nodeName}. New lines appear here as soon as the container writes them.`}
            className="m-3 border-slate-700 bg-transparent text-slate-300"
          />
        )}
      </div>

      {!follow.following ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button type="button" size="sm" className="pointer-events-auto shadow-lg" onClick={follow.resume}>
            <ArrowDown aria-hidden />
            {follow.newLineCount > 0
              ? `${follow.newLineCount.toLocaleString('en-US')} new ${follow.newLineCount === 1 ? 'line' : 'lines'} — jump to latest`
              : 'Jump to latest'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
