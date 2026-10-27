'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DockerRuntimeActivityEntity } from '@deployer/contracts-entities'
import { dockerEndpoints } from '@/domains/docker/endpoints'
import { useDockerRuntimeActivityDetail, useDockerRuntimeActivityList } from '@/domains/docker/hooks'
import { mergeActivities } from '../_utils/merge-activities'

/** Most live events kept in memory, and most buffered while paused. */
export const LIVE_BUFFER_CAP = 200
const DISPLAY_CAP = 500
const NO_DETAIL_ID = '00000000-0000-0000-0000-000000000000'

export type FeedConnection = 'connecting' | 'live' | 'error' | 'disconnected'

const HISTORY_INPUT = {
  query: { limit: 300, offset: 0, sortBy: 'occurredAt', sortDirection: 'desc' },
} as const

export function useActivityFeed() {
  const history = useDockerRuntimeActivityList(HISTORY_INPUT)
  const stream = useQuery(
    dockerEndpoints.runtime.activity.stream.experimental_liveObservableOptions({ input: { query: undefined } }),
  )

  const [live, setLive] = useState<DockerRuntimeActivityEntity[]>([])
  const [buffered, setBuffered] = useState<DockerRuntimeActivityEntity[]>([])
  const [paused, setPaused] = useState(false)
  // Read inside the stream effect without re-running it when the toggle flips.
  const pausedRef = useRef(false)

  useEffect(() => {
    const event = stream.data
    if (!event) return
    if (pausedRef.current) {
      setBuffered((previous) => mergeActivities(previous, [event], LIVE_BUFFER_CAP))
    } else {
      setLive((previous) => mergeActivities(previous, [event], LIVE_BUFFER_CAP))
    }
  }, [stream.data])

  function pause(): void {
    pausedRef.current = true
    setPaused(true)
  }

  function resume(): void {
    pausedRef.current = false
    setPaused(false)
    setLive((previous) => mergeActivities(previous, buffered, LIVE_BUFFER_CAP))
    setBuffered([])
  }

  const connection: FeedConnection = stream.isError
    ? 'error'
    : stream.data
      ? 'live'
      : stream.fetchStatus === 'fetching'
        ? 'connecting'
        : 'disconnected'

  const persisted = useMemo(() => history.data?.data ?? [], [history.data?.data])
  // Persisted rows win over the live copy of the same event.
  const activities = useMemo(() => mergeActivities(live, persisted, DISPLAY_CAP), [live, persisted])

  return {
    activities,
    isLoading: history.isLoading && activities.length === 0,
    historyError: history.isError ? history.error : null,
    refetchHistory: () => { void history.refetch() },
    isRefetchingHistory: history.isFetching,
    connection,
    reconnect: () => { void stream.refetch() },
    paused,
    pause,
    resume,
    bufferedCount: buffered.length,
  }
}

/** Detail of the selected row: persisted events are re-read, live-only ones are used as received. */
export function useSelectedActivity(selectedId: string | null, activities: readonly DockerRuntimeActivityEntity[]) {
  const persistedId = selectedId && !selectedId.startsWith('live:') ? selectedId : null
  const detail = useDockerRuntimeActivityDetail(
    { query: { id: persistedId ?? NO_DETAIL_ID } },
    { enabled: Boolean(persistedId) },
  )
  const selected = useMemo<DockerRuntimeActivityEntity | null>(() => {
    const inList = activities.find((activity) => activity.id === selectedId) ?? null
    if (!persistedId) return inList
    const data: unknown = detail.data
    if (data && typeof data === 'object' && 'body' in data) {
      return (data as { body: DockerRuntimeActivityEntity | null }).body ?? inList
    }
    return (data as DockerRuntimeActivityEntity | undefined) ?? inList
  }, [activities, detail.data, persistedId, selectedId])

  return { selected, isFetching: Boolean(persistedId) && detail.isFetching, isError: Boolean(persistedId) && detail.isError }
}
