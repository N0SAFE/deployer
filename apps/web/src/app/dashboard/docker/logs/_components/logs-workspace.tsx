'use client'

import { useMemo, useRef, useState } from 'react'
import { AuthDashboardDeployments, AuthDashboardDockerActivity, AuthDashboardDockerShell } from '@/routes'
import { Button } from '@deployer/ui/components/shadcn/button'
import { useDockerNode } from '../../_components/docker-node-context'
import { useLogFollow } from '../_hooks/use-log-follow'
import { useLogsLines, type LogsSource } from '../_hooks/use-logs-lines'
import { formatLinesAsText, prepareLine, searchLines } from '../_lib/prepare-lines'
import { CONTAINER_STREAM_LOG_LIMIT } from '../_models/logs.types'
import { LogsDisconnectedBanner, LogsTargetLine } from './logs-banners'
import { LogsToolbar, type ContainerOption } from './logs-toolbar'
import { LogsViewer } from './logs-viewer'

export interface LogsContainer extends ContainerOption {
  id: string
  name: string
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Picks the stream target, owns view options, and wires lines -> search -> viewer. */
export function LogsWorkspace({ containers }: { containers: LogsContainer[] }) {
  const { nodeName } = useDockerNode()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const [source, setSource] = useState<LogsSource>('container')
  const [query, setQuery] = useState('')
  const [wrap, setWrap] = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(true)

  // Explicit choice wins; otherwise the first running container (the page says which one it is).
  const selected = useMemo(
    () => containers.find((c) => c.id === requestedId) ?? containers.find((c) => c.status === 'running') ?? containers[0] ?? null,
    [containers, requestedId],
  )
  const target = useMemo(() => (selected ? { id: selected.id, name: selected.name } : null), [selected])

  const stream = useLogsLines(target, source)
  const prepared = useMemo(() => stream.lines.map(prepareLine), [stream.lines])
  const search = useMemo(() => searchLines(prepared, query), [prepared, query])
  const follow = useLogFollow(viewportRef, search.lines.map((p) => p.line))

  const visibleText = useMemo(() => formatLinesAsText(search.lines, showTimestamps), [search.lines, showTimestamps])

  if (!selected) return null

  return (
    <div className="space-y-3">
      <LogsToolbar
        containers={containers}
        selectedId={selected.id}
        onSelectContainer={setRequestedId}
        source={source}
        onSourceChange={setSource}
        query={query}
        onQueryChange={setQuery}
        matchCount={search.matchCount}
        matchedLines={search.lines.length}
        following={follow.following}
        onToggleFollow={follow.toggle}
        wrap={wrap}
        onWrapChange={setWrap}
        showTimestamps={showTimestamps}
        onTimestampsChange={setShowTimestamps}
        visibleText={visibleText}
        hasLines={search.lines.length > 0}
        onDownload={() => { downloadText(`${selected.name}-logs.txt`, visibleText) }}
        onClear={stream.clear}
      />

      <LogsTargetLine
        container={selected}
        nodeName={nodeName}
        lineCount={stream.bufferedCount}
        bufferLimit={CONTAINER_STREAM_LOG_LIMIT}
        connecting={stream.isStreamConnecting}
      />

      {stream.isStreamError ? <LogsDisconnectedBanner error={stream.streamError} onReconnect={stream.reconnect} /> : null}

      <LogsViewer
        lines={search.lines}
        ranges={search.ranges}
        containerName={selected.name}
        nodeName={nodeName}
        query={query}
        connecting={stream.isStreamConnecting && stream.bufferedCount === 0}
        wrap={wrap}
        showTimestamps={showTimestamps}
        viewportRef={viewportRef}
        follow={follow}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Related:</span>
        <Button asChild variant="outline" size="sm"><AuthDashboardDockerActivity.Link>Activity stream</AuthDashboardDockerActivity.Link></Button>
        <Button asChild variant="outline" size="sm"><AuthDashboardDockerShell.Link>Shell</AuthDashboardDockerShell.Link></Button>
        <Button asChild variant="outline" size="sm"><AuthDashboardDeployments.Link>Deployment logs</AuthDashboardDeployments.Link></Button>
      </div>
    </div>
  )
}
