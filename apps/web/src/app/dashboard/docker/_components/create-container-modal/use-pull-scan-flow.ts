import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'
import { mergeByKey } from '../../_utils/scan-events'
import { dockerImageInspectDetailSchema } from '@deployer/contracts-entities'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useDockerImageEventsStream, useDockerImageInspect, useDockerImageSecurityScanStream } from '@/domains/docker/hooks'
import {
  buildPullLayers, buildPullTimelineRows, buildScanSourceStreams, buildScanStageSummaryRows, buildScannerPullRows, buildStageBadge, nowIso,
  type PullRuntimeEventRow, type PullStatus, type PulledLayer, type ScanFindingRow, type ScanSourceLogRow, type ScanSourceStreamRow,
  type ScanStatus, type ScanTimelineEventRow, type Stage,
} from './pull-scan.model'
import type { useImageCatalog } from './use-image-catalog'

const ZERO_VULNS = { critical: 0, high: 0, medium: 0, low: 0 }

const SEEN_KEY_LIMIT = 2000
const runtimeEventKey = (event: PullRuntimeEventRow): string => `${event.timestamp}|${event.action}|${event.message}`
const timelineEventKey = (event: ScanTimelineEventRow): string =>
  [event.timestamp, event.type, event.stage, event.scanner ?? 'pipeline', event.message, event.progress ?? 'na'].join('|')

interface Options {
  open: boolean
  image: string
  selectedImageEntity: ReturnType<typeof useImageCatalog>['selectedImageEntity']
  prefilledImage?: string
  autoPull: boolean
  skipPullTab: boolean
  pullScanOnly: boolean
}

