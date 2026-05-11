import { useState } from 'react'
import { useEventTrigger } from '@/domains/docker/hooks'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import { shortId } from '../_lib/container-identity'
import { RUNTIME_EVENT_LOG_LIMIT, type LogLineProjection } from '../_models/logs.types'

const debugRuntimeLogs = createContextFilterDebugLogger('DockerRuntimeEventLogsHook', 'docker-web-logs')

export function useRuntimeEventLogs() {
  const [runtimeEventLogs, setRuntimeEventLogs] = useState<LogLineProjection[]>([])

  useEventTrigger(
    () => true,
    (event) => {
      const payload = event.payload as Record<string, unknown>
      const containerId =
        typeof payload.containerId === 'string'
          ? payload.containerId
          : event.actorId ?? null

      const containerName =
        typeof payload.containerName === 'string'
          ? payload.containerName
          : typeof payload.name === 'string'
            ? payload.name
            : event.actorId
              ? shortId(event.actorId)
              : event.source

      const status = event.action

      const messageSegments = [
        `${event.source}.${event.action}`,
        event.from ? `from=${event.from}` : null,
        event.nodeId ? `node=${shortId(event.nodeId)}` : null,
      ].filter((segment): segment is string => Boolean(segment))

      debugRuntimeLogs('runtimeEventReceived', {
        eventId: event.eventId ?? null,
        source: event.source,
        action: event.action,
        containerId,
        containerName,
      })

      setRuntimeEventLogs((previous) => {
        const next: LogLineProjection = {
          id: event.eventId ?? `${event.timestamp}:${event.source}:${event.action}:${containerName}`,
          containerId,
          containerName,
          source: 'runtime',
          status,
          message: messageSegments.join(' · '),
          timestamp: event.timestamp,
        }

        const deduped = [next, ...previous.filter((line) => line.id !== next.id)]
        debugRuntimeLogs('runtimeEventMerged', {
          previousCount: previous.length,
          nextCount: deduped.length,
        })
        return deduped.slice(0, RUNTIME_EVENT_LOG_LIMIT)
      })
    },
    {
      cooldownMs: 100,
    },
  )

  return {
    runtimeEventLogs,
    setRuntimeEventLogs,
  }
}
