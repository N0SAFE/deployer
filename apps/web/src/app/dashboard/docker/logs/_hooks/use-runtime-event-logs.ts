import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dockerEndpoints } from '@/domains/docker/endpoints'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import { shortId } from '../_lib/container-identity'
import { RUNTIME_EVENT_LOG_LIMIT, type LogLineProjection } from '../_models/logs.types'
import type { DockerEntityStreamChunk } from '@repo/contracts-entities'

const debugRuntimeLogs = createContextFilterDebugLogger(
  'DockerRuntimeEventLogsHook',
  'docker-web-logs',
)

/**
 * Build a stable log-line projection from a `DockerEntityStreamChunk`.
 * The unified entity stream emits fully-formed `DockerEntityEvent` (full
 * entity payload) or `DockerEntityRemovedEvent` (id-only). We project
 * both to a `LogLineProjection` so the logs page UI keeps working.
 */
function chunkToLogLine(chunk: DockerEntityStreamChunk): LogLineProjection {
  // Removal events are id-only — surface the action but no entity fields.
  if (
    'id' in chunk
    && typeof (chunk as { id?: unknown }).id === 'string'
    && ['destroy', 'die', 'delete'].includes((chunk as { action?: string }).action ?? '')
  ) {
    const id = (chunk as { id: string }).id
    return {
      id:
        (chunk as { eventId?: string | null }).eventId
        ?? `${chunk.occurredAt}:${chunk.kind}:${chunk.action}:${id}`,
      containerId: chunk.kind === 'container' ? id : null,
      containerName: chunk.kind === 'container' ? id : id,
      source: 'runtime',
      status: chunk.action,
      message: `${chunk.kind}.${chunk.action}`,
      timestamp: chunk.occurredAt,
    }
  }

  // Full entity chunk: project the per-kind id + name.
  const entity = chunk as Record<string, unknown>
  const id = typeof entity.id === 'string' ? entity.id : null
  const name = typeof entity.name === 'string' ? entity.name : id
  return {
    id:
      chunk.eventId
      ?? `${chunk.occurredAt}:${chunk.kind}:${chunk.action}:${id ?? ''}`,
    containerId: chunk.kind === 'container' ? id : null,
    containerName:
      chunk.kind === 'container'
        ? typeof name === 'string'
          ? name
          : id ?? shortId(String(id))
        : typeof name === 'string'
          ? name
          : id ?? shortId(String(id)),
    source: 'runtime',
    status: chunk.action,
    message: `${chunk.kind}.${chunk.action}`,
    timestamp: chunk.occurredAt,
  }
}

/**
 * Subscribes to the unified `docker.entity.stream` and projects each
 * emitted chunk to a `LogLineProjection` for the activity feed. The
 * unified stream carries the full entity payload (with relations) so the
 * log line can include the container/image/network/volume name without
 * a follow-up inspect call.
 */
export function useRuntimeEventLogs() {
  const [runtimeEventLogs, setRuntimeEventLogs] = useState<LogLineProjection[]>([])

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bufferRef = useRef<LogLineProjection[]>([])
  const flush = useCallback(() => {
    const lines = bufferRef.current
    bufferRef.current = []
    if (lines.length === 0) {
      return
    }
    setRuntimeEventLogs((previous) => {
      const ids = new Set(lines.map((line) => line.id))
      const deduped = [...lines, ...previous.filter((line) => !ids.has(line.id))]
      return deduped.slice(0, RUNTIME_EVENT_LOG_LIMIT)
    })
  }, [])

  const streamQuery = useQuery(
    dockerEndpoints.entity.stream.experimental_liveObservableOptions({
      input: { query: undefined },
      enabled: true,
    }),
  )

  useEffect(() => {
    if (!streamQuery.data) {
      return
    }
    const line = chunkToLogLine(streamQuery.data as DockerEntityStreamChunk)
    debugRuntimeLogs('runtimeEventReceived', {
      id: line.id,
      source: line.source,
      status: line.status,
      containerId: line.containerId,
      containerName: line.containerName,
    })
    bufferRef.current.push(line)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(flush, 100)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [streamQuery.data, flush])

  return {
    runtimeEventLogs,
    setRuntimeEventLogs,
  }
}