/** Pull + vulnerability-scan pipeline that runs before a container is configured. */
export function usePullScanFlow({ open, image, selectedImageEntity, prefilledImage, autoPull, skipPullTab, pullScanOnly }: Options) {
  const [activeStage, setActiveStage] = useState<Stage>(skipPullTab ? 'container' : 'image')
  const [pullStatus, setPullStatus] = useState<PullStatus>('idle')
  const [pullProgress, setPullProgress] = useState(0)
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [scanProgress, setScanProgress] = useState(0)
  const [scanVulns, setScanVulns] = useState(ZERO_VULNS)
  const [pullErrorMessage, setPullErrorMessage] = useState<string | null>(null)
  const [scanErrorMessage, setScanErrorMessage] = useState<string | null>(null)
  const [pullLogs, setPullLogs] = useState<{ at: string; message: string }[]>([])
  const [pullRuntimeEvents, setPullRuntimeEvents] = useState<PullRuntimeEventRow[]>([])
  const [pulledLayers, setPulledLayers] = useState<PulledLayer[]>([])
  const [liveScanFindings, setLiveScanFindings] = useState<ScanFindingRow[]>([])
  const [liveScanSources, setLiveScanSources] = useState<Record<string, ScanSourceStreamRow>>({})
  const [scanTimelineEvents, setScanTimelineEvents] = useState<ScanTimelineEventRow[]>([])
  const [seenScanKeys, setSeenScanKeys] = useState<readonly string[]>([])
  const [pullRun, setPullRun] = useState(0)

  const showContainerStage = !pullScanOnly
  const hasCriticalOrHigh = scanVulns.critical > 0 || scanVulns.high > 0
  const isRunning = pullStatus === 'pulling' || scanStatus === 'scanning'
  const canOpenScan = pullStatus === 'complete' || skipPullTab
  const canOpenContainer = showContainerStage && (skipPullTab || pullStatus === 'complete')
  const imageId = selectedImageEntity?.id

  const imageInspectQuery = useDockerImageInspect({ query: { imageId: imageId ?? '' } }, { enabled: false })

  const appendPullLog = useCallback((message: string): void => {
    setPullLogs((previous) => [...previous, { at: nowIso(), message }].slice(-200))
  }, [])

  const appendPullRuntimeEvent = useCallback((action: string, message: string, timestamp = nowIso()): void => {
    const next: PullRuntimeEventRow = { timestamp, action, message }
    if (pullRuntimeEvents.some((existing) => runtimeEventKey(existing) === runtimeEventKey(next))) return
    setPullRuntimeEvents((previous) => mergeByKey(previous, [next], 240, runtimeEventKey))
    appendPullLog(`[${action}] ${message}`)
  }, [appendPullLog, pullRuntimeEvents])

  const appendScanTimelineEvent = useCallback((event: ScanTimelineEventRow): void => {
    setScanTimelineEvents((previous) => mergeByKey(previous, [event], 300, timelineEventKey))
  }, [])

  useOnDepsChange([open, prefilledImage, skipPullTab], () => {
    if (!open) return
    setActiveStage(skipPullTab ? 'container' : 'image')
    setPullStatus(skipPullTab ? 'complete' : 'idle')
    setPullProgress(skipPullTab ? 100 : 0)
    setScanStatus('idle')
    setScanProgress(0)
    setScanVulns(ZERO_VULNS)
    setPullErrorMessage(null)
    setScanErrorMessage(null)
    setPullLogs([])
    setPullRuntimeEvents([])
    setPulledLayers([])
    setLiveScanFindings([])
    setLiveScanSources({})
    setScanTimelineEvents([])
    setSeenScanKeys([])
  })

  const failPull = useCallback((message: string): void => {
    setPullStatus('error')
    setPullProgress(0)
    setPullErrorMessage(message)
    appendPullLog(message)
  }, [appendPullLog])

  const startScan = useCallback((force = false): void => {
    if (!force && !canOpenScan) return
    if (scanStatus === 'scanning') return
    if (!imageId) {
      setScanStatus('error')
      setScanProgress(0)
      setScanErrorMessage('Image is not available in runtime catalog. Pull or discover the image first.')
      return
    }
    setScanErrorMessage(null)
    setScanStatus('scanning')
    setScanProgress(1)
    setScanVulns(ZERO_VULNS)
    setLiveScanFindings([])
    setLiveScanSources({})
    setScanTimelineEvents([])
    setSeenScanKeys([])
    appendScanTimelineEvent({ timestamp: nowIso(), type: 'status', stage: 'queued', scanner: null, message: 'Scan queued and waiting for scanner initialization.', progress: 1 })
  }, [appendScanTimelineEvent, canOpenScan, imageId, scanStatus])

  /** Synchronous half of a pull: resets the view and queues the inspect step. */
  const startPull = useCallback((): void => {
    if (!image.trim() || pullStatus === 'pulling') return

    setActiveStage('pulling')
    setPullStatus('pulling')
    setPullProgress(10)
    setPullErrorMessage(null)
    setPullLogs([])
    setPullRuntimeEvents([])
    setPulledLayers([])
    appendPullLog(`Resolving image ${image.trim()} from runtime catalog…`)

    if (!imageId) {
      failPull('Image is not available in the local runtime catalog yet. Pull API wiring is not available from this modal.')
      return
    }
    setPullProgress(35)
    setPullRun((previous) => previous + 1)
  }, [appendPullLog, failPull, image, imageId, pullStatus])

  /** Asynchronous half: reads the image's layers from the engine, then starts the scan. */
  const resolvePull = async (): Promise<void> => {
    try {
      const inspectResult = await imageInspectQuery.refetch()
      const parsed = dockerImageInspectDetailSchema.safeParse(inspectResult.data)
      if (inspectResult.error || !parsed.success) {
        const fallback = 'Unable to inspect image metadata for pull stage.'
        failPull(isDefinedORPCError(inspectResult.error) ? getErrorMessage(inspectResult.error, fallback) : fallback)
        return
      }
      setPulledLayers(parsed.data.layers)
      setPullProgress(100)
      setPullStatus('complete')
      appendPullLog(`Image resolved: ${parsed.data.imageId}`)
      appendPullLog(`Loaded ${String(parsed.data.layers.length)} layer records from runtime inspect.`)
      setActiveStage('scan')
      startScan(true)
    } catch (error) {
      failPull(isDefinedORPCError(error) ? getErrorMessage(error) : 'Unexpected error during pull preparation.')
    }
  }
  const resolvePullRef = useRef(resolvePull)
  useEffect(() => {
    resolvePullRef.current = resolvePull
  })
  useEffect(() => {
    if (pullRun > 0) void resolvePullRef.current()
  }, [pullRun])

  useOnDepsChange([autoPull, open, prefilledImage, pullStatus, skipPullTab], () => {
    if (!open || !autoPull || skipPullTab || !prefilledImage || pullStatus !== 'idle') return
    startPull()
  })

  const imageRuntimeEventsQuery = useDockerImageEventsStream(
    { query: { actions: ['pull', 'create', 'import', 'load', 'tag'] } },
    { enabled: open && pullStatus === 'pulling' },
  )
  const liveScanQuery = useDockerImageSecurityScanStream(
    { query: { imageId: imageId ?? '', refreshIntervalMs: 500 } },
    { enabled: open && scanStatus === 'scanning' && Boolean(imageId) },
  )

  useOnDepsChange([image, imageId, imageRuntimeEventsQuery.event, open, pullStatus, selectedImageEntity?.registry, selectedImageEntity?.repository], () => {
    const runtimeEvent = imageRuntimeEventsQuery.event
    if (!open || pullStatus !== 'pulling' || !runtimeEvent) return

    const repositoryBase = `${selectedImageEntity?.registry ?? ''}/${selectedImageEntity?.repository ?? ''}`.toLowerCase().replace(/^\//u, '')
    const currentRef = image.trim().toLowerCase()
    const payloadImageName = (runtimeEvent.payload.imageName ?? '').toLowerCase()
    const payloadRepo = (runtimeEvent.payload.repository ?? '').toLowerCase()
    const imageNameMatch = payloadImageName.length > 0 && (currentRef.includes(payloadImageName) || payloadImageName.includes(currentRef))
    const repoMatch = payloadRepo.length > 0 && repositoryBase.length > 0 && payloadRepo === repositoryBase
    const actorMatch = runtimeEvent.actorId !== null && imageId?.startsWith(runtimeEvent.actorId) === true
    if (!imageNameMatch && !repoMatch && !actorMatch) return

    appendPullRuntimeEvent(runtimeEvent.action, runtimeEvent.payload.imageName ?? runtimeEvent.payload.repository ?? runtimeEvent.from ?? 'image runtime event', runtimeEvent.timestamp)

    const floor = runtimeEvent.action === 'pull' ? 56
      : runtimeEvent.action === 'create' || runtimeEvent.action === 'import' || runtimeEvent.action === 'load' ? 76
        : runtimeEvent.action === 'tag' ? 92 : 0
    if (floor > 0) setPullProgress((previous) => Math.max(previous, floor))
  })

  useOnDepsChange([imageId, liveScanQuery.events, scanStatus, showContainerStage], () => {
    if (scanStatus !== 'scanning' || !imageId) return
    const known = new Set(seenScanKeys)
    for (const event of liveScanQuery.events) {
      const eventKey = [event.timestamp, event.type, event.stage, event.scanner ?? 'engine', event.message, event.logLine ?? ''].join('|')
      if (known.has(eventKey)) continue
      known.add(eventKey)
      setSeenScanKeys((previous) => [...previous, eventKey].slice(-SEEN_KEY_LIMIT))

      const message = event.logLine ?? event.message
      if (typeof event.progress === 'number') setScanProgress((previous) => Math.max(previous, event.progress ?? 0))
      appendScanTimelineEvent({ timestamp: event.timestamp, type: event.type, stage: event.stage, scanner: event.scanner, message, progress: event.progress })

      const source = event.scanner ?? 'engine'
      setLiveScanSources((previous) => {
        const existing = previous[source] ?? { source, status: 'queued' as const, progress: 0, findingsCount: 0, startedAt: event.timestamp, visibleLogs: [] as ScanSourceLogRow[] }
        const status: ScanSourceStreamRow['status'] = event.type === 'error' ? 'failed' : event.type === 'result' || event.type === 'complete' ? 'completed' : 'running'
        return {
          ...previous,
          [source]: {
            ...existing,
            status,
            progress: Math.max(existing.progress, event.progress ?? 0),
            findingsCount: event.scannerResult?.findingsCount ?? existing.findingsCount,
            visibleLogs: message ? [...existing.visibleLogs, { at: event.timestamp, message }].slice(-80) : existing.visibleLogs,
          },
        }
      })

      if (Array.isArray(event.vulnerabilities)) {
        const summary = { ...ZERO_VULNS }
        for (const vulnerability of event.vulnerabilities) summary[vulnerability.severity] += 1
        setScanVulns(summary)
        setLiveScanFindings(event.vulnerabilities.map((finding) => ({
          id: finding.id,
          severity: finding.severity,
          source: finding.scannerSources?.join(', ') ?? event.scanner ?? 'scanner',
          packageName: finding.packageName,
          packageType: 'package',
          currentVersion: finding.currentVersion,
          fixedVersion: finding.fixedVersion,
        })))
      }

      if (event.type === 'error') {
        setScanStatus('error')
        setScanErrorMessage(message)
        appendPullLog(`[scan-error] ${message}`)
        return
      }
      if (event.type === 'complete') {
        setScanStatus('complete')
        setScanProgress(100)
        appendPullLog('Scan stream completed and findings synchronized.')
        if (showContainerStage) setActiveStage('container')
      }
    }
  })

  useOnDepsChange([imageId, liveScanQuery.error, liveScanQuery.isError, scanStatus], () => {
    if (scanStatus !== 'scanning' || !imageId || !liveScanQuery.isError) return
    const fallback = 'Security scan stream failed before completion.'
    setScanStatus('error')
    setScanErrorMessage(isDefinedORPCError(liveScanQuery.error) ? getErrorMessage(liveScanQuery.error, fallback) : fallback)
  })

  const pullLayers = useMemo(() => buildPullLayers(
    pulledLayers,
    selectedImageEntity
      ? { id: selectedImageEntity.id, instruction: 'Resolve image metadata', size: selectedImageEntity.sizeBytes === null ? '—' : `${String(selectedImageEntity.sizeBytes)} B`, createdAt: selectedImageEntity.createdAt }
      : null,
    pullStatus,
    pullProgress,
  ), [pullProgress, pullStatus, pulledLayers, selectedImageEntity])

  const scanSourceStreams = useMemo(() => buildScanSourceStreams(liveScanSources, {
    hasImageId: Boolean(imageId), scanStatus, scanProgress, findingsCount: liveScanFindings.length, scanErrorMessage,
  }), [imageId, liveScanFindings.length, liveScanSources, scanErrorMessage, scanProgress, scanStatus])

  const rawScanLines = useMemo(
    () => scanSourceStreams.flatMap((source) => source.visibleLogs.map((log) => `${log.at} [${source.source}] ${log.message}`)),
    [scanSourceStreams],
  )
  const pullTimelineRows = useMemo(() => buildPullTimelineRows(pullRuntimeEvents, pullLogs), [pullLogs, pullRuntimeEvents])
  const scanStageSummaryRows = useMemo(() => buildScanStageSummaryRows(scanTimelineEvents), [scanTimelineEvents])
  const scannerPullRows = useMemo(() => buildScannerPullRows(scanTimelineEvents), [scanTimelineEvents])
  const stageBadge = buildStageBadge({ pullStatus, scanStatus, hasCriticalOrHigh, pullScanOnly })

  return {
    activeStage, setActiveStage, pullStatus, pullProgress, pullErrorMessage, pullRuntimeEventCount: pullRuntimeEvents.length,
    scanStatus, scanProgress, scanVulns, scanErrorMessage, scanFindings: liveScanFindings,
    pullLayers, pullTimelineRows, scanStageSummaryRows, scannerPullRows, scanSourceStreams, rawScanLines,
    showContainerStage, hasCriticalOrHigh, isRunning, canOpenScan, canOpenContainer, stageBadge, startPull, startScan,
  }
}

export type PullScanFlow = ReturnType<typeof usePullScanFlow>
