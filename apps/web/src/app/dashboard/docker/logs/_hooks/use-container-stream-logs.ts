import { useCallback, useMemo, useState } from 'react'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'
import { useDockerContainerLogsStream } from '@/domains/docker/hooks'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import { useLogger } from '@/lib/logging/use-logger'
import { extractContainerLogEntries } from '../_lib/log-entry-parser'
import { mergeLines } from '../_lib/merge-lines'
import { CONTAINER_STREAM_LOG_LIMIT, type LogLineProjection } from '../_models/logs.types'
import { isRecord } from "@repo/type-guards"

interface ContainerStreamEntity {
  id: string
  name: string
}

const debugContainerLogsStream = createContextFilterDebugLogger('DockerLogsStreamHook', 'docker-web-logs')

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used by `resolveFallbackPayloadMessage`
 * to walk nested payloads without an `as Record<string, unknown>`
 * cast.
 */
function resolveFallbackPayloadMessage(payload: unknown, depth = 0): string | null {
  if (depth > 6 || payload == null) {
    return null
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed) {
      return null
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return resolveFallbackPayloadMessage(JSON.parse(trimmed) as unknown, depth + 1)
      } catch {
        return trimmed
      }
    }

    return trimmed
  }

  if (typeof payload === 'number' || typeof payload === 'boolean' || typeof payload === 'bigint') {
    return String(payload)
  }

  if (typeof payload !== 'object') {
    return null
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const nested = resolveFallbackPayloadMessage(entry, depth + 1)
      if (nested) {
        return nested
      }
    }

    return null
  }

  // After the `Array.isArray` and `typeof !== "object"` checks, the
  // only remaining type is a non-array object. Use the `isRecord`
  // type guard to narrow without a cast.
  if (!isRecord(payload)) {
    return null
  }
  const record = payload

  for (const directKey of ['message', 'log', 'line'] as const) {
    if (typeof record[directKey] === 'string' && record[directKey].trim().length > 0) {
      return record[directKey].trim()
    }
  }

  for (const nestedKey of ['body', 'data', 'payload', 'event', 'result', 'value', 'entry', 'entries', 'items', 'chunk'] as const) {
    const nested = resolveFallbackPayloadMessage(record[nestedKey], depth + 1)
    if (nested) {
      return nested
    }
  }

  try {
    const serialized = JSON.stringify(payload)
    return serialized && serialized.length > 0 ? serialized : null
  } catch {
    return null
  }
}

/**
 * Streams one container's logs into a capped, de-duplicated buffer.
 *
 * Pausing the *view* never touches this hook: the stream keeps filling the buffer
 * so nothing is lost while the operator reads. When the stream drops and
 * reconnects the server replays its tail; `mergeLines` drops ids already held, so
 * the buffer keeps its history and gains no duplicates.
 */
export function useContainerStreamLogs(activeContainerStreamEntity: ContainerStreamEntity | null) {
  const [containerStreamLogs, setContainerStreamLogs] = useState<readonly LogLineProjection[]>([])
  const activeContainerId = activeContainerStreamEntity?.id ?? null
  const activeContainerName = activeContainerStreamEntity?.name ?? null

  useLogger(
    debugContainerLogsStream,
    'streamTargetChanged',
    {
      containerId: activeContainerId,
      containerName: activeContainerName,
    },
    (lastData, currentData) => {
      if (!lastData) {
        return true
      }

      return (
        lastData.containerId !== currentData.containerId
        || lastData.containerName !== currentData.containerName
      )
    },
  )

  const containerLogsStreamInput = useMemo(() => {
    return {
      query: {
        containerId: activeContainerId ?? '',
        tail: 300,
        refreshIntervalMs: 400,
      },
    }
  }, [activeContainerId])

  const containerLogsStreamQuery = useDockerContainerLogsStream(
    containerLogsStreamInput,
    {
      enabled: activeContainerStreamEntity !== null,
    },
  )

  useOnDepsChange([activeContainerId], () => { setContainerStreamLogs([]) }, false)

  useOnDepsChange([activeContainerStreamEntity, containerLogsStreamQuery.data, containerLogsStreamQuery.isFetching], () => {
    if (!containerLogsStreamQuery.data || !activeContainerStreamEntity) {
      return
    }

    debugContainerLogsStream('streamPayloadReceived', {
      containerId: activeContainerStreamEntity.id,
      dataShape: Array.isArray(containerLogsStreamQuery.data) ? 'array' : typeof containerLogsStreamQuery.data,
      isFetching: containerLogsStreamQuery.isFetching,
    })

    const payloads = Array.isArray(containerLogsStreamQuery.data)
      ? containerLogsStreamQuery.data
      : [containerLogsStreamQuery.data]

    if (payloads.length === 0) {
      return
    }

    const nextLines: LogLineProjection[] = []

    payloads.forEach((payload, index) => {
      const entries = extractContainerLogEntries(payload)
      if (entries.length === 0) {
        const fallbackMessage = resolveFallbackPayloadMessage(payload)
        if (fallbackMessage) {
          const normalizedMessage = fallbackMessage.length > 2_000
            ? `${fallbackMessage.slice(0, 2_000)}…`
            : fallbackMessage

          nextLines.push({
            id: `container:${activeContainerStreamEntity.id}:raw:${String(index)}:${normalizedMessage.slice(0, 120)}`,
            containerId: activeContainerStreamEntity.id,
            containerName: activeContainerStreamEntity.name,
            source: 'container',
            status: 'raw',
            message: normalizedMessage,
            timestamp: new Date().toISOString(),
          })

          debugContainerLogsStream('fallbackPayloadUsed', {
            containerId: activeContainerStreamEntity.id,
            payloadIndex: index,
            preview: normalizedMessage.slice(0, 180),
          })
        }
      }

      entries.forEach((entry, entryIndex) => {
        const fallbackId = `${entry.timestamp}:${entry.stream}:${entry.level}:${entry.message}:${String(index)}:${String(entryIndex)}`

        nextLines.push({
          id: `container:${activeContainerStreamEntity.id}:${entry.id || fallbackId}`,
          containerId: activeContainerStreamEntity.id,
          containerName: activeContainerStreamEntity.name,
          source: 'container',
          status: entry.level,
          stream: entry.stream,
          message: entry.message,
          timestamp: entry.timestamp,
        })
      })
    })

    if (nextLines.length === 0) {
      debugContainerLogsStream('noLinesExtractedFromPayload', {
        containerId: activeContainerStreamEntity.id,
        payloadCount: payloads.length,
      })
      return
    }

    setContainerStreamLogs((previous) => mergeLines(previous, nextLines, CONTAINER_STREAM_LOG_LIMIT))
  })

  const { refetch } = containerLogsStreamQuery
  const reconnect = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    containerStreamLogs,
    setContainerStreamLogs,
    /** True when the stream errored; the last buffered lines stay visible. */
    streamError: containerLogsStreamQuery.isError ? containerLogsStreamQuery.error : null,
    isStreamError: containerLogsStreamQuery.isError,
    isStreamConnecting: activeContainerStreamEntity !== null && containerLogsStreamQuery.isPending,
    reconnect,
  }
}
