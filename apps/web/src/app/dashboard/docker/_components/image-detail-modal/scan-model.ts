import type {
  DockerImageSecurityScanEvent,
  DockerImageSecurityScanStage,
  DockerVulnerabilityEntry,
} from '@deployer/contracts-entities'

/** Pure helpers for the image detail modal (scan events, pull-layer parsing, severity). */

export const SECURITY_SCAN_EVENT_LIMIT = 800
export const SECURITY_SCAN_LOG_PAGE_SIZE = 120
export const SECURITY_SCAN_INITIAL_PAGE_INDEX = 1
export const SECURITY_SCAN_SCANNERS = ['trivy', 'grype', 'dive'] as const

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
