'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DockerImageSecurityScanEvent, DockerImageSecurityScanStage } from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { LogsViewer, type LogsViewerLine } from '@/components/atomics/organisms/logs'
import { SECURITY_SCAN_INITIAL_PAGE_INDEX, SECURITY_SCAN_LOG_PAGE_SIZE, toClock } from './scan-model'
import type { ScanStreamStatus } from './use-image-scan-session'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'

type ToolFilter = 'all' | 'pipeline' | 'trivy' | 'grype' | 'dive'
type StageFilter = 'all' | DockerImageSecurityScanStage
type TypeFilter = 'all' | DockerImageSecurityScanEvent['type']

const SELECT_CLASS = 'h-8 rounded border bg-background px-2 text-xs'

interface SecurityLogsPaneProps {
  events: readonly DockerImageSecurityScanEvent[]
  streamStatus: ScanStreamStatus
  hasCompletedScan: boolean
}

/** Scan event log with tool/stage/type filters and "load older" paging. */
export function SecurityLogsPane({ events, streamStatus, hasCompletedScan }: SecurityLogsPaneProps) {
  const [toolFilter, setToolFilter] = useState<ToolFilter>('all')
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [pageIndex, setPageIndex] = useState(SECURITY_SCAN_INITIAL_PAGE_INDEX)
  const [historyLoading, setHistoryLoading] = useState(false)

  useOnDepsChange([toolFilter, stageFilter, typeFilter], () => { setPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX) }, false)

  const filtered = useMemo(() => events.filter((event) => {
    if (toolFilter !== 'all' && (event.scanner ?? 'pipeline') !== toolFilter) return false
    if (stageFilter !== 'all' && event.stage !== stageFilter) return false
    if (typeFilter !== 'all' && event.type !== typeFilter) return false
    return true
  }), [events, stageFilter, toolFilter, typeFilter])

  const visible = useMemo(() => {
    const visibleCount = Math.max(SECURITY_SCAN_LOG_PAGE_SIZE, pageIndex * SECURITY_SCAN_LOG_PAGE_SIZE)
    return filtered.slice(Math.max(0, filtered.length - visibleCount))
  }, [filtered, pageIndex])

  const hasMoreHistory = filtered.length > visible.length

  const lines = useMemo<LogsViewerLine[]>(() => visible.map((event, index) => {
    const header = `[${toClock(event.timestamp)}] [${(event.scanner ?? 'pipeline').toUpperCase()}] [${event.stage}] [${event.type}]`
    return {
      id: `${event.timestamp}-${event.type}-${event.stage}-${event.scanner ?? 'pipeline'}-${String(index)}`,
      searchText: `${event.timestamp} ${event.type} ${event.stage} ${event.scanner ?? 'pipeline'} ${event.message} ${event.logLine ?? ''}`,
      content: (
        <>
          <span className="text-emerald-400">{header}</span>{' '}
          <span>{event.logLine ?? event.message}</span>
          {event.progress !== null ? <span className="text-slate-400"> ({String(event.progress)}%)</span> : null}
        </>
      ),
    }
  }), [visible])

  function loadOlder(): void {
    if (historyLoading || !hasMoreHistory) return
    setHistoryLoading(true)
    setPageIndex((previous) => previous + 1)
    setTimeout(() => { setHistoryLoading(false) }, 0)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden!">
      <LogsViewer
        lines={lines}
        hasMoreHistory={hasMoreHistory}
        isLoadingHistory={historyLoading}
        onLoadOlderLogs={loadOlder}
        onReset={() => {
          setToolFilter('all')
          setStageFilter('all')
          setTypeFilter('all')
          setPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX)
        }}
        streamRegionLabel="Image security scan logs"
        badges={(
          <>
            <Badge className="text-xs" variant="outline">{lines.length} events</Badge>
            <Badge className="text-xs" variant="outline">{hasMoreHistory ? 'older events available' : 'start of log'}</Badge>
          </>
        )}
        extraToolbarContent={(
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Filter by tool" className={SELECT_CLASS} value={toolFilter} onChange={(event) => { setToolFilter(event.target.value as ToolFilter) }}>
              <option value="all">Tool: all</option>
              <option value="pipeline">Tool: pipeline</option>
              <option value="trivy">Tool: trivy</option>
              <option value="grype">Tool: grype</option>
              <option value="dive">Tool: dive</option>
            </select>
            <select aria-label="Filter by stage" className={SELECT_CLASS} value={stageFilter} onChange={(event) => { setStageFilter(event.target.value as StageFilter) }}>
              <option value="all">Stage: all</option>
              <option value="queued">queued</option>
              <option value="pulling-scanner">pulling-scanner</option>
              <option value="scanning">scanning</option>
              <option value="parsing">parsing</option>
              <option value="merging">merging</option>
              <option value="completed">completed</option>
              <option value="error">error</option>
            </select>
            <select aria-label="Filter by event type" className={SELECT_CLASS} value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value as TypeFilter) }}>
              <option value="all">Type: all</option>
              <option value="status">status</option>
              <option value="log">log</option>
              <option value="result">result</option>
              <option value="complete">complete</option>
              <option value="error">error</option>
            </select>
          </div>
        )}
        notice={(
          <div role="status" className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span>Live updates: {streamStatus}</span>
            <span>{hasCompletedScan ? 'scan completed' : 'scan in progress'}</span>
          </div>
        )}
      />
    </div>
  )
}
