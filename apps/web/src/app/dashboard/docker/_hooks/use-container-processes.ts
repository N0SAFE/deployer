'use client'

import { useCallback, useMemo, useState } from 'react'
import { useDockerContainerProcessLogsStream, useDockerContainerProcessesStream } from '@/domains/docker/hooks'
import {
  dockerContainerProcessEntrySchema,
  type DockerContainerLogEntry,
  type DockerContainerProcessEntry,
  type DockerContainerInspectDetail,
} from '@deployer/contracts-entities'
import {
  explodeCompositeLogEntry,
  extractContainerLogEntries,
  mergeContainerLogsWithLimit,
} from '../_utils/container-logs'
import { STREAM_QUERY_BASE_OPTIONS } from './container-stream-options'
import { useOnDepsChange } from './use-on-deps-change'

const PROCESS_LOG_LIMIT = 300

interface UseContainerProcessesParams {
  id: string
  active: boolean
  inspectDetail: DockerContainerInspectDetail | null
}

/** Process list (live stream or inspect snapshot) and the tail of the expanded process's output. */
export function useContainerProcesses({ id, active, inspectDetail }: UseContainerProcessesParams) {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [expandedPid, setExpandedPid] = useState<number | null>(null)
  const [expandedLogs, setExpandedLogs] = useState<DockerContainerLogEntry[]>([])

  const baseProcesses = useMemo(() => inspectDetail?.processes ?? [], [inspectDetail?.processes])
  const [liveProcesses, setLiveProcesses] = useState(baseProcesses)

  const processesInput = useMemo(() => ({ query: { containerId: id, refreshIntervalMs: 400 } }), [id])
  const processLogsInput = useMemo(
    () => ({ query: { containerId: id, pid: expandedPid ?? 0, tail: PROCESS_LOG_LIMIT, refreshIntervalMs: 400 } }),
    [expandedPid, id],
  )
  const processesOptions = useMemo(() => ({ ...STREAM_QUERY_BASE_OPTIONS, enabled: active }), [active])
  const processLogsOptions = useMemo(
    () => ({ ...STREAM_QUERY_BASE_OPTIONS, enabled: active && expandedPid !== null }),
    [active, expandedPid],
  )

  const processesQuery = useDockerContainerProcessesStream(processesInput, processesOptions)
  const processLogsQuery = useDockerContainerProcessLogsStream(processLogsInput, processLogsOptions)

  useOnDepsChange([baseProcesses, autoRefresh], () => {
    if (!autoRefresh) return
    setLiveProcesses(baseProcesses)
  })

  useOnDepsChange([processesQuery.data, autoRefresh], () => {
    if (!autoRefresh || !processesQuery.data) return

    const snapshot = processesQuery.data as { data?: unknown }
    if (!snapshot.data || !Array.isArray(snapshot.data)) return

    const parsed = snapshot.data
      .map((entry) => dockerContainerProcessEntrySchema.safeParse(entry))
      .filter((result): result is { success: true; data: DockerContainerProcessEntry } => result.success)
      .map((result) => result.data)

    setLiveProcesses(parsed)
  })

  useOnDepsChange([processLogsQuery.data, expandedPid], () => {
    if (!processLogsQuery.data || expandedPid === null) return

    const payloads: unknown[] = Array.isArray(processLogsQuery.data) ? processLogsQuery.data : [processLogsQuery.data]
    if (payloads.length === 0) return

    const entries = payloads
      .flatMap((payload) => extractContainerLogEntries(payload))
      .flatMap((entry) => explodeCompositeLogEntry(entry))
    if (entries.length === 0) return

    setExpandedLogs((previous) => mergeContainerLogsWithLimit([...previous, ...entries], PROCESS_LOG_LIMIT))
  })

  useOnDepsChange([expandedPid], () => { setExpandedLogs([]) }, false)

  const toggleAutoRefresh = useCallback(() => { setAutoRefresh((previous) => !previous) }, [])
  const toggleProcess = useCallback((pid: number) => {
    setExpandedPid((previous) => (previous === pid ? null : pid))
  }, [])

  return {
    liveProcesses,
    expandedPid,
    expandedLogs,
    autoRefresh,
    isLoading: processesQuery.isLoading && liveProcesses.length === 0,
    toggleAutoRefresh,
    toggleProcess,
  }
}
