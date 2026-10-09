import type {
  DockerImageSecurityScanEvent,
  DockerImageSecurityScanStage,
  DockerVulnerabilityEntry,
} from '@repo/contracts-entities'
import type { DockerPullLayerRow } from '../docker-image-pull-progress-panel'

/** Pure helpers for the image detail modal (scan events, pull-layer parsing, severity). */

export const SECURITY_SCAN_EVENT_LIMIT = 800
export const SECURITY_SCAN_LOG_PAGE_SIZE = 120
export const SECURITY_SCAN_INITIAL_PAGE_INDEX = 1
export const SECURITY_SCAN_SCANNERS = ['trivy', 'grype', 'dive'] as const

const ANSI_ESCAPE_SEQUENCE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu')
const PULL_LAYER_STATUS_WEIGHT: Record<DockerPullLayerRow['status'], number> = {
  waiting: 0,
  downloading: 1,
  extracting: 2,
  done: 3,
}

const SEVERITY_WEIGHT: Record<DockerVulnerabilityEntry['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export function buildScanEventKey(event: DockerImageSecurityScanEvent): string {
  return [
    event.timestamp,
    event.type,
    event.stage,
    event.scanner ?? 'none',
    event.message,
    event.logLine ?? '',
  ].join('|')
}

export function createSyntheticScanEvent(params: {
  imageId: string
  stage: DockerImageSecurityScanStage
  type: DockerImageSecurityScanEvent['type']
  message: string
}): DockerImageSecurityScanEvent {
  const progress = params.stage === 'queued' ? 0 : params.stage === 'completed' ? 100 : null

  if (params.type === 'status') {
    return {
      imageId: params.imageId,
      timestamp: new Date().toISOString(),
      type: 'status',
      stage: params.stage,
      scanner: null,
      message: params.message,
      progress,
      logLine: null,
      payload: {
        stage: params.stage,
        progress,
        message: params.message,
      },
    }
  }

  if (params.type === 'error') {
    return {
      imageId: params.imageId,
      timestamp: new Date().toISOString(),
      type: 'error',
      stage: params.stage,
      scanner: null,
      message: params.message,
      progress,
      logLine: params.message,
      payload: {
        error: params.message,
        scannerResult: null,
      },
    }
  }

  if (params.type === 'log') {
    return {
      imageId: params.imageId,
      timestamp: new Date().toISOString(),
      type: 'log',
      stage: params.stage,
      scanner: null,
      message: params.message,
      progress,
      logLine: params.message,
      payload: {
        line: params.message,
      },
    }
  }

  if (params.type === 'result') {
    return {
      imageId: params.imageId,
      timestamp: new Date().toISOString(),
      type: 'result',
      stage: params.stage,
      scanner: null,
      message: params.message,
      progress,
      logLine: null,
      scannerResult: {
        scanner: 'trivy',
        status: 'unavailable',
        findingsCount: 0,
        durationMs: null,
        executedAt: new Date().toISOString(),
        error: null,
      },
      payload: {
        scannerResult: {
          scanner: 'trivy',
          status: 'unavailable',
          findingsCount: 0,
          durationMs: null,
          executedAt: new Date().toISOString(),
          error: null,
        },
      },
    }
  }

  return {
    imageId: params.imageId,
    timestamp: new Date().toISOString(),
    type: 'complete',
    stage: params.stage,
    scanner: null,
    message: params.message,
    progress,
    logLine: null,
    scanSummary: {
      cached: false,
      scannedAt: new Date().toISOString(),
      totalFindings: 0,
      scanners: [],
      layerEfficiency: null,
    },
    vulnerabilities: [],
    payload: {
      scanSummary: {
        cached: false,
        scannedAt: new Date().toISOString(),
        totalFindings: 0,
        scanners: [],
        layerEfficiency: null,
      },
      vulnerabilities: [],
    },
  }
}

export function toClock(iso: string): string {
  if (!iso) return '--:--:--'
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return iso
  return new Date(timestamp).toISOString().slice(11, 19)
}

