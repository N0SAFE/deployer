'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'
import { mergeByKey } from '../../_utils/scan-events'
import { isDefinedORPCError, getErrorMessage } from '@/lib/orpc/typed-errors'
import { useDockerImageSecurityScanStream } from '@/domains/docker/hooks'
import type {
  DockerImageInspectDetail,
  DockerImageSecurityScanEvent,
  DockerVulnerabilityEntry,
} from '@repo/contracts-entities'
import {
  SECURITY_SCAN_EVENT_LIMIT,
  SECURITY_SCAN_SCANNERS,
  buildScanEventKey,
  createSyntheticScanEvent,
  summarizeSeverity,
} from './scan-model'

export type ScanStreamStatus = 'idle' | 'streaming' | 'error'

interface UseImageScanSessionParams {
  id: string
  open: boolean
  /** The stream is only opened while the Security tab is visible (or a rescan is forced). */
  securityTabActive: boolean
  inspectDetail: DockerImageInspectDetail | null
  refetchInspect: () => Promise<unknown>
  onNotice: (message: string | null) => void
}

/**
 * Owns the security-scan event session of one image: merges persisted inspect data
 * with the live stream, tracks whether a scan completed, and exposes `startScan`.
 * Kept out of the modal shell so the shell only deals with tabs and chrome.
 */
