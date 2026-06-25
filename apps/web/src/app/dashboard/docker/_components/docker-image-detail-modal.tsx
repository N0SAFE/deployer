'use client'

import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useDockerImageInspect, useDockerImageSecurityScanStream, useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import {
  dockerImageInspectDetailSchema,
  type DockerImageSecurityScanEvent,
  type DockerImageSecurityScanStage,
  type DockerRuntimeEvent,
  type DockerVulnerabilityEntry,
} from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { ChevronDown, ChevronRight, Download, Loader2, Play, RefreshCw, ScanSearch, Search, Tag, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { DockerDetailLoadingState } from './docker-loading-states'
import { DockerImagePullProgressPanel, type DockerPullLayerRow, type DockerPullTimelineRow } from './docker-image-pull-progress-panel'
import { DockerImageSecurityFlow, type DockerImageSecurityFlowStage } from './docker-image-security-flow'
import { DockerModalQuickActions } from './docker-modal-quick-actions'
import { LogsViewer, type LogsViewerLine } from '@/components/atomics/organisms/logs'

type DockerImageModalTab = 'overview' | 'layers' | 'security' | 'labels'
type DockerImageSecuritySubTab = DockerImageSecurityFlowStage

interface DockerImageDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: DockerImageModalTab
}

interface DockerImageDetailModalProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunImage?: (imageRef: string) => void
  initialTab?: DockerImageModalTab
}

interface DockerImageDetailContentProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunImage?: (imageRef: string) => void
  initialTab?: DockerImageModalTab
}

const SECURITY_SCAN_EVENT_LIMIT = 800
const SECURITY_SCAN_LOG_PAGE_SIZE = 120
const SECURITY_SCAN_INITIAL_PAGE_INDEX = 1
const SECURITY_SCAN_SCANNERS = ['trivy', 'grype', 'dive'] as const

const ANSI_ESCAPE_SEQUENCE_PATTERN = /\u001b\[[0-9;]*m/gu
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

const REFETCH_INSPECT_RUNTIME_ACTIONS = new Set([
  'pull',
  'create',
  'import',
  'load',
  'tag',
  'untag',
  'push',
  'delete',
  'prune',
])

function normalizeImageId(value: string | null | undefined): string | null {
  if (!value) return null
  return value.trim().toLowerCase().replace(/^sha256:/u, '')
}

function imageIdsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeImageId(left)
  const normalizedRight = normalizeImageId(right)

  if (!normalizedLeft || !normalizedRight) return false

  return (
    normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(normalizedRight)
    || normalizedRight.startsWith(normalizedLeft)
  )
}

function matchesRuntimeImageEvent(event: DockerRuntimeEvent, imageId: string): boolean {
  if (event.source !== 'image') {
    return false
  }

  return imageIdsMatch(event.actorId, imageId) || imageIdsMatch(event.payload.imageId, imageId)
}

function buildScanEventKey(event: DockerImageSecurityScanEvent): string {
  return [
    event.timestamp,
    event.type,
    event.stage,
    event.scanner ?? 'none',
    event.message,
    event.logLine ?? '',
  ].join('|')
}

