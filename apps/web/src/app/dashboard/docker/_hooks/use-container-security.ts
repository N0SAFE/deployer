'use client'

import { useMemo, useState } from 'react'
import { useDockerImageInspect, useDockerImageSecurityScanStream } from '@/domains/docker/hooks'
import {
  dockerImageInspectDetailSchema,
  type DockerContainer,
  type DockerContainerInspectDetail,
  type DockerImageSecurityScanEvent,
  type DockerVulnerabilityEntry,
} from '@repo/contracts-entities'
import { mergeScanEvents } from '../_utils/scan-events'
import { useOnDepsChange } from './use-on-deps-change'
import { layerStatusVariant, resolveLayerStatus, type LayerStatus } from '../_utils/container-detail'

const SECURITY_SCAN_EVENT_LIMIT = 800
const MISSING_IMAGE_ID = '__missing-image-id__'

interface UseContainerSecurityParams {
  detail: DockerContainer | null
  inspectDetail: DockerContainerInspectDetail | null
  activeTab: string
}

/** Image inspect + vulnerability scan stream, used by the Security and Layers tabs. */
export function useContainerSecurity({ detail, inspectDetail, activeTab }: UseContainerSecurityParams) {
  const imageId = detail?.imageId ?? null
  const hasImage = typeof imageId === 'string' && imageId.length > 0
  const [scanEvents, setScanEvents] = useState<DockerImageSecurityScanEvent[]>([])

  const imageInspectQuery = useDockerImageInspect(
    { query: { imageId: imageId ?? MISSING_IMAGE_ID } },
    { enabled: (activeTab === 'security' || activeTab === 'layers') && hasImage },
  )
  const scanStreamQuery = useDockerImageSecurityScanStream(
    { query: { imageId: imageId ?? MISSING_IMAGE_ID, refreshIntervalMs: 500 } },
    { enabled: activeTab === 'security' && hasImage },
  )

  const imageInspectDetail = useMemo(() => {
    const parsed = dockerImageInspectDetailSchema.safeParse(imageInspectQuery.data)
    return parsed.success ? parsed.data : null
  }, [imageInspectQuery.data])

  const vulnerabilities = useMemo<DockerVulnerabilityEntry[]>(
    () => imageInspectDetail?.vulnerabilities ?? [],
    [imageInspectDetail?.vulnerabilities],
  )

  const severityCounts = useMemo(
    () => vulnerabilities.reduce(
      (accumulator, entry) => {
        accumulator[entry.severity] += 1
        return accumulator
      },
      { critical: 0, high: 0, medium: 0, low: 0 },
    ),
    [vulnerabilities],
  )

  const inspectLayers = inspectDetail?.layers
  const imageLayers = imageInspectDetail?.layers
  const layers = useMemo<{ id: string; instruction: string; size: string; createdAt: string }[]>(() => {
    if (inspectLayers && inspectLayers.length > 0) return inspectLayers
    if (imageLayers && imageLayers.length > 0) return imageLayers
    return []
  }, [inspectLayers, imageLayers])

  const hasHighRisk = useMemo(
    () => vulnerabilities.some((entry) => entry.severity === 'critical' || entry.severity === 'high'),
    [vulnerabilities],
  )
  const layerStatus = (layerId: string): LayerStatus => resolveLayerStatus(layerId, hasHighRisk)

  useOnDepsChange([imageId], () => { setScanEvents([]) }, false)

  useOnDepsChange([scanStreamQuery.events], () => {
    const events = scanStreamQuery.events
    if (events.length === 0) return
    setScanEvents((previous) => mergeScanEvents(previous, events, SECURITY_SCAN_EVENT_LIMIT))
  })

  return {
    imageInspectQuery,
    imageInspectDetail,
    vulnerabilities,
    severityCounts,
    layers,
    layerStatus,
    layerStatusVariant,
    scanEvents,
    scanStreamStatus: scanStreamQuery.isError
      ? ('error' as const)
      : scanStreamQuery.fetchStatus === 'fetching'
        ? ('streaming' as const)
        : ('idle' as const),
  }
}
