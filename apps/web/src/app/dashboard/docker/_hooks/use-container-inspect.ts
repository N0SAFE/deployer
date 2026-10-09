'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDockerContainerInspect, useDockerRuntimeEventSubscriber } from '@/domains/docker/hooks'
import { dockerContainerInspectDetailSchema, type DockerContainer } from '@repo/contracts-entities'
import { buildFallbackContainer, matchesRuntimeTarget } from '../_utils/container-detail'
import { useOnDepsChange } from './use-on-deps-change'

const INSPECT_REFRESH_COOLDOWN_MS = 400

const INSPECT_REFRESH_ACTIONS = new Set([
  'create', 'start', 'stop', 'die', 'kill', 'pause', 'unpause', 'restart', 'rename', 'destroy', 'update', 'health_status',
])

interface UseContainerInspectParams {
  id: string
  container: DockerContainer | null
  onContainerStateChange?: () => unknown
}

/**
 * Inspect query + the container entity shown in the header, refreshed by
 * runtime events targeting this container (throttled, de-duplicated).
 */
export function useContainerInspect({ id, container, onContainerStateChange }: UseContainerInspectParams) {
  const inspectQuery = useDockerContainerInspect({ query: { containerId: id } })
  const refetchInspect = inspectQuery.refetch
  const [lastRuntimeContainerEventAt, setLastRuntimeContainerEventAt] = useState<string | null>(null)
  const [lastRuntimeContainerAction, setLastRuntimeContainerAction] = useState<string | null>(null)
  const lastInspectRefreshAtRef = useRef(0)
  const lastInspectEventFingerprintRef = useRef<string | null>(null)

  const inspectDetail = useMemo(() => {
    const parsed = dockerContainerInspectDetailSchema.safeParse(inspectQuery.data)
    return parsed.success ? parsed.data : null
  }, [inspectQuery.data])

  const detail = useMemo<DockerContainer | null>(() => {
    if (container) return container
    if (!inspectDetail) return null
    return buildFallbackContainer(id, inspectDetail.generatedAt)
  }, [container, id, inspectDetail])

  const detailName = detail?.name ?? null
  const matchesTarget = useCallback(
    (payloadContainerId: string | null, payloadContainerName: string | null) =>
      matchesRuntimeTarget({ id, name: detailName }, payloadContainerId, payloadContainerName),
    [detailName, id],
  )

  useDockerRuntimeEventSubscriber({
    enabled: true,
    cooldownMs: INSPECT_REFRESH_COOLDOWN_MS,
    filter: (event) => {
      if (event.source !== 'container') return false
      if (!INSPECT_REFRESH_ACTIONS.has(event.action)) return false
      return matchesTarget(event.payload.containerId, event.payload.containerName)
    },
    onEvent: (event) => {
      const fingerprint = event.eventId ?? `${event.action}:${event.timestamp}`
      if (lastInspectEventFingerprintRef.current === fingerprint) return

      const now = Date.now()
      if (now - lastInspectRefreshAtRef.current < INSPECT_REFRESH_COOLDOWN_MS) return

      lastInspectEventFingerprintRef.current = fingerprint
      lastInspectRefreshAtRef.current = now
      setLastRuntimeContainerEventAt(event.timestamp)
      setLastRuntimeContainerAction(event.action)

      void Promise.all([
        refetchInspect(),
        onContainerStateChange ? Promise.resolve(onContainerStateChange()) : Promise.resolve(),
      ])
    },
  })

  useOnDepsChange([id], () => {
    setLastRuntimeContainerEventAt(null)
    setLastRuntimeContainerAction(null)
  }, false)

  return {
    inspectQuery,
    inspectDetail,
    detail,
    isDetailLoading: inspectQuery.isLoading && !detail,
    matchesTarget,
    runtimeStreamStatus: lastRuntimeContainerEventAt ? ('live' as const) : ('shared' as const),
    lastRuntimeContainerAction,
  }
}