function createSyntheticScanEvent(params: {
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

function toClock(iso: string): string {
  if (!iso) return '--:--:--'
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return iso
  return new Date(timestamp).toISOString().slice(11, 19)
}

function summarizeSeverity(vulnerabilities: DockerVulnerabilityEntry[]): Record<DockerVulnerabilityEntry['severity'], number> {
  return vulnerabilities.reduce(
    (accumulator, entry) => {
      accumulator[entry.severity] += 1
      return accumulator
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    } as Record<DockerVulnerabilityEntry['severity'], number>,
  )
}

function buildVulnerabilityRowKey(vulnerability: DockerVulnerabilityEntry, index: number): string {
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

function normalizeLayerDigestToken(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return normalized.replace(/^sha256:/u, '')
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE_PATTERN, '').trim()
}

function resolvePullLayerStatus(rawMessage: string): DockerPullLayerRow['status'] | null {
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

function mergePullLayerStatus(
  current: DockerPullLayerRow['status'],
  next: DockerPullLayerRow['status'],
): DockerPullLayerRow['status'] {
  return PULL_LAYER_STATUS_WEIGHT[next] >= PULL_LAYER_STATUS_WEIGHT[current] ? next : current
}

function inferPullLayerProgress(status: DockerPullLayerRow['status'], message: string): number {
  const explicitPercentMatch = message.match(/(\d{1,3})\s*%/u)
  if (explicitPercentMatch) {
    const parsedPercent = Number.parseInt(explicitPercentMatch[1] ?? '0', 10)
    return Number.isFinite(parsedPercent) ? Math.min(100, Math.max(0, parsedPercent)) : 0
  }

  if (status === 'done') return 100
  if (status === 'extracting') return 70
  if (status === 'downloading') return 35
  return 0
}

function parsePullLayerActivity(rawLine: string): {
  layerId: string
  status: DockerPullLayerRow['status']
  progress: number
  instruction: string
} | null {
  const line = stripAnsi(rawLine)
  if (line.length === 0) {
    return null
  }

  const layerLineMatch = line.match(/^([^\s:]+):\s*(.+)$/u)
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

function DockerImageDetailContent({
  id,
  open,
  onOpenChange,
  onRunImage,
  initialTab = 'overview',
}: DockerImageDetailContentProps) {
  const [activeTab, setActiveTab] = useState<DockerImageModalTab>(initialTab)
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const [securitySubTab, setSecuritySubTab] = useState<DockerImageSecuritySubTab>('pulling')
  const [selectedVulnerabilityId, setSelectedVulnerabilityId] = useState<string | null>(null)
  const [scanToolFilter, setScanToolFilter] = useState<'all' | 'pipeline' | 'trivy' | 'grype' | 'dive'>('all')
  const [scanStageFilter, setScanStageFilter] = useState<'all' | DockerImageSecurityScanStage>('all')
  const [scanTypeFilter, setScanTypeFilter] = useState<'all' | DockerImageSecurityScanEvent['type']>('all')
  const [vulnerabilitySeverityFilter, setVulnerabilitySeverityFilter] = useState<'all' | DockerVulnerabilityEntry['severity']>('all')
  const [vulnerabilityScannerFilter, setVulnerabilityScannerFilter] = useState<'all' | 'trivy' | 'grype' | 'dive' | 'multi-source' | 'unmapped'>('all')
  const [vulnerabilitySearch, setVulnerabilitySearch] = useState('')
  const [vulnerabilitySort, setVulnerabilitySort] = useState<'severity-desc' | 'severity-asc' | 'package-asc' | 'package-desc'>('severity-desc')
  const [scanEvents, setScanEvents] = useState<DockerImageSecurityScanEvent[]>([])
  const [scanLogPageIndex, setScanLogPageIndex] = useState<number>(SECURITY_SCAN_INITIAL_PAGE_INDEX)
  const [scanLogHistoryLoading, setScanLogHistoryLoading] = useState(false)
  const [forceSecurityStream, setForceSecurityStream] = useState(false)
  const [forceSecurityScan, setForceSecurityScan] = useState(false)
  const [scanSessionStartedAtMs, setScanSessionStartedAtMs] = useState<number | null>(null)

  const securityScanEventKeySetRef = useRef<Set<string>>(new Set())
  const securityScanEventKeyQueueRef = useRef<string[]>([])

  const runtimeSnapshotDetailQuery = useDockerRuntimeEntityDetail('images', id, { enabled: open })
  const runtimeSnapshotDetail = runtimeSnapshotDetailQuery.data

  const imageInspectQuery = useDockerImageInspect(
    {
      query: {
        imageId: id,
      },
    },
    { enabled: open },
  )

  const imageScanStreamQuery = useDockerImageSecurityScanStream(
    {
      query: {
        imageId: id,
        refreshIntervalMs: 500,
        forceScan: forceSecurityScan,
      },
    },
    {
      enabled: open && (activeTab === 'security' || forceSecurityStream),
    },
  )

  const inspectDetail = useMemo(() => {
    const parsed = dockerImageInspectDetailSchema.safeParse(imageInspectQuery.data)
    return parsed.success ? parsed.data : null
  }, [imageInspectQuery.data])

  const detail = runtimeSnapshotDetail

  const streamEventsForActiveSession = useMemo(() => {
    if (scanSessionStartedAtMs === null) {
      return imageScanStreamQuery.events
    }

    return imageScanStreamQuery.events.filter((event) => {
      const timestamp = Date.parse(event.timestamp)
      if (!Number.isFinite(timestamp)) {
        return true
      }

      return timestamp >= scanSessionStartedAtMs - 1_000
    })
  }, [imageScanStreamQuery.events, scanSessionStartedAtMs])

  const effectiveScanEvents = useMemo(() => {
    const combined = [...scanEvents, ...streamEventsForActiveSession]
    if (combined.length === 0) {
      return combined
    }

    const deduped = new Map<string, DockerImageSecurityScanEvent>()
    for (const event of combined) {
      deduped.set(buildScanEventKey(event), event)
    }

    const merged = Array.from(deduped.values())
    if (merged.length <= SECURITY_SCAN_EVENT_LIMIT) {
      return merged
    }

    return merged.slice(merged.length - SECURITY_SCAN_EVENT_LIMIT)
  }, [scanEvents, streamEventsForActiveSession])

  const hasCompleteEvent = useMemo(() => {
    return effectiveScanEvents.some((event) => event.type === 'complete' || event.stage === 'completed')
  }, [effectiveScanEvents])

  const isScanSessionActive = scanSessionStartedAtMs !== null

  const vulnerabilitiesFromEvents = useMemo<DockerVulnerabilityEntry[] | null>(() => {
    for (let index = effectiveScanEvents.length - 1; index >= 0; index -= 1) {
      const event = effectiveScanEvents[index]
      if (event?.vulnerabilities) {
        return event.vulnerabilities
      }
    }

    return null
  }, [effectiveScanEvents])

  const vulnerabilities = useMemo<DockerVulnerabilityEntry[]>(() => {
    if (isScanSessionActive) {
      return hasCompleteEvent ? (vulnerabilitiesFromEvents ?? []) : []
    }

    return vulnerabilitiesFromEvents ?? inspectDetail?.vulnerabilities ?? []
  }, [hasCompleteEvent, inspectDetail?.vulnerabilities, isScanSessionActive, vulnerabilitiesFromEvents])

  const severityCounts = useMemo(() => summarizeSeverity(vulnerabilities), [vulnerabilities])
  const hasCriticalOrHigh = severityCounts.critical > 0 || severityCounts.high > 0

  const effectiveScanSummary = useMemo(() => {
    for (let index = effectiveScanEvents.length - 1; index >= 0; index -= 1) {
      const event = effectiveScanEvents[index]
      if (event?.scanSummary) {
        return event.scanSummary
      }
    }

    if (isScanSessionActive) {
      return null
    }

    return inspectDetail?.scanSummary ?? null
  }, [effectiveScanEvents, inspectDetail?.scanSummary, isScanSessionActive])

  const hasCompletedScan = useMemo(() => {
    if (isScanSessionActive) {
      return hasCompleteEvent
    }

    if (effectiveScanSummary) {
      return true
    }

    return hasCompleteEvent
  }, [effectiveScanSummary, hasCompleteEvent, isScanSessionActive])

  const streamStatusEvents = useMemo(
    () => effectiveScanEvents.filter((event) => event.type !== 'log').slice(-80),
    [effectiveScanEvents],
  )

  const pullingActivityEvents = useMemo(
    () => effectiveScanEvents
      .filter(
        (event) => event.stage === 'pulling-scanner'
          && (event.type === 'status' || event.type === 'log' || event.type === 'error'),
      )
      .slice(-220),
    [effectiveScanEvents],
  )

  const pullingScannerRows = useMemo(() => {
    return SECURITY_SCAN_SCANNERS.map((scanner) => {
      const scannerEvents = effectiveScanEvents.filter((event) => event.scanner === scanner)
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

      return {
        scanner,
        status,
        progress,
        latestPullingEvent,
      }
    })
  }, [effectiveScanEvents, hasCompletedScan])

  const pullingLayers = useMemo<DockerPullLayerRow[]>(() => {
    const rowsByLayer = new Map<string, DockerPullLayerRow>()

    for (const event of pullingActivityEvents) {
      if (event.type !== 'log') {
        continue
      }

      const message = event.logLine ?? event.payload.line ?? event.message
      const parsedActivity = parsePullLayerActivity(message)
      if (!parsedActivity) {
        continue
      }

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
      const rows = Array.from(rowsByLayer.values())
      rows.sort((left, right) => {
        const statusWeightDelta = PULL_LAYER_STATUS_WEIGHT[left.status] - PULL_LAYER_STATUS_WEIGHT[right.status]
        if (statusWeightDelta !== 0) {
          return statusWeightDelta
        }

        if (left.progress !== right.progress) {
          return right.progress - left.progress
        }

        return left.id.localeCompare(right.id)
      })

      return rows
    }

    return pullingScannerRows.map((row) => ({
      id: `scanner-${row.scanner}`,
      digest: `scanner:${row.scanner}`,
      instruction: row.latestPullingEvent?.message ?? `Preparing ${row.scanner} scanner image`,
      size: 'scanner',
      status: row.status,
      progress: row.progress,
    }))
  }, [pullingActivityEvents, pullingScannerRows])

  const pullingTimelineRows = useMemo<DockerPullTimelineRow[]>(() => {
    return pullingActivityEvents.map((event) => ({
      at: event.timestamp,
      type: `${event.scanner ?? 'pipeline'}:${event.type}`,
      message: event.logLine ?? (event.type === 'log' ? event.payload.line : event.message),
    }))
  }, [pullingActivityEvents])

  const pullErrorMessage = useMemo(() => {
    for (let index = streamStatusEvents.length - 1; index >= 0; index -= 1) {
      const event = streamStatusEvents[index]
      if (event?.type === 'error' || event?.stage === 'error') {
        return event.message
      }
    }

    return null
  }, [streamStatusEvents])

  const hasLivePullingActivity = useMemo(() => {
    return effectiveScanEvents.some((event) => {
      if (event.type === 'log') {
        return true
      }

      return event.stage === 'pulling-scanner' || event.stage === 'scanning' || event.stage === 'parsing' || event.stage === 'merging'
    })
  }, [effectiveScanEvents])

  const pullStatus = useMemo<'idle' | 'queued' | 'pulling' | 'complete' | 'error'>(() => {
    if (pullErrorMessage) {
      return 'error'
    }

    if (hasCompletedScan || pullingScannerRows.every((row) => row.status === 'done')) {
      return 'complete'
    }

    if (hasLivePullingActivity) {
      return 'pulling'
    }

    if (!hasCompletedScan) {
      return 'queued'
    }

    if (forceSecurityStream || imageScanStreamQuery.fetchStatus === 'fetching') {
      return 'pulling'
    }

    return 'idle'
  }, [forceSecurityStream, hasCompletedScan, hasLivePullingActivity, imageScanStreamQuery.fetchStatus, pullErrorMessage, pullingScannerRows])

  const pullProgress = useMemo(() => {
    if (pullStatus === 'complete') {
      return 100
    }

    if (pullStatus === 'queued') {
      return 0
    }

    if (pullingScannerRows.length === 0) {
      return 0
    }

    const totalProgress = pullingScannerRows.reduce((sum, row) => sum + row.progress, 0)
    return Math.round(totalProgress / pullingScannerRows.length)
  }, [pullStatus, pullingScannerRows])

  const streamLogEvents = useMemo(
    () => effectiveScanEvents.filter((event) => event.type === 'log').slice(-160),
    [effectiveScanEvents],
  )

  const scannerExecutionLogEvents = useMemo(
    () => streamLogEvents.filter((event) => event.stage !== 'pulling-scanner'),
    [streamLogEvents],
  )

  const scannerSummaries = useMemo(() => {
    if (effectiveScanSummary?.scanners && effectiveScanSummary.scanners.length > 0) {
      return effectiveScanSummary.scanners
    }

    const latestByScanner = new Map<'trivy' | 'grype' | 'dive', NonNullable<DockerImageSecurityScanEvent['scannerResult']>>()
    for (const event of effectiveScanEvents) {
      if (!event.scannerResult) {
        continue
      }

      latestByScanner.set(event.scannerResult.scanner, event.scannerResult)
    }

    return SECURITY_SCAN_SCANNERS
      .map((scanner) => latestByScanner.get(scanner) ?? null)
      .filter((item): item is NonNullable<DockerImageSecurityScanEvent['scannerResult']> => item !== null)
  }, [effectiveScanEvents, effectiveScanSummary?.scanners])

  const layers = inspectDetail?.layers ?? []
  const layerRiskById = useMemo(() => {
    const riskByLayerId = new Map<string, {
      findings: DockerVulnerabilityEntry[]
      severity: DockerVulnerabilityEntry['severity'] | null
      scannerSources: Set<'trivy' | 'grype' | 'dive'>
    }>()

    const layerByDigest = new Map<string, string>()
    for (const layer of layers) {
      const normalized = normalizeLayerDigestToken(layer.id)
      if (!normalized) {
        continue
      }

      layerByDigest.set(normalized, layer.id)
    }

    for (const vulnerability of vulnerabilities) {
      const normalizedDigest = normalizeLayerDigestToken(vulnerability.layerDigest ?? vulnerability.layerId)
      if (!normalizedDigest) {
        continue
      }

      const mappedLayerId = layerByDigest.get(normalizedDigest)
      if (!mappedLayerId) {
        continue
      }

      const previous = riskByLayerId.get(mappedLayerId) ?? {
        findings: [],
        severity: null,
        scannerSources: new Set<'trivy' | 'grype' | 'dive'>(),
      }

      previous.findings.push(vulnerability)
      if (!previous.severity || SEVERITY_WEIGHT[vulnerability.severity] > SEVERITY_WEIGHT[previous.severity]) {
        previous.severity = vulnerability.severity
      }

      for (const source of vulnerability.scannerSources ?? []) {
        previous.scannerSources.add(source)
      }

      riskByLayerId.set(mappedLayerId, previous)
    }

    return riskByLayerId
  }, [layers, vulnerabilities])

  const mappedVulnerabilityCount = useMemo(() => {
    return Array.from(layerRiskById.values()).reduce((sum, layerRisk) => sum + layerRisk.findings.length, 0)
  }, [layerRiskById])

  const unmappedVulnerabilityCount = Math.max(0, vulnerabilities.length - mappedVulnerabilityCount)
  const isDetailLoading = runtimeSnapshotDetailQuery.isLoading && !detail

  function appendScanEvent(event: DockerImageSecurityScanEvent): void {
    setScanEvents((previous) => {
      const key = buildScanEventKey(event)

      if (securityScanEventKeySetRef.current.has(key)) {
        return previous
      }

      securityScanEventKeySetRef.current.add(key)
      securityScanEventKeyQueueRef.current.push(key)

      let next = [...previous, event]
      if (next.length <= SECURITY_SCAN_EVENT_LIMIT) {
        return next
      }

      const overflow = next.length - SECURITY_SCAN_EVENT_LIMIT
      next = next.slice(overflow)

      for (let index = 0; index < overflow; index += 1) {
        const dropped = securityScanEventKeyQueueRef.current.shift()
        if (dropped) {
          securityScanEventKeySetRef.current.delete(dropped)
        }
      }

      return next
    })
  }

  function resetScanEventState(): void {
    securityScanEventKeySetRef.current = new Set()
    securityScanEventKeyQueueRef.current = []
    setScanEvents([])
    setScanLogPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX)
    setScanLogHistoryLoading(false)
    setSelectedVulnerabilityId(null)
  }

  function triggerSecurityScan(options?: { activateTab?: boolean }): void {
    const activateTab = options?.activateTab ?? true
    const scanStartTimestamp = Date.now()

    resetScanEventState()
    setScanSessionStartedAtMs(scanStartTimestamp)
    setSecuritySubTab('pulling')

    if (activateTab) {
      setActiveTab('security')
    }

    setForceSecurityStream(true)
    setForceSecurityScan(true)

    const message = 'Rescan requested from UI.'

    appendScanEvent(
      createSyntheticScanEvent({
        imageId: id,
        stage: 'queued',
        type: 'status',
        message,
      }),
    )

    void imageScanStreamQuery.refetch().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error)

      appendScanEvent(
        createSyntheticScanEvent({
          imageId: id,
          stage: 'error',
          type: 'error',
          message: `Unable to start scan stream: ${errorMessage}`,
        }),
      )
    })
  }

  function buildImageRef(): string {
    if (inspectDetail) {
      const repositoryBase = `${inspectDetail.registry}/${inspectDetail.repository}`
      return inspectDetail.tag ? `${repositoryBase}:${inspectDetail.tag}` : repositoryBase
    }

    if (detail) {
      const repositoryBase = `${detail.registry}/${detail.repository}`
      return detail.tag ? `${repositoryBase}:${detail.tag}` : repositoryBase
    }

    return id
  }

  function handleRunImage(): void {
    const imageRef = buildImageRef()

    if (!hasCompletedScan) {
      setActiveTab('security')
      setOpsNotice('Run blocked: waiting for backend scan queue to complete first scan.')
      toast.info('Scan not ready yet', {
        description: imageRef,
      })
      return
    }

    if (hasCriticalOrHigh) {
      setActiveTab('security')
      setOpsNotice('Run blocked by policy: critical/high vulnerabilities detected.')
      toast.error('Run blocked by vulnerability policy', {
        description: `Critical/high findings detected for ${imageRef}`,
      })
      return
    }

    onRunImage?.(imageRef)
    toast.info('Run setup opened', {
      description: imageRef,
    })
    onOpenChange(false)
  }

  function queueImageOp(action: string): void {
    setOpsNotice(`${action} queued for ${inspectDetail?.repository ?? detail?.repository ?? id}`)
    toast.success(`${action} queued`, {
      description: buildImageRef(),
    })
  }

  useEffect(() => {
    if (!open) {
      return
    }

    setActiveTab(initialTab)
  }, [initialTab, open])

  useEffect(() => {
    if (!open) {
      securityScanEventKeySetRef.current = new Set()
      securityScanEventKeyQueueRef.current = []
      setScanEvents([])
      setForceSecurityStream(false)
      setForceSecurityScan(false)
      setScanSessionStartedAtMs(null)
      setSecuritySubTab('pulling')
      setSelectedVulnerabilityId(null)
      setScanToolFilter('all')
      setScanStageFilter('all')
      setScanTypeFilter('all')
      setVulnerabilitySeverityFilter('all')
      setVulnerabilityScannerFilter('all')
      setVulnerabilitySearch('')
      setVulnerabilitySort('severity-desc')
      setScanLogPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX)
      setScanLogHistoryLoading(false)
      setExpandedLayerId(null)
      return
    }

    setOpsNotice(null)
  }, [open])

  useEffect(() => {
    securityScanEventKeySetRef.current = new Set()
    securityScanEventKeyQueueRef.current = []
    setScanEvents([])
    setForceSecurityStream(false)
    setForceSecurityScan(false)
    setScanSessionStartedAtMs(null)
    setExpandedLayerId(null)
    setSecuritySubTab('pulling')
    setSelectedVulnerabilityId(null)
    setScanToolFilter('all')
    setScanStageFilter('all')
    setScanTypeFilter('all')
    setVulnerabilitySeverityFilter('all')
    setVulnerabilityScannerFilter('all')
    setVulnerabilitySearch('')
    setVulnerabilitySort('severity-desc')
    setScanLogPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX)
    setScanLogHistoryLoading(false)
    setOpsNotice(null)
  }, [id])

  useEffect(() => {
    setScanLogPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX)
  }, [scanToolFilter, scanStageFilter, scanTypeFilter])

  useEffect(() => {
    if (activeTab !== 'security') {
      return
    }

    if (hasCompletedScan) {
      setSecuritySubTab('results')
      return
    }

    if (scannerExecutionLogEvents.length > 0) {
      setSecuritySubTab('logs')
      return
    }

    setSecuritySubTab('pulling')
  }, [activeTab, hasCompletedScan, scannerExecutionLogEvents.length])

  useDockerLiveRefetch({
    on: { image: ['pull', 'create', 'import', 'load', 'tag', 'untag', 'push', 'delete', 'prune'] },
    onData: () => {
      void imageInspectQuery.refetch()
    },
    enabled: open,
    debounceMs: 650,
  })

  useEffect(() => {
    const events = streamEventsForActiveSession

    if (events.length === 0) {
      return
    }

    for (const event of events) {
      appendScanEvent(event)
    }

    const latestEvent = events[events.length - 1]
    if (!latestEvent) {
      return
    }

    if (latestEvent.type === 'complete' || latestEvent.stage === 'completed') {
      setForceSecurityStream(false)
      setForceSecurityScan(false)
      setScanSessionStartedAtMs(null)
      setOpsNotice('Security scan completed with latest findings loaded.')
      void imageInspectQuery.refetch()
    }

    if (latestEvent.type === 'error' || latestEvent.stage === 'error') {
      setForceSecurityStream(false)
      setForceSecurityScan(false)
      setScanSessionStartedAtMs(null)
      setOpsNotice(latestEvent.message)
    }
  }, [imageInspectQuery.refetch, streamEventsForActiveSession])

  function layerStatus(layerId: string): 'verified' | 'cached' | 'warning' | 'pending' {
    if (!hasCompletedScan) return 'pending'

    const risk = layerRiskById.get(layerId)
    if (risk && risk.findings.length > 0) return 'warning'

    if (unmappedVulnerabilityCount > 0) return 'cached'

    return 'verified'
  }

  function layerStatusVariant(status: 'verified' | 'cached' | 'warning' | 'pending'): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'verified') return 'default'
    if (status === 'cached') return 'secondary'
    if (status === 'warning') return 'destructive'
    return 'outline'
  }

  const scanStreamStatus = useMemo<'idle' | 'streaming' | 'error'>(() => {
    if (imageScanStreamQuery.isError) {
      return 'error'
    }

    if (imageScanStreamQuery.fetchStatus === 'fetching' || forceSecurityStream) {
      return 'streaming'
    }

    return 'idle'
  }, [forceSecurityStream, imageScanStreamQuery.fetchStatus, imageScanStreamQuery.isError])

  const filteredScanEvents = useMemo(() => {
    return effectiveScanEvents.filter((event) => {
      const normalizedTool = event.scanner ?? 'pipeline'

      if (scanToolFilter !== 'all' && normalizedTool !== scanToolFilter) {
        return false
      }

      if (scanStageFilter !== 'all' && event.stage !== scanStageFilter) {
        return false
      }

      if (scanTypeFilter !== 'all' && event.type !== scanTypeFilter) {
        return false
      }

      return true
    })
  }, [effectiveScanEvents, scanStageFilter, scanToolFilter, scanTypeFilter])

  const visibleFilteredScanEvents = useMemo(() => {
    const visibleCount = Math.max(SECURITY_SCAN_LOG_PAGE_SIZE, scanLogPageIndex * SECURITY_SCAN_LOG_PAGE_SIZE)
    const sliceStart = Math.max(0, filteredScanEvents.length - visibleCount)
    return filteredScanEvents.slice(sliceStart)
  }, [filteredScanEvents, scanLogPageIndex])

  const scanLogsHasMoreHistory = useMemo(() => {
    return filteredScanEvents.length > visibleFilteredScanEvents.length
  }, [filteredScanEvents.length, visibleFilteredScanEvents.length])

  function handleLoadOlderScanLogs(): void {
    if (scanLogHistoryLoading || !scanLogsHasMoreHistory) {
      return
    }

    setScanLogHistoryLoading(true)
    setScanLogPageIndex((previous) => previous + 1)
    setTimeout(() => {
      setScanLogHistoryLoading(false)
    }, 0)
  }

  const scanLogLines = useMemo<LogsViewerLine[]>(() => {
    return visibleFilteredScanEvents.map((event, index) => {
      const scannerLabel = (event.scanner ?? 'pipeline').toUpperCase()
      const header = `[${toClock(event.timestamp)}] [${scannerLabel}] [${event.stage}] [${event.type}]`
      const message = event.logLine ?? event.message

      return {
        id: `${event.timestamp}-${event.type}-${event.stage}-${event.scanner ?? 'pipeline'}-${String(index)}`,
        searchText: `${event.timestamp} ${event.type} ${event.stage} ${event.scanner ?? 'pipeline'} ${event.message} ${event.logLine ?? ''}`,
        content: (
          <>
            <span className="text-emerald-400">{header}</span>{' '}
            <span>{message}</span>
            {event.progress !== null ? <span className="text-slate-400"> ({String(event.progress)}%)</span> : null}
          </>
        ),
      }
    })
  }, [visibleFilteredScanEvents])

  const filteredVulnerabilities = useMemo(() => {
    const normalizedSearch = vulnerabilitySearch.trim().toLowerCase()

    const filtered = vulnerabilities.filter((entry) => {
      if (vulnerabilitySeverityFilter !== 'all' && entry.severity !== vulnerabilitySeverityFilter) {
        return false
      }

      if (vulnerabilityScannerFilter !== 'all') {
        const sources = entry.scannerSources ?? []

        if (vulnerabilityScannerFilter === 'multi-source') {
          if (sources.length < 2) {
            return false
          }
        } else if (vulnerabilityScannerFilter === 'unmapped') {
          const hasMappedLayer = Boolean(entry.layerDigest || entry.layerId)
          if (hasMappedLayer) {
            return false
          }
        } else if (!sources.includes(vulnerabilityScannerFilter)) {
          return false
        }
      }

      if (normalizedSearch.length === 0) {
        return true
      }

      const scannerText = (entry.scannerSources ?? []).join(' ')
      const layerText = `${entry.layerDigest ?? ''} ${entry.layerId ?? ''}`
      const searchText = `${entry.id} ${entry.packageName} ${entry.currentVersion} ${entry.fixedVersion ?? ''} ${entry.description} ${scannerText} ${layerText}`
        .toLowerCase()

      return searchText.includes(normalizedSearch)
    })

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (vulnerabilitySort === 'package-asc') {
        return left.packageName.localeCompare(right.packageName)
      }

      if (vulnerabilitySort === 'package-desc') {
        return right.packageName.localeCompare(left.packageName)
      }

      if (vulnerabilitySort === 'severity-asc') {
        return SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity]
      }

      return SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity]
    })

    return sorted
  }, [vulnerabilities, vulnerabilitySearch, vulnerabilityScannerFilter, vulnerabilitySeverityFilter, vulnerabilitySort])

  const vulnerabilityRows = useMemo(
    () => filteredVulnerabilities.map((vulnerability, index) => ({
      vulnerability,
      rowKey: buildVulnerabilityRowKey(vulnerability, index),
    })),
    [filteredVulnerabilities],
  )

  const selectedVulnerability = useMemo(() => {
    if (vulnerabilityRows.length === 0) {
      return null
    }

    if (!selectedVulnerabilityId) {
      return vulnerabilityRows[0]?.vulnerability ?? null
    }

    return vulnerabilityRows.find((row) => row.rowKey === selectedVulnerabilityId)?.vulnerability
      ?? vulnerabilityRows[0]?.vulnerability
      ?? null
  }, [selectedVulnerabilityId, vulnerabilityRows])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw]! max-w-350! h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="gap-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base">Image details</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
            </div>
            <DockerModalQuickActions
              actions={[
                {
                  label: 'Run',
                  icon: Play,
                  onClick: handleRunImage,
                },
                { label: 'Pull', icon: Download, onClick: () => queueImageOp('pull') },
                { label: 'Tag', icon: Tag, onClick: () => queueImageOp('tag') },
                { label: 'Push', icon: Upload, onClick: () => queueImageOp('push') },
                ...(hasCompletedScan ? [
                  {
                    label: 'Rescan',
                    icon: ScanSearch,
                    onClick: () => {
                      setActiveTab('security')
                      setOpsNotice('Manual image rescan requested.')
                      triggerSecurityScan()
                    },
                  },
                ] : []),
                { label: 'Export', icon: Download, onClick: () => queueImageOp('export') },
              ]}
              dangerAction={{ label: 'Remove', icon: Trash2, onClick: () => queueImageOp('remove') }}
            />
          </div>
          {opsNotice ? <p className="text-xs text-muted-foreground">{opsNotice}</p> : null}
        </DialogHeader>
        {detail ? (
          <Tabs
            value={activeTab}
            onValueChange={(value: string) => setActiveTab(value as DockerImageModalTab)}
            className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
          >
            <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
              <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
              <TabsTrigger className="shrink-0" value="layers">Layers</TabsTrigger>
              <TabsTrigger className="shrink-0" value="security">Security</TabsTrigger>
              <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="flex min-h-0 flex-col gap-3 text-sm">
              <dl className="grid gap-3 md:grid-cols-2">
                <div><dt className="text-muted-foreground">Registry</dt><dd>{inspectDetail?.registry ?? detail.registry}</dd></div>
                <div><dt className="text-muted-foreground">Repository</dt><dd className="break-all">{inspectDetail?.repository ?? detail.repository}</dd></div>
                <div><dt className="text-muted-foreground">Tag</dt><dd>{inspectDetail?.tag ?? detail.tag ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">Digest</dt><dd className="font-mono text-xs break-all">{inspectDetail?.digest ?? detail.digest ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">Size</dt><dd>{(inspectDetail?.sizeBytes ?? detail.sizeBytes) === null ? '—' : `${inspectDetail?.sizeBytes ?? detail.sizeBytes} bytes`}</dd></div>
                <div><dt className="text-muted-foreground">Last seen</dt><dd>{inspectDetail?.lastSeenAt ?? detail.lastSeenAt}</dd></div>
                <div><dt className="text-muted-foreground">Architecture</dt><dd>{inspectDetail?.architecture ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">OS</dt><dd>{inspectDetail?.os ?? '—'}</dd></div>
                <div><dt className="text-muted-foreground">Used by containers</dt><dd>{inspectDetail?.usedByContainerIds.length ?? 0}</dd></div>
                <div><dt className="text-muted-foreground">Repo tags</dt><dd>{inspectDetail?.repoTags.length ?? 0}</dd></div>
              </dl>
            </TabsContent>

            <TabsContent value="layers" className="flex min-h-0 flex-col gap-2 text-sm">
              {layers.length > 0 ? (
                <div className="flex-1 min-h-0 rounded border divide-y overflow-auto">
                  {layers.map((layer) => {
                    const layerRisk = layerRiskById.get(layer.id)
                    const topSeverity = layerRisk?.severity ?? null
                    const scannerSources = layerRisk ? Array.from(layerRisk.scannerSources.values()) : []

                    return (
                      <div key={layer.id} className="p-2">
                        <button
                          type="button"
                          className="w-full rounded-sm px-2 py-1.5 transition-colors hover:bg-muted/60"
                          onClick={() => setExpandedLayerId((previous) => (previous === layer.id ? null : layer.id))}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {expandedLayerId === layer.id ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <p className="font-mono text-xs break-all text-left">{layer.instruction}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge className="text-[10px]" variant={layerStatusVariant(layerStatus(layer.id))}>{layerStatus(layer.id)}</Badge>
                              <Badge className="text-[10px]" variant="outline">{layer.size}</Badge>
                            </div>
                          </div>
                        </button>
                        {expandedLayerId === layer.id ? (
                          <div className="mt-2 rounded border bg-muted/20 p-2 text-xs">
                            <div className="grid gap-2 md:grid-cols-2">
                              <div>
                                <p className="text-muted-foreground">Layer ID</p>
                                <code className="break-all">{layer.id}</code>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Created</p>
                                <p>{layer.createdAt}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Status</p>
                                <Badge className="text-[10px]" variant={layerStatusVariant(layerStatus(layer.id))}>{layerStatus(layer.id)}</Badge>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Risk context</p>
                                {layerRisk && layerRisk.findings.length > 0 ? (
                                  <p>
                                    {layerRisk.findings.length} mapped findings ({topSeverity ?? 'unknown'} top severity)
                                  </p>
                                ) : hasCompletedScan ? (
                                  unmappedVulnerabilityCount > 0 ? (
                                    <p>
                                      {unmappedVulnerabilityCount} findings reported but scanner output did not map them to this layer
                                    </p>
                                  ) : (
                                    <p>No findings mapped to this layer</p>
                                  )
                                ) : (
                                  <p>Waiting for scan completion…</p>
                                )}
                              </div>
                              <div className="md:col-span-2">
                                <p className="text-muted-foreground">Instruction</p>
                                <p className="font-mono break-all">{layer.instruction}</p>
                              </div>
                              {scannerSources.length > 0 ? (
                                <div className="md:col-span-2">
                                  <p className="text-muted-foreground">Detected by scanners</p>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {scannerSources.map((source) => (
                                      <Badge key={`${layer.id}-${source}`} variant="secondary" className="text-[10px] uppercase tracking-wide">{source}</Badge>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">
                  No layer metadata available yet. Run a security scan to stream scanner progress and refresh image detail.
                </div>
              )}
            </TabsContent>

            <TabsContent value="security" className="overflow-hidden! flex min-h-0 flex-1 flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="text-[10px]" variant={severityCounts.critical > 0 ? 'destructive' : 'outline'}>critical: {severityCounts.critical}</Badge>
                  <Badge className="text-[10px]" variant={severityCounts.high > 0 ? 'destructive' : 'outline'}>high: {severityCounts.high}</Badge>
                  <Badge className="text-[10px]" variant="outline">medium: {severityCounts.medium}</Badge>
                  <Badge className="text-[10px]" variant="outline">low: {severityCounts.low}</Badge>
                  <Badge className="text-[10px]" variant={scanStreamStatus === 'error' ? 'destructive' : scanStreamStatus === 'streaming' ? 'default' : 'outline'}>
                    stream: {scanStreamStatus}
                  </Badge>
                </div>
                {hasCompletedScan ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    onClick={() => {
                      setOpsNotice('Manual image rescan requested.')
                      triggerSecurityScan()
                    }}
                  >
                    {scanStreamStatus === 'streaming' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Rescan
                  </Button>
                ) : (
                  <Badge className="text-[10px]" variant="secondary">
                    Waiting for backend queue
                  </Badge>
                )}
              </div>

              <DockerImageSecurityFlow
                activeStage={securitySubTab}
                onStageChange={(stage) => setSecuritySubTab(stage)}
                pullStatus={pullStatus}
                logsCount={streamLogEvents.length}
                resultsCount={filteredVulnerabilities.length}
                pullingContent={(
                  <div className="h-full flex min-h-0 flex-1 flex-col gap-2 overflow-hidden!">
                    {pullStatus === 'queued' ? (
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        Scan is queued by the API service. This page will switch to live logs/results as soon as server-side scanning starts.
                      </div>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <DockerImagePullProgressPanel
                        image={buildImageRef()}
                        pullStatus={pullStatus}
                        pullProgress={pullProgress}
                        pullErrorMessage={pullErrorMessage}
                        pullRuntimeEventCount={pullingTimelineRows.length}
                        pullLayers={pullingLayers}
                        pullTimelineRows={pullingTimelineRows}
                        toClock={toClock}
                      />
                    </div>
                  </div>
                )}
                logsContent={(
                  <div className="h-full flex min-h-0 flex-1 flex-col overflow-hidden!">
                    <LogsViewer
                      lines={scanLogLines}
                      hasMoreHistory={scanLogsHasMoreHistory}
                      isLoadingHistory={scanLogHistoryLoading}
                      onLoadOlderLogs={handleLoadOlderScanLogs}
                      onReset={() => {
                        setScanToolFilter('all')
                        setScanStageFilter('all')
                        setScanTypeFilter('all')
                        setScanLogPageIndex(SECURITY_SCAN_INITIAL_PAGE_INDEX)
                      }}
                      streamRegionLabel="Image security scan logs"
                      badges={(
                        <>
                          <Badge className="text-[10px]" variant="outline">{scanLogLines.length} events</Badge>
                          <Badge className="text-[10px]" variant="outline">tools: trivy/grype/dive</Badge>
                          <Badge className="text-[10px]" variant="outline">pipeline + scanner containers</Badge>
                          <Badge className="text-[10px]" variant="outline">+{scanLogsHasMoreHistory ? '∞' : 'end'} history</Badge>
                        </>
                      )}
                      extraToolbarContent={(
                        <div className="flex flex-wrap items-center gap-2">
                          <select className="h-8 rounded border bg-background px-2 text-xs" value={scanToolFilter} onChange={(event) => setScanToolFilter(event.target.value as typeof scanToolFilter)}>
                            <option value="all">Tool: all</option>
                            <option value="pipeline">Tool: pipeline</option>
                            <option value="trivy">Tool: trivy</option>
                            <option value="grype">Tool: grype</option>
                            <option value="dive">Tool: dive</option>
                          </select>
                          <select className="h-8 rounded border bg-background px-2 text-xs" value={scanStageFilter} onChange={(event) => setScanStageFilter(event.target.value as typeof scanStageFilter)}>
                            <option value="all">Stage: all</option>
                            <option value="queued">queued</option>
                            <option value="pulling-scanner">pulling-scanner</option>
                            <option value="scanning">scanning</option>
                            <option value="parsing">parsing</option>
                            <option value="merging">merging</option>
                            <option value="completed">completed</option>
                            <option value="error">error</option>
                          </select>
                          <select className="h-8 rounded border bg-background px-2 text-xs" value={scanTypeFilter} onChange={(event) => setScanTypeFilter(event.target.value as typeof scanTypeFilter)}>
                            <option value="all">Type: all</option>
                            <option value="status">status</option>
                            <option value="log">log</option>
                            <option value="result">result</option>
                            <option value="complete">complete</option>
                            <option value="error">error</option>
                          </select>
                        </div>
                      )}
                      notice={<div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground"><span>Live stream state: {scanStreamStatus}</span><span>{hasCompletedScan ? 'completed' : 'in progress'}</span></div>}
                    />
                  </div>
                )}
                resultsContent={(
                  <div className="h-full mt-0 min-h-0 flex-1 overflow-hidden flex flex-col gap-2">
                    <div className="rounded border bg-muted/10 p-2 space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {scannerSummaries.length > 0 ? scannerSummaries.map((scannerSummary) => (
                          <div key={`scanner-summary-${scannerSummary.scanner}`} className="rounded border bg-background px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wide">{scannerSummary.scanner}</span>
                              <Badge
                                className="text-[10px]"
                                variant={scannerSummary.status === 'failed' ? 'destructive' : scannerSummary.status === 'completed' ? 'default' : 'outline'}
                              >
                                {scannerSummary.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              findings: {scannerSummary.findingsCount} · duration: {scannerSummary.durationMs ?? 0}ms
                            </p>
                            {scannerSummary.error ? <p className="mt-1 text-[11px] text-destructive line-clamp-2">{scannerSummary.error}</p> : null}
                          </div>
                        )) : (
                          <div className="rounded border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
                            Scanner summaries will appear here after scan completion (Trivy, Grype, Dive).
                          </div>
                        )}

                        {effectiveScanSummary?.layerEfficiency ? (
                          <div className="rounded border bg-background px-3 py-2 sm:col-span-2 xl:col-span-1">
                            <p className="text-xs font-semibold uppercase tracking-wide">Layer efficiency (dive)</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              score: {effectiveScanSummary.layerEfficiency.efficiencyScore ?? 'n/a'} · wasted: {effectiveScanSummary.layerEfficiency.estimatedWastedPercent ?? 'n/a'}%
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-58 flex-1 max-w-md">
                          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="text"
                            value={vulnerabilitySearch}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setVulnerabilitySearch(event.target.value)}
                            className="h-8 pl-8 text-xs"
                            placeholder="Search CVE, package, scanner, layer…"
                          />
                        </div>

                        <select className="h-8 rounded border bg-background px-2 text-xs" value={vulnerabilitySeverityFilter} onChange={(event) => setVulnerabilitySeverityFilter(event.target.value as typeof vulnerabilitySeverityFilter)}>
                          <option value="all">Severity: all</option>
                          <option value="critical">critical</option>
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="low">low</option>
                        </select>

                        <select className="h-8 rounded border bg-background px-2 text-xs" value={vulnerabilityScannerFilter} onChange={(event) => setVulnerabilityScannerFilter(event.target.value as typeof vulnerabilityScannerFilter)}>
                          <option value="all">Scanner: all</option>
                          <option value="trivy">Scanner: trivy</option>
                          <option value="grype">Scanner: grype</option>
                          <option value="dive">Scanner: dive</option>
                          <option value="multi-source">Scanner: multi-source</option>
                          <option value="unmapped">Layer map: unmapped</option>
                        </select>

                        <select className="h-8 rounded border bg-background px-2 text-xs" value={vulnerabilitySort} onChange={(event) => setVulnerabilitySort(event.target.value as typeof vulnerabilitySort)}>
                          <option value="severity-desc">Sort: severity ↓</option>
                          <option value="severity-asc">Sort: severity ↑</option>
                          <option value="package-asc">Sort: package A→Z</option>
                          <option value="package-desc">Sort: package Z→A</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid min-h-0 flex-1 gap-2 overflow-hidden lg:grid-cols-[1.2fr_.8fr]">
                      <div className="h-full overflow-auto rounded border divide-y bg-background">
                        {vulnerabilityRows.length > 0 ? vulnerabilityRows.map(({ vulnerability, rowKey }) => {
                          const isActive = selectedVulnerability?.id === vulnerability.id && selectedVulnerability.packageName === vulnerability.packageName
                          return (
                            <button
                              key={rowKey}
                              type="button"
                              className={`w-full p-3 text-left transition-colors ${isActive ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-muted/40'}`}
                              onClick={() => setSelectedVulnerabilityId(rowKey)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <code className="text-xs font-mono break-all">{vulnerability.id}</code>
                                <Badge className="text-[10px]" variant={vulnerability.severity === 'critical' || vulnerability.severity === 'high' ? 'destructive' : 'outline'}>
                                  {vulnerability.severity}
                                </Badge>
                              </div>

                              <p className="mt-1 text-xs text-muted-foreground">
                                {vulnerability.packageName} · {vulnerability.currentVersion}
                                {vulnerability.fixedVersion ? ` → ${vulnerability.fixedVersion}` : ''}
                              </p>

                              <div className="mt-1 flex flex-wrap gap-1">
                                {(vulnerability.scannerSources ?? []).map((source) => (
                                  <Badge key={`${rowKey}-${source}`} variant="secondary" className="text-[10px] uppercase tracking-wide">
                                    {source}
                                  </Badge>
                                ))}
                                {vulnerability.layerDigest || vulnerability.layerId ? (
                                  <Badge variant="outline" className="text-[10px]">layer-mapped</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px]">layer-unmapped</Badge>
                                )}
                              </div>
                            </button>
                          )
                        }) : (
                          <p className="p-3 text-xs text-muted-foreground">
                            No vulnerabilities match current filters. Try widening severity/scanner filters or clearing search.
                          </p>
                        )}
                      </div>

                      <div className="h-full overflow-auto rounded border p-3 text-xs bg-background">
                        {selectedVulnerability ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <code className="font-mono break-all">{selectedVulnerability.id}</code>
                              <Badge className="text-[10px]" variant={selectedVulnerability.severity === 'critical' || selectedVulnerability.severity === 'high' ? 'destructive' : 'outline'}>
                                {selectedVulnerability.severity}
                              </Badge>
                            </div>
                            <p><span className="text-muted-foreground">Package:</span> {selectedVulnerability.packageName}</p>
                            <p><span className="text-muted-foreground">Current:</span> {selectedVulnerability.currentVersion}</p>
                            <p><span className="text-muted-foreground">Fix:</span> {selectedVulnerability.fixedVersion ?? 'No fix available'}</p>
                            <p><span className="text-muted-foreground">Layer digest:</span> {selectedVulnerability.layerDigest ?? selectedVulnerability.layerId ?? 'Not provided by scanner'}</p>
                            <p className="text-muted-foreground">{selectedVulnerability.description}</p>
                            {(selectedVulnerability.scannerSources ?? []).length > 0 ? (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {(selectedVulnerability.scannerSources ?? []).map((source) => (
                                  <Badge key={`${selectedVulnerability.id}-${source}`} variant="secondary" className="text-[10px] uppercase tracking-wide">
                                    {source}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">Select a finding to view details.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              />

              {imageInspectQuery.error ? (
                <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  Failed to refresh image detail: {imageInspectQuery.error instanceof Error ? imageInspectQuery.error.message : String(imageInspectQuery.error)}
                </div>
              ) : null}

              {imageScanStreamQuery.error ? (
                <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  Scan stream error: {imageScanStreamQuery.error instanceof Error ? imageScanStreamQuery.error.message : String(imageScanStreamQuery.error)}
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="labels" className="flex min-h-0 flex-col gap-2 text-sm">
              {Object.entries(detail.labels).length > 0 ? Object.entries(detail.labels).map(([key, value]) => (
                <div key={key} className="rounded border p-3 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{key}</span>
                  <code className="text-xs font-mono break-all">{value}</code>
                </div>
              )) : <p className="text-muted-foreground">No labels on this image.</p>}
            </TabsContent>
          </Tabs>
        ) : isDetailLoading ? (
          <DockerDetailLoadingState label="Loading image details…" />
        ) : (
          <p className="text-sm text-muted-foreground">Image not found.</p>
        )}
        <DialogFooter className="pt-2">
          <Button className="h-8" type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DockerImageDetailModal({ id, open, onOpenChange, onRunImage, initialTab = 'overview' }: DockerImageDetailModalProps) {
  return (
    <DockerImageDetailContent
      id={id}
      open={open}
      onOpenChange={onOpenChange}
      onRunImage={onRunImage}
      initialTab={initialTab}
    />
  )
}

export function DockerImageDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerImageDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className ?? 'underline-offset-4 hover:underline text-left'} onClick={() => setOpen(true)}>
        {children}
      </button>
      <DockerImageDetailContent id={id} open={open} onOpenChange={setOpen} initialTab={initialTab} />
    </>
  )
}