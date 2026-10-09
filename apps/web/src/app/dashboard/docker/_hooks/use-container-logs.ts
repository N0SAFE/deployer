'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useDockerContainerLogsSnapshot,
  useDockerContainerLogsStream,
} from '@/domains/docker/hooks'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import type { DockerContainerLogEntry } from '@repo/contracts-entities'
import {
  explodeCompositeLogEntry,
  mergeContainerLogsWithLimit,
  normalizeLogStreamPayloads,
} from '../_utils/container-logs'
import { STREAM_QUERY_BASE_OPTIONS } from './container-stream-options'
import { useOnDepsChange } from './use-on-deps-change'

const debugDockerModalLogs = createContextFilterDebugLogger('DockerContainerDetailModalTrigger', 'docker-web-modal')

const LIVE_LOG_PAGE_SIZE = 100
const LIVE_LOG_INITIAL_PAGE_INDEX = 1
const LIVE_LOG_LIMIT = 20_000

/** Log history (paged snapshot) merged with the live stream, plus the time-range filter state. */
export function useContainerLogs({ id, activeTab }: { id: string; activeTab: string }) {
  const [streamingEnabled, setStreamingEnabled] = useState(true)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [historyPageIndex, setHistoryPageIndex] = useState(LIVE_LOG_INITIAL_PAGE_INDEX)
  const [timeRangeStart, setTimeRangeStart] = useState<string | null>(null)
  const [timeRangeEnd, setTimeRangeEnd] = useState<string | null>(null)
  const [liveLogs, setLiveLogs] = useState<DockerContainerLogEntry[]>([])

  const streamInput = useMemo(
    () => ({
      query: {
        containerId: id,
        tail: LIVE_LOG_PAGE_SIZE,
        refreshIntervalMs: activeTab === 'logs' ? 400 : 2_000,
        ...(timeRangeStart ? { since: timeRangeStart } : {}),
        ...(timeRangeEnd ? { until: timeRangeEnd } : {}),
      },
    }),
    [activeTab, id, timeRangeEnd, timeRangeStart],
  )
  const snapshotInput = useMemo(
    () => ({
      query: {
        containerId: id,
        tail: LIVE_LOG_PAGE_SIZE * historyPageIndex,
        ...(timeRangeStart ? { since: timeRangeStart } : {}),
        ...(timeRangeEnd ? { until: timeRangeEnd } : {}),
      },
    }),
    [id, historyPageIndex, timeRangeEnd, timeRangeStart],
  )
  const streamOptions = useMemo(
    () => ({ ...STREAM_QUERY_BASE_OPTIONS, enabled: streamingEnabled }),
    [streamingEnabled],
  )

  const snapshotQuery = useDockerContainerLogsSnapshot(snapshotInput, { enabled: activeTab === 'logs' })
  const streamQuery = useDockerContainerLogsStream(streamInput, streamOptions)

  useOnDepsChange([snapshotQuery.data, historyPageIndex, timeRangeStart], () => {
    if (!snapshotQuery.data) return

    const snapshotEntries = snapshotQuery.data.entries.flatMap((entry) => explodeCompositeLogEntry(entry))
    setLiveLogs((previous) => mergeContainerLogsWithLimit([...snapshotEntries, ...previous], LIVE_LOG_LIMIT))

    if (snapshotEntries.length < LIVE_LOG_PAGE_SIZE * historyPageIndex) {
      setHasMoreHistory(false)
      return
    }

    const earliestTimestamp = snapshotEntries[0]?.timestamp
    if (!timeRangeStart || !earliestTimestamp) {
      setHasMoreHistory(true)
      return
    }

    const earliestMillis = Date.parse(earliestTimestamp)
    const rangeStartMillis = Date.parse(timeRangeStart)
    if (!Number.isFinite(earliestMillis) || !Number.isFinite(rangeStartMillis)) {
      setHasMoreHistory(true)
      return
    }
    setHasMoreHistory(earliestMillis > rangeStartMillis)
  })

  useOnDepsChange([id, streamQuery.data, streamingEnabled], () => {
    if (!streamingEnabled || !streamQuery.data) return

    const payloads: unknown[] = Array.isArray(streamQuery.data) ? streamQuery.data : [streamQuery.data]
    if (payloads.length === 0) return

    const normalizedEntries = normalizeLogStreamPayloads(payloads, id, (payloadIndex, preview) => {
      debugDockerModalLogs('containerLogsFallbackUsed', { payloadIndex, preview })
    })
    debugDockerModalLogs('containerLogsParsed', { payloadCount: payloads.length, parsedCount: normalizedEntries.length })
    if (normalizedEntries.length === 0) return

    setLiveLogs((previous) => mergeContainerLogsWithLimit([...previous, ...normalizedEntries], LIVE_LOG_LIMIT))
  })

  const resetPaging = useCallback(() => {
    setHistoryPageIndex(LIVE_LOG_INITIAL_PAGE_INDEX)
    setHasMoreHistory(true)
  }, [])

  const toggleStreaming = useCallback(() => { setStreamingEnabled((previous) => !previous) }, [])

  const reset = useCallback(() => {
    setLiveLogs([])
    resetPaging()
  }, [resetPaging])

  const loadOlder = useCallback(() => {
    if (snapshotQuery.isFetching || !hasMoreHistory) return
    setHistoryPageIndex((previous) => previous + 1)
  }, [hasMoreHistory, snapshotQuery.isFetching])

  const applyTimeRange = useCallback((range: { start: string | null; end: string | null }) => {
    setTimeRangeStart(range.start)
    setTimeRangeEnd(range.end)
    resetPaging()
  }, [resetPaging])

  const clearTimeRange = useCallback(() => {
    setTimeRangeStart(null)
    setTimeRangeEnd(null)
    resetPaging()
  }, [resetPaging])

  useOnDepsChange([id], () => {
    setLiveLogs([])
    setHasMoreHistory(true)
    setHistoryPageIndex(LIVE_LOG_INITIAL_PAGE_INDEX)
    setTimeRangeStart(null)
    setTimeRangeEnd(null)
  }, false)

  return {
    liveLogs,
    streamingEnabled,
    hasMoreHistory,
    isLoadingHistory: snapshotQuery.isFetching,
    isConnecting: snapshotQuery.isLoading && liveLogs.length === 0,
    error: snapshotQuery.error,
    refetch: snapshotQuery.refetch,
    timeRange: { start: timeRangeStart, end: timeRangeEnd },
    toggleStreaming,
    reset,
    loadOlder,
    applyTimeRange,
    clearTimeRange,
  }
}
