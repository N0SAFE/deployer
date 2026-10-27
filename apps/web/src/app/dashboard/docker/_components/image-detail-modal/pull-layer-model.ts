import type { DockerImageSecurityScanEvent } from '@deployer/contracts-entities'
import type { DockerPullLayerRow } from '../docker-image-pull-progress-panel'
import { SECURITY_SCAN_SCANNERS } from './scan-model'

/** Pure helpers that turn scanner pull log lines into per-layer progress rows. */

const ANSI_ESCAPE_SEQUENCE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu')
const PULL_LAYER_STATUS_WEIGHT: Record<DockerPullLayerRow['status'], number> = {
  waiting: 0,
  downloading: 1,
  extracting: 2,
  done: 3,
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE_PATTERN, '').trim()
}

export function resolvePullLayerStatus(rawMessage: string): DockerPullLayerRow['status'] | null {
  const normalizedMessage = rawMessage.toLowerCase()

  if (
    normalizedMessage.includes('already exists')
    || normalizedMessage.includes('pull complete')
    || normalizedMessage.includes('download complete')
    || normalizedMessage.includes('downloaded newer image')
  ) {
    return 'done'
  }

  if (normalizedMessage.includes('extracting')) {
    return 'extracting'
  }

  if (normalizedMessage.includes('downloading') || normalizedMessage.includes('verifying checksum')) {
    return 'downloading'
  }

  if (normalizedMessage.includes('waiting') || normalizedMessage.includes('pulling fs layer')) {
    return 'waiting'
  }

  return null
}

export function mergePullLayerStatus(
  current: DockerPullLayerRow['status'],
  next: DockerPullLayerRow['status'],
): DockerPullLayerRow['status'] {
  return PULL_LAYER_STATUS_WEIGHT[next] >= PULL_LAYER_STATUS_WEIGHT[current] ? next : current
}

export function inferPullLayerProgress(status: DockerPullLayerRow['status'], message: string): number {
  const explicitPercentMatch = /(\d{1,3})\s*%/u.exec(message)
  if (explicitPercentMatch) {
    const parsedPercent = Number.parseInt(explicitPercentMatch[1] ?? '0', 10)
    return Number.isFinite(parsedPercent) ? Math.min(100, Math.max(0, parsedPercent)) : 0
  }

  if (status === 'done') return 100
  if (status === 'extracting') return 70
  if (status === 'downloading') return 35
  return 0
}

export function parsePullLayerActivity(rawLine: string): {
  layerId: string
  status: DockerPullLayerRow['status']
  progress: number
  instruction: string
} | null {
  const line = stripAnsi(rawLine)
  if (line.length === 0) {
    return null
  }

  const layerLineMatch = /^([^\s:]+):\s*(.+)$/u.exec(line)
  if (!layerLineMatch) {
    return null
  }

  const layerId = layerLineMatch[1]?.trim() ?? ''
  const message = layerLineMatch[2]?.trim() ?? ''
  if (layerId.length === 0 || message.length === 0) {
    return null
  }

  const status = resolvePullLayerStatus(message)
  if (!status) {
    return null
  }

  return {
    layerId,
    status,
    progress: inferPullLayerProgress(status, message),
    instruction: message,
  }
}
export interface PullingScannerRow {
  scanner: (typeof SECURITY_SCAN_SCANNERS)[number]
  status: DockerPullLayerRow['status']
  progress: number
  latestPullingEvent: DockerImageSecurityScanEvent | null
}

export function buildPullingScannerRows(
  events: readonly DockerImageSecurityScanEvent[],
  hasCompletedScan: boolean,
): PullingScannerRow[] {
  return SECURITY_SCAN_SCANNERS.map((scanner) => {
    const scannerEvents = events.filter((event) => event.scanner === scanner)
    const pullingEvents = scannerEvents.filter((event) => event.stage === 'pulling-scanner')
    const latestPullingEvent = pullingEvents.at(-1) ?? null
    const hasAdvancedPastPulling = scannerEvents.some((event) => event.stage !== 'queued' && event.stage !== 'pulling-scanner')
    const hasScannerError = scannerEvents.some((event) => event.type === 'error' || event.stage === 'error')

    const status: DockerPullLayerRow['status'] = hasScannerError
      ? 'waiting'
      : hasAdvancedPastPulling || hasCompletedScan
        ? 'done'
        : pullingEvents.length > 0
          ? 'downloading'
          : 'waiting'

    const progress = status === 'done'
      ? 100
      : Math.max(0, ...pullingEvents.map((event) => event.progress ?? 0))

    return { scanner, status, progress, latestPullingEvent }
  })
}

export function buildPullingLayers(
  pullingActivityEvents: readonly DockerImageSecurityScanEvent[],
  scannerRows: readonly PullingScannerRow[],
): DockerPullLayerRow[] {
  const rowsByLayer = new Map<string, DockerPullLayerRow>()

  for (const event of pullingActivityEvents) {
    if (event.type !== 'log') continue

    const message = event.logLine ?? event.payload.line
    const parsedActivity = parsePullLayerActivity(message)
    if (!parsedActivity) continue

    const scanner = event.scanner ?? 'pipeline'
    const layerKey = `${scanner}:${parsedActivity.layerId}`
    const previousLayer = rowsByLayer.get(layerKey)
    const status = previousLayer
      ? mergePullLayerStatus(previousLayer.status, parsedActivity.status)
      : parsedActivity.status
    const progress = status === 'done'
      ? 100
      : Math.max(previousLayer?.progress ?? 0, parsedActivity.progress)

    rowsByLayer.set(layerKey, {
      id: layerKey,
      digest: `${scanner}:${parsedActivity.layerId}`,
      instruction: parsedActivity.instruction,
      size: 'scanner layer',
      status,
      progress,
    })
  }

  if (rowsByLayer.size > 0) {
    return Array.from(rowsByLayer.values()).sort((left, right) => {
      const statusWeightDelta = PULL_LAYER_STATUS_WEIGHT[left.status] - PULL_LAYER_STATUS_WEIGHT[right.status]
      if (statusWeightDelta !== 0) return statusWeightDelta
      if (left.progress !== right.progress) return right.progress - left.progress
      return left.id.localeCompare(right.id)
    })
  }

  return scannerRows.map((row) => ({
    id: `scanner-${row.scanner}`,
    digest: `scanner:${row.scanner}`,
    instruction: row.latestPullingEvent?.message ?? `Preparing ${row.scanner} scanner image`,
    size: 'scanner',
    status: row.status,
    progress: row.progress,
  }))
}
