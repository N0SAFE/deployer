'use client'

import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import type { DockerContainer } from '@deployer/contracts-entities'
import { useDockerLiveContainers, useDockerLiveImages } from '@/domains/docker/use-docker-live'
import type { ContainerRow } from '../_models/container-list.model'
import { imageRef, toContainerRow } from '../_utils/container-rows'

/**
 * Live container inventory for this node: SSE-driven store reconciled every minute,
 * projected to table rows. Projection runs on a deferred value so a burst of stream
 * events never blocks interaction.
 */
export function useContainersData(): {
  rows: ContainerRow[]
  entityById: ReadonlyMap<string, DockerContainer>
  /** True until the first snapshot arrived (an empty node is NOT loading). */
  isLoading: boolean
  hasError: boolean
  /** The reason the engine could not be read (null while healthy). */
  error: Error | null
  isRefreshing: boolean
  refetch: () => Promise<void>
} {
  const live = useDockerLiveContainers({ debounceMs: 200, reconcileIntervalMs: 60_000 })
  const images = useDockerLiveImages({ debounceMs: 500, reconcileIntervalMs: 60_000 })
  const [isRefreshing, setIsRefreshing] = useState(false)

  const deferredContainers = useDeferredValue(live.data)
  const deferredImages = useDeferredValue(images.data)

  const rows = useMemo(() => {
    const refs = new Map(deferredImages.map((image) => [image.id, imageRef(image)]))
    return deferredContainers.map((container) => toContainerRow(container, refs))
  }, [deferredContainers, deferredImages])

  const { refetch: refetchContainers } = live
  const { refetch: refetchImages } = images
  const refetch = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([refetchContainers(), refetchImages()])
    } finally {
      setIsRefreshing(false)
    }
  }, [refetchContainers, refetchImages])

  return {
    rows,
    entityById: live.byId,
    isLoading: live.data.length === 0 && live.lastSyncedAt === null && live.status !== 'error',
    hasError: live.status === 'error',
    error: live.error,
    isRefreshing,
    refetch,
  }
}