export function useImageScanSession({ id, open, securityTabActive, inspectDetail, refetchInspect, onNotice }: UseImageScanSessionParams) {
  const [scanEvents, setScanEvents] = useState<DockerImageSecurityScanEvent[]>([])
  const [forceStream, setForceStream] = useState(false)
  const [forceScan, setForceScan] = useState(false)
  const [sessionStartedAtMs, setSessionStartedAtMs] = useState<number | null>(null)
  const [terminalEvent, setTerminalEvent] = useState<{ kind: 'complete' | 'error'; message: string } | null>(null)

  const streamQuery = useDockerImageSecurityScanStream(
    { query: { imageId: id, refreshIntervalMs: 500, forceScan } },
    { enabled: open && (securityTabActive || forceStream) },
  )

  const streamEventsForActiveSession = useMemo(() => {
    if (sessionStartedAtMs === null) return streamQuery.events
    return streamQuery.events.filter((event) => {
      const timestamp = Date.parse(event.timestamp)
      return !Number.isFinite(timestamp) || timestamp >= sessionStartedAtMs - 1_000
    })
  }, [streamQuery.events, sessionStartedAtMs])

  const effectiveScanEvents = useMemo(() => {
    const combined = [...scanEvents, ...streamEventsForActiveSession]
    if (combined.length === 0) return combined
    const deduped = new Map<string, DockerImageSecurityScanEvent>()
    for (const event of combined) deduped.set(buildScanEventKey(event), event)
    const merged = Array.from(deduped.values())
    return merged.length <= SECURITY_SCAN_EVENT_LIMIT ? merged : merged.slice(merged.length - SECURITY_SCAN_EVENT_LIMIT)
  }, [scanEvents, streamEventsForActiveSession])

  const hasCompleteEvent = useMemo(
    () => effectiveScanEvents.some((event) => event.type === 'complete' || event.stage === 'completed'),
    [effectiveScanEvents],
  )
  const isScanSessionActive = sessionStartedAtMs !== null

  const vulnerabilitiesFromEvents = useMemo<DockerVulnerabilityEntry[] | null>(() => {
    for (let index = effectiveScanEvents.length - 1; index >= 0; index -= 1) {
      const event = effectiveScanEvents[index]
      if (event?.vulnerabilities) return event.vulnerabilities
    }
    return null
  }, [effectiveScanEvents])

  const vulnerabilities = useMemo<DockerVulnerabilityEntry[]>(() => {
    if (isScanSessionActive) return hasCompleteEvent ? (vulnerabilitiesFromEvents ?? []) : []
    return vulnerabilitiesFromEvents ?? inspectDetail?.vulnerabilities ?? []
  }, [hasCompleteEvent, inspectDetail?.vulnerabilities, isScanSessionActive, vulnerabilitiesFromEvents])

  const severityCounts = useMemo(() => summarizeSeverity(vulnerabilities), [vulnerabilities])
  const hasCriticalOrHigh = severityCounts.critical > 0 || severityCounts.high > 0

  const effectiveScanSummary = useMemo(() => {
    for (let index = effectiveScanEvents.length - 1; index >= 0; index -= 1) {
      const event = effectiveScanEvents[index]
      if (event?.scanSummary) return event.scanSummary
    }
    return isScanSessionActive ? null : (inspectDetail?.scanSummary ?? null)
  }, [effectiveScanEvents, inspectDetail?.scanSummary, isScanSessionActive])

  const hasCompletedScan = isScanSessionActive ? hasCompleteEvent : (effectiveScanSummary !== null || hasCompleteEvent)

  const scannerSummaries = useMemo(() => {
    if (effectiveScanSummary?.scanners && effectiveScanSummary.scanners.length > 0) return effectiveScanSummary.scanners

    const latestByScanner = new Map<'trivy' | 'grype' | 'dive', NonNullable<DockerImageSecurityScanEvent['scannerResult']>>()
    for (const event of effectiveScanEvents) {
      if (event.scannerResult) latestByScanner.set(event.scannerResult.scanner, event.scannerResult)
    }
    return SECURITY_SCAN_SCANNERS
      .map((scanner) => latestByScanner.get(scanner) ?? null)
      .filter((item): item is NonNullable<DockerImageSecurityScanEvent['scannerResult']> => item !== null)
  }, [effectiveScanEvents, effectiveScanSummary?.scanners])

  const streamStatus: ScanStreamStatus = streamQuery.isError
    ? 'error'
    : streamQuery.fetchStatus === 'fetching' || forceStream
      ? 'streaming'
      : 'idle'

  const resetEvents = useCallback((): void => { setScanEvents([]) }, [])

  const appendScanEvent = useCallback((event: DockerImageSecurityScanEvent): void => {
    setScanEvents((previous) => mergeByKey(previous, [event], SECURITY_SCAN_EVENT_LIMIT, buildScanEventKey))
  }, [])

  const startScan = useCallback((): void => {
    resetEvents()
    setSessionStartedAtMs(Date.now())
    setForceStream(true)
    setForceScan(true)

    appendScanEvent(createSyntheticScanEvent({ imageId: id, stage: 'queued', type: 'status', message: 'Rescan requested from UI.' }))

    void streamQuery.refetch().catch((error: unknown) => {
      const errorMessage = isDefinedORPCError(error) ? getErrorMessage(error) : String(error)
      appendScanEvent(createSyntheticScanEvent({
        imageId: id,
        stage: 'error',
        type: 'error',
        message: `Unable to start scan stream: ${errorMessage}`,
      }))
    })
  }, [appendScanEvent, id, resetEvents, streamQuery])

  // Drop the session whenever the dialog closes or switches to another image.
  useOnDepsChange([id, open], () => {
    resetEvents()
    setForceStream(false)
    setForceScan(false)
    setSessionStartedAtMs(null)
  }, false)

  // Fold stream events into the session and note its terminal event; the side
  // effects of a terminal event (notice, refetch) run in the effect below.
  useOnDepsChange([streamEventsForActiveSession], () => {
    const events = streamEventsForActiveSession
    if (events.length === 0) return

    for (const event of events) appendScanEvent(event)

    const latestEvent = events[events.length - 1]
    if (!latestEvent) return

    if (latestEvent.type === 'complete' || latestEvent.stage === 'completed') {
      setForceStream(false)
      setForceScan(false)
      setSessionStartedAtMs(null)
      setTerminalEvent({ kind: 'complete', message: 'Security scan completed with latest findings loaded.' })
    }

    if (latestEvent.type === 'error' || latestEvent.stage === 'error') {
      setForceStream(false)
      setForceScan(false)
      setSessionStartedAtMs(null)
      setTerminalEvent({ kind: 'error', message: latestEvent.message })
    }
  })

  const callbacksRef = useRef({ onNotice, refetchInspect })
  useEffect(() => {
    callbacksRef.current = { onNotice, refetchInspect }
  })
  useEffect(() => {
    if (!terminalEvent) return
    callbacksRef.current.onNotice(terminalEvent.message)
    if (terminalEvent.kind === 'complete') void callbacksRef.current.refetchInspect()
  }, [terminalEvent])

  return {
    effectiveScanEvents,
    vulnerabilities,
    severityCounts,
    hasCriticalOrHigh,
    effectiveScanSummary,
    hasCompletedScan,
    scannerSummaries,
    streamStatus,
    streamError: streamQuery.error,
    isStreamFetching: streamQuery.fetchStatus === 'fetching',
    forceStream,
    startScan,
  }
}

export type ImageScanSession = ReturnType<typeof useImageScanSession>
