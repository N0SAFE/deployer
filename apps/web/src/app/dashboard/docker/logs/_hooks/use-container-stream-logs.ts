import { useEffect, useMemo, useState } from 'react'
import { useDockerContainerLogsStream } from '@/domains/docker/hooks'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import { useLogger } from '@/lib/logging/use-logger'
import { extractContainerLogEntries } from '../_lib/log-entry-parser'
import { CONTAINER_STREAM_LOG_LIMIT, type LogLineProjection } from '../_models/logs.types'

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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

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

  if (typeof payload !== 'object') {
    return String(payload)
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

export function useContainerStreamLogs(
  activeContainerStreamEntity: ContainerStreamEntity | null,
  isPaused: boolean,
) {
  const [containerStreamLogs, setContainerStreamLogs] = useState<LogLineProjection[]>([])
  const activeContainerId = activeContainerStreamEntity?.id ?? null
  const activeContainerName = activeContainerStreamEntity?.name ?? null

  useLogger(
    debugContainerLogsStream,
    'streamTargetChanged',
    {
      paused: isPaused,
      containerId: activeContainerId,
      containerName: activeContainerName,
    },
    (lastData, currentData) => {
      if (!lastData) {
        return true
      }

      return (
        lastData.paused !== currentData.paused
        || lastData.containerId !== currentData.containerId
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
      enabled: !isPaused && activeContainerStreamEntity !== null,
    },
  )

  useEffect(() => {
    setContainerStreamLogs([])
  }, [activeContainerId])

  useEffect(() => {
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

    setContainerStreamLogs((previous) => {
      const deduped = new Map<string, LogLineProjection>()

      for (const line of previous) {
        deduped.set(line.id, line)
      }

      for (const line of nextLines) {
        deduped.set(line.id, line)
      }

      const merged = Array.from(deduped.values()).slice(-CONTAINER_STREAM_LOG_LIMIT)

      debugContainerLogsStream('mergedLinesIntoState', {
        containerId: activeContainerStreamEntity.id,
        previousCount: previous.length,
        incomingCount: nextLines.length,
        nextCount: merged.length,
      })

      return merged
    })
  }, [
    activeContainerStreamEntity,
    containerLogsStreamQuery.data,
    containerLogsStreamQuery.isFetching,
  ])

  return {
    containerStreamLogs,
    setContainerStreamLogs,
    containerLogsStreamQuery,
  }
}
