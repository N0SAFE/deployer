'use client'

import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { LogsSearchInput } from '@/components/atomics/atoms/logs/logs-search-input'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Toggle } from '@repo/ui/components/shadcn/toggle'
import { Pause, Play, WrapText } from 'lucide-react'

export interface LogsViewerLine {
  id: string
  content: ReactNode
  searchText?: string
}

export interface LogsViewerProps {
  lines: LogsViewerLine[]
  hasMoreHistory: boolean
  isLoadingHistory: boolean
  onLoadOlderLogs: () => void
  onReset?: () => void
  streamingEnabled?: boolean
  onToggleStreaming?: () => void
  badges?: ReactNode
  extraToolbarContent?: ReactNode
  notice?: ReactNode
  emptyMessage?: ReactNode
  loadingHistoryMessage?: ReactNode
  noMoreHistoryMessage?: ReactNode
  mode?: 'read' | 'write'
  showSearch?: boolean
  streamRegionLabel?: string
  panelFooter?: ReactNode
}

function useLogsViewportBehavior(params: {
  viewportRef: RefObject<HTMLDivElement | null>
  hasMoreHistory: boolean
  isLoadingHistory: boolean
  onLoadOlderLogs: () => void
}) {
  const { viewportRef, hasMoreHistory, isLoadingHistory, onLoadOlderLogs } = params

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const handleScroll = () => {
      if (viewport.scrollHeight <= viewport.clientHeight + 1) {
        return
      }

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const scrollTop = viewport.scrollTop

      const distanceToVisualTopWithPositiveConvention = Math.abs(scrollTop - maxScrollTop)
      const distanceToVisualTopWithNegativeConvention = Math.abs(scrollTop + maxScrollTop)
      const distanceToVisualTop = Math.min(
        distanceToVisualTopWithPositiveConvention,
        distanceToVisualTopWithNegativeConvention,
      )

      if (distanceToVisualTop <= 72 && hasMoreHistory && !isLoadingHistory) {
        onLoadOlderLogs()
      }
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
    }
  }, [hasMoreHistory, isLoadingHistory, onLoadOlderLogs, viewportRef])
}

export function LogsViewer({
  lines,
  hasMoreHistory,
  isLoadingHistory,
  onLoadOlderLogs,
  onReset,
  streamingEnabled,
  onToggleStreaming,
  badges,
  extraToolbarContent,
  notice,
  emptyMessage,
  loadingHistoryMessage,
  noMoreHistoryMessage,
  mode = 'read',
  showSearch,
  streamRegionLabel,
  panelFooter,
}: LogsViewerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const [searchTerm, setSearchTerm] = useState('')
  const [isWrapEnabled, setIsWrapEnabled] = useState(true)
  const [fontSizePx, setFontSizePx] = useState(12)

  useLogsViewportBehavior({
    viewportRef,
    hasMoreHistory,
    isLoadingHistory,
    onLoadOlderLogs,
  })

  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const shouldShowSearch = showSearch ?? mode !== 'write'

  const filteredLines = useMemo(() => {
    if (!normalizedSearchTerm) {
      return lines
    }

    return lines.filter((line) => {
      if (!line.searchText) {
        return true
      }

      return line.searchText.toLowerCase().includes(normalizedSearchTerm)
    })
  }, [lines, normalizedSearchTerm])

  const showStreamingToggle = typeof streamingEnabled === 'boolean' && typeof onToggleStreaming === 'function'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {badges}
        <Badge className="text-[10px]" variant="outline">{filteredLines.length} lines</Badge>

        {showStreamingToggle ? (
          <Toggle
            variant="outline"
            size="sm"
            pressed={streamingEnabled}
            onPressedChange={onToggleStreaming}
            className="h-8 gap-1.5 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
          >
            {streamingEnabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {streamingEnabled ? 'Pause' : 'Resume'}
          </Toggle>
        ) : null}

        <Toggle
          variant="outline"
          size="sm"
          pressed={isWrapEnabled}
          onPressedChange={setIsWrapEnabled}
          className="h-8 gap-1.5 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
        >
          <WrapText className="h-3.5 w-3.5" />
          Wrap
        </Toggle>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => {
            setFontSizePx((previous) => (previous >= 14 ? 11 : previous + 1))
          }}
        >
          {fontSizePx}px
        </Button>

        {typeof onReset === 'function' ? (
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onReset}>
            Clear
          </Button>
        ) : null}

        {extraToolbarContent}
      </div>

      {shouldShowSearch ? <LogsSearchInput value={searchTerm} onChange={setSearchTerm} /> : null}

      {notice}

      <div className="min-h-0 flex flex-1 flex-col rounded border bg-[#070b14]">
        <div
          ref={viewportRef}
          role="region"
          aria-label={streamRegionLabel ?? 'Logs stream'}
          tabIndex={0}
          className="min-h-0 flex flex-1 flex-col-reverse overflow-auto"
          style={{
            fontSize: `${String(fontSizePx)}px`,
          }}
        >
          <div className={`flex w-full flex-col px-3 py-2 font-mono text-green-300 ${isWrapEnabled ? 'whitespace-pre-wrap wrap-break-word' : 'whitespace-pre'}`}>
            {isLoadingHistory ? (
              <p className="mb-2 text-xs text-slate-400">{loadingHistoryMessage ?? 'Loading older logs…'}</p>
            ) : null}

            {mode === 'read' && !hasMoreHistory && filteredLines.length > 0 ? (
              <p className="mb-2 text-xs text-slate-500">{noMoreHistoryMessage ?? 'Reached beginning of available logs.'}</p>
            ) : null}

            {filteredLines.map((line) => {
              return (
                <div key={line.id} className="mb-0.5">
                  {line.content}
                </div>
              )
            })}

            {filteredLines.length === 0 ? <p className="text-slate-400">{emptyMessage ?? 'No logs match the current filters.'}</p> : null}
          </div>
        </div>

        {panelFooter ? <div className="border-t border-slate-800/70 bg-[#050910]">{panelFooter}</div> : null}
      </div>
    </div>
  )
}
