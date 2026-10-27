'use client'

import { useMemo, useState } from 'react'
import { useDockerContainerEventsStream } from '@/domains/docker/hooks'
import type { DockerContainer } from '@deployer/contracts-entities'
import {
  buildBaseMetrics,
  buildMetricChartData,
  METRIC_HISTORY_LIMIT,
  summarizeMetrics,
} from '../_utils/container-detail'
import { STREAM_QUERY_BASE_OPTIONS } from './container-stream-options'
import { useOnDepsChange } from './use-on-deps-change'

const METRICS_STREAM_ACTIONS = ['metrics'] as const

interface UseContainerMetricsParams {
  id: string
  detail: DockerContainer | null
  enabled: boolean
  matchesTarget: (containerId: string | null, containerName: string | null) => boolean
}

/** Live CPU/memory/network series for the overview tab, seeded with a flat baseline. */
export function useContainerMetrics({ id, detail, enabled, matchesTarget }: UseContainerMetricsParams) {
  const input = useMemo(
    () => ({
      query: {
        filter: {
          containerId: { operator: 'eq' as const, value: id },
          action: { operator: 'in' as const, value: [...METRICS_STREAM_ACTIONS] },
        },
      },
    }),
    [id],
  )
  const options = useMemo(() => ({ ...STREAM_QUERY_BASE_OPTIONS, enabled }), [enabled])
  const stream = useDockerContainerEventsStream(input, options)
  const event = stream.event ?? null

  const baseMetrics = useMemo(() => (detail ? buildBaseMetrics(detail) : []), [detail])
  const [liveMetrics, setLiveMetrics] = useState(baseMetrics)
  const [lastMetricAt, setLastMetricAt] = useState<string | null>(null)

  useOnDepsChange([baseMetrics], () => { setLiveMetrics(baseMetrics) })

  useOnDepsChange([event, matchesTarget], () => {
    if (event?.action !== 'metrics') return
    if (!matchesTarget(event.payload.containerId, event.payload.containerName)) return
    const metricsPoint = event.payload.metrics
    if (!metricsPoint) return

    setLastMetricAt(metricsPoint.at)
    setLiveMetrics((previous) => [...previous, metricsPoint].slice(-METRIC_HISTORY_LIMIT))
  })

  useOnDepsChange([id], () => { setLastMetricAt(null) }, false)

  const metricSummary = useMemo(() => summarizeMetrics(liveMetrics), [liveMetrics])
  const metricChartData = useMemo(() => buildMetricChartData(liveMetrics), [liveMetrics])

  return { metricSummary, metricChartData, lastMetricAt }
}
