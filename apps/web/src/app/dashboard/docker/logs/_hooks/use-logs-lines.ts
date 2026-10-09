import { useCallback, useMemo, useState } from 'react'
import { countNewLines } from '../_lib/merge-lines'
import type { LogLineProjection } from '../_models/logs.types'
import { useContainerStreamLogs } from './use-container-stream-logs'
import { useRuntimeEventLogs } from './use-runtime-event-logs'

export type LogsSource = 'container' | 'events' | 'all'

interface Target {
  id: string
  name: string
}

/**
 * The lines shown for one container: its output stream, the Docker events that
 * concern it, or both interleaved by time. "Clear" hides everything received so
 * far without dropping the buffer, so reconnects stay duplicate-free.
 */
export function useLogsLines(target: Target | null, source: LogsSource) {
  const stream = useContainerStreamLogs(target)
  const { runtimeEventLogs } = useRuntimeEventLogs()
  const [clearedAfter, setClearedAfter] = useState<{ containerId: string; lineId: string } | null>(null)

  const merged = useMemo<LogLineProjection[]>(() => {
    const output = source === 'events' ? [] : stream.containerStreamLogs
    const events = source === 'container' || !target
      ? []
      : runtimeEventLogs.filter((line) => line.containerId === target.id || line.containerName === target.name)
    if (events.length === 0) return [...output]
    return [...output, ...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }, [source, stream.containerStreamLogs, runtimeEventLogs, target])

  const lines = useMemo(() => {
    if (!clearedAfter || clearedAfter.containerId !== target?.id) return merged
    return merged.slice(merged.length - countNewLines(merged, clearedAfter.lineId))
  }, [clearedAfter, merged, target?.id])

  const clear = useCallback(() => {
    const last = merged[merged.length - 1]
    if (target && last) setClearedAfter({ containerId: target.id, lineId: last.id })
  }, [merged, target])

  return {
    lines,
    bufferedCount: merged.length,
    isStreamError: stream.isStreamError,
    streamError: stream.streamError,
    isStreamConnecting: stream.isStreamConnecting,
    reconnect: stream.reconnect,
    clear,
  }
}
