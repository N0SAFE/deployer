import type {
  DockerContainer,
  DockerContainerInspectDetail,
  DockerContainerMetricPoint,
} from '@repo/contracts-entities'

export const METRIC_CHART_WINDOW_SIZE = 40
export const METRIC_HISTORY_LIMIT = 120

export type ContainerOrchestrator = 'compose' | 'swarm' | 'kubernetes'
export type LayerStatus = 'verified' | 'cached' | 'warning' | 'pending'

/** Matches a runtime event to this container by (possibly shortened) id or by name. */
export function matchesRuntimeTarget(
  target: { id: string; name: string | null },
  payloadContainerId: string | null,
  payloadContainerName: string | null,
): boolean {
  const payloadId = payloadContainerId?.trim() ?? null
  const targetId = target.id.trim()
  const payloadName = payloadContainerName?.trim().replace(/^\/+/, '') ?? null
  const targetName = target.name?.trim().replace(/^\/+/, '') ?? null

  const idMatches = payloadId !== null
    && (payloadId === targetId || targetId.startsWith(payloadId) || payloadId.startsWith(targetId))
  const nameMatches = payloadName !== null && targetName !== null && payloadName === targetName

  return idMatches || nameMatches
}

/** Placeholder entity used when only inspect data is available (container not in the list). */
export function buildFallbackContainer(id: string, generatedAt: string): DockerContainer {
  return {
    id,
    hash: id,
    name: `container-${id.slice(0, 8)}`,
    projectId: 'unknown',
    serviceId: 'unknown',
    stackId: null,
    imageId: null,
    status: 'unknown',
    health: 'none',
    environment: null,
    cpuPercent: null,
    memoryPercent: null,
    restartCount: 0,
    ports: [],
    networkIds: [],
    volumeIds: [],
    managedBy: 'orphan',
    managedReason: 'inspect_fallback',
    managedDeploymentId: null,
    managedServiceId: null,
    managedProjectId: null,
    managedImageRef: null,
    managedNetworkMode: null,
    logsStreamId: null,
    startedAt: null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  }
}

/** Flat 24-minute baseline built from the container's current CPU/memory, replaced as live points arrive. */
export function buildBaseMetrics(detail: Pick<DockerContainer, 'cpuPercent' | 'memoryPercent'>, now = Date.now()): DockerContainerMetricPoint[] {
  const cpu = detail.cpuPercent ?? 0
  const memory = detail.memoryPercent ?? 0
  return Array.from({ length: 24 }).map((_, index) => ({
    at: new Date(now - (23 - index) * 60_000).toISOString(),
    cpu,
    memory,
    networkRxKb: 0,
    networkTxKb: 0,
    ioReadKb: 0,
    ioWriteKb: 0,
  }))
}

export function summarizeMetrics(points: DockerContainerMetricPoint[]) {
  const cpu = points.map((point) => point.cpu)
  const memory = points.map((point) => point.memory)
  const rx = points.map((point) => point.networkRxKb)
  const tx = points.map((point) => point.networkTxKb)
  const peak = (series: number[]) => (series.length > 0 ? Math.max(...series) : 0)
  const current = (series: number[]) => series[series.length - 1] ?? 0
  const total = (series: number[]) => series.reduce((sum, value) => sum + value, 0)

  return {
    cpuPeak: peak(cpu),
    memPeak: peak(memory),
    rxPeak: peak(rx),
    txPeak: peak(tx),
    cpuCurrent: current(cpu),
    memCurrent: current(memory),
    rxCurrent: current(rx),
    txCurrent: current(tx),
    rxTotal: total(rx),
    txTotal: total(tx),
  }
}

export function buildMetricChartData(points: DockerContainerMetricPoint[]) {
  const parse = (timestamp: string): number => {
    const parsed = Date.parse(timestamp)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  return [...points]
    .sort((left, right) => parse(left.at) - parse(right.at))
    .slice(-METRIC_CHART_WINDOW_SIZE)
    .map((point, index) => ({
      tick: `${point.at.slice(11, 19)}.${point.at.slice(20, 21)}`,
      index,
      cpu: Number(point.cpu.toFixed(1)),
      memory: Number(point.memory.toFixed(1)),
    }))
}

export function resolveOrchestrator(runtimeLabel: string | undefined): ContainerOrchestrator {
  const label = runtimeLabel?.toLowerCase() ?? ''
  if (label.includes('swarm')) return 'swarm'
  if (label.includes('k8') || label.includes('kube')) return 'kubernetes'
  return 'compose'
}

type ComposeConfig = NonNullable<DockerContainerInspectDetail['composeConfig']>

export function buildComposeRows(compose: ComposeConfig, orchestrator: ContainerOrchestrator): { key: string; value: string }[] {
  if (orchestrator === 'swarm') {
    return [
      { key: 'Orchestrator', value: 'Docker Swarm' },
      { key: 'Service', value: compose.serviceName ?? '—' },
      { key: 'Stack project', value: compose.projectName ?? '—' },
      { key: 'Restart policy', value: compose.restart ?? '—' },
      { key: 'CPU shares', value: compose.cpuShares ? String(compose.cpuShares) : '—' },
      { key: 'Memory limit', value: compose.memLimitMb ? `${String(compose.memLimitMb)} MB` : '—' },
    ]
  }
  if (orchestrator === 'kubernetes') {
    return [
      { key: 'Orchestrator', value: 'Kubernetes' },
      { key: 'Namespace', value: compose.projectName ?? 'default' },
      { key: 'Deployment', value: compose.serviceName ?? '—' },
      { key: 'Restart policy', value: compose.restart ?? 'Always' },
      { key: 'CPU request/limit', value: compose.cpus ? `${String(compose.cpus)} cores` : '—' },
      {
        key: 'Memory request/limit',
        value: compose.memReservationMb && compose.memLimitMb
          ? `${String(compose.memReservationMb)} / ${String(compose.memLimitMb)} MB`
          : '—',
      },
    ]
  }
  return [
    { key: 'Orchestrator', value: 'Docker Compose' },
    { key: 'Service', value: compose.serviceName ?? '—' },
    { key: 'Project', value: compose.projectName ?? '—' },
    { key: 'Compose file', value: compose.composeFilePath ?? '—' },
    { key: 'Restart policy', value: compose.restart ?? '—' },
    { key: 'Profiles', value: compose.profiles.length > 0 ? compose.profiles.join(', ') : '—' },
  ]
}

/** Deterministic per-layer badge derived from the layer id (kept from the original behaviour). */
export function resolveLayerStatus(layerId: string, hasHighRisk: boolean): LayerStatus {
  let hash = 0
  for (let i = 0; i < layerId.length; i += 1) hash = (hash * 31 + layerId.charCodeAt(i)) >>> 0
  if (hasHighRisk && hash % 4 === 0) return 'warning'
  if (hash % 5 === 0) return 'pending'
  if (hash % 3 === 0) return 'cached'
  return 'verified'
}

export function layerStatusVariant(status: LayerStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'verified') return 'default'
  if (status === 'cached') return 'secondary'
  if (status === 'warning') return 'destructive'
  return 'outline'
}

export function joinContainerPath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory.replace(/\/$/, '')}/${name}`
}