export function summarizeSeverity(vulnerabilities: DockerVulnerabilityEntry[]): Record<DockerVulnerabilityEntry['severity'], number> {
  return vulnerabilities.reduce<Record<DockerVulnerabilityEntry['severity'], number>>(
    (accumulator, entry) => {
      accumulator[entry.severity] += 1
      return accumulator
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  )
}

export function buildVulnerabilityRowKey(vulnerability: DockerVulnerabilityEntry, index: number): string {
  return [
    vulnerability.id,
    vulnerability.packageName,
    vulnerability.currentVersion,
    vulnerability.fixedVersion ?? 'no-fix',
    vulnerability.severity,
    (vulnerability.scannerSources ?? []).join(','),
    String(index),
  ].join('|')
}

export function normalizeLayerDigestToken(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return normalized.replace(/^sha256:/u, '')
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

export type VulnerabilitySeverityFilter = 'all' | DockerVulnerabilityEntry['severity']
export type VulnerabilityScannerFilter = 'all' | 'trivy' | 'grype' | 'dive' | 'multi-source' | 'unmapped'
export type VulnerabilitySort = 'severity-desc' | 'severity-asc' | 'package-asc' | 'package-desc'

export interface VulnerabilityFilterState {
  search: string
  severity: VulnerabilitySeverityFilter
  scanner: VulnerabilityScannerFilter
  sort: VulnerabilitySort
}

/** Filter then sort findings. Pure so the rules are testable. */
export function filterAndSortVulnerabilities(
  vulnerabilities: readonly DockerVulnerabilityEntry[],
  state: VulnerabilityFilterState,
): DockerVulnerabilityEntry[] {
  const normalizedSearch = state.search.trim().toLowerCase()

  const filtered = vulnerabilities.filter((entry) => {
    if (state.severity !== 'all' && entry.severity !== state.severity) return false

    if (state.scanner !== 'all') {
      const sources = entry.scannerSources ?? []
      if (state.scanner === 'multi-source') {
        if (sources.length < 2) return false
      } else if (state.scanner === 'unmapped') {
        if (entry.layerDigest || entry.layerId) return false
      } else if (!sources.includes(state.scanner)) {
        return false
      }
    }

    if (normalizedSearch.length === 0) return true

    const scannerText = (entry.scannerSources ?? []).join(' ')
    const layerText = `${entry.layerDigest ?? ''} ${entry.layerId ?? ''}`
    const searchText = `${entry.id} ${entry.packageName} ${entry.currentVersion} ${entry.fixedVersion ?? ''} ${entry.description} ${scannerText} ${layerText}`
      .toLowerCase()
    return searchText.includes(normalizedSearch)
  })

  return [...filtered].sort((left, right) => {
    if (state.sort === 'package-asc') return left.packageName.localeCompare(right.packageName)
    if (state.sort === 'package-desc') return right.packageName.localeCompare(left.packageName)
    if (state.sort === 'severity-asc') return SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity]
    return SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity]
  })
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

export interface LayerRisk {
  findings: DockerVulnerabilityEntry[]
  severity: DockerVulnerabilityEntry['severity'] | null
  scannerSources: Set<'trivy' | 'grype' | 'dive'>
}

/** Map findings onto image layers by (normalized) digest. */
export function buildLayerRiskById(
  layers: readonly { id: string }[],
  vulnerabilities: readonly DockerVulnerabilityEntry[],
): Map<string, LayerRisk> {
  const riskByLayerId = new Map<string, LayerRisk>()
  const layerByDigest = new Map<string, string>()

  for (const layer of layers) {
    const normalized = normalizeLayerDigestToken(layer.id)
    if (normalized) layerByDigest.set(normalized, layer.id)
  }

  for (const vulnerability of vulnerabilities) {
    const normalizedDigest = normalizeLayerDigestToken(vulnerability.layerDigest ?? vulnerability.layerId)
    if (!normalizedDigest) continue

    const mappedLayerId = layerByDigest.get(normalizedDigest)
    if (!mappedLayerId) continue

    const previous = riskByLayerId.get(mappedLayerId) ?? {
      findings: [],
      severity: null,
      scannerSources: new Set<'trivy' | 'grype' | 'dive'>(),
    }

    previous.findings.push(vulnerability)
    if (!previous.severity || SEVERITY_WEIGHT[vulnerability.severity] > SEVERITY_WEIGHT[previous.severity]) {
      previous.severity = vulnerability.severity
    }
    for (const source of vulnerability.scannerSources ?? []) previous.scannerSources.add(source)

    riskByLayerId.set(mappedLayerId, previous)
  }

  return riskByLayerId
}
