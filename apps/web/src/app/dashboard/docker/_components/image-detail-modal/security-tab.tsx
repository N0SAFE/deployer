'use client'

import { useMemo, useState } from 'react'
import { isDefinedORPCError, getErrorMessage } from '@/lib/orpc/typed-errors'
import type { DockerPullTimelineRow } from '../docker-image-pull-progress-panel'
import { DockerImagePullProgressPanel } from '../docker-image-pull-progress-panel'
import { DockerImageSecurityFlow, type DockerImageSecurityFlowStage } from '../docker-image-security-flow'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Loader2, RefreshCw } from 'lucide-react'
import { SecurityLogsPane } from './security-logs-pane'
import { SecurityResultsPane } from './security-results-pane'
import { buildPullingLayers, buildPullingScannerRows } from './pull-layer-model'
import { toClock } from './scan-model'
import type { ImageScanSession } from './use-image-scan-session'
import { useOnDepsChange } from '../../_hooks/use-on-deps-change'

interface SecurityTabProps {
  imageRef: string
  session: ImageScanSession
  inspectError: unknown
  onRescan: () => void
}

type PullStatus = 'idle' | 'queued' | 'pulling' | 'complete' | 'error'

function errorText(error: unknown): string {
  return isDefinedORPCError(error) ? getErrorMessage(error) : String(error)
}

/** Security tab: severity strip + the pulling / logs / results flow. */
export function SecurityTab({ imageRef, session, inspectError, onRescan }: SecurityTabProps) {
  const [stage, setStage] = useState<DockerImageSecurityFlowStage>('pulling')
  const { effectiveScanEvents: events, hasCompletedScan, severityCounts, streamStatus } = session

  const streamLogEvents = useMemo(() => events.filter((event) => event.type === 'log').slice(-160), [events])
  const scannerExecutionLogCount = useMemo(
    () => streamLogEvents.filter((event) => event.stage !== 'pulling-scanner').length,
    [streamLogEvents],
  )

  const pullingActivityEvents = useMemo(
    () => events
      .filter((event) => event.stage === 'pulling-scanner' && (event.type === 'status' || event.type === 'log' || event.type === 'error'))
      .slice(-220),
    [events],
  )
  const scannerRows = useMemo(() => buildPullingScannerRows(events, hasCompletedScan), [events, hasCompletedScan])
  const pullingLayers = useMemo(() => buildPullingLayers(pullingActivityEvents, scannerRows), [pullingActivityEvents, scannerRows])
  const timelineRows = useMemo<DockerPullTimelineRow[]>(() => pullingActivityEvents.map((event) => ({
    at: event.timestamp,
    type: `${event.scanner ?? 'pipeline'}:${event.type}`,
    message: event.logLine ?? (event.type === 'log' ? event.payload.line : event.message),
  })), [pullingActivityEvents])

  const pullErrorMessage = useMemo(() => {
    const statusEvents = events.filter((event) => event.type !== 'log').slice(-80)
    for (let index = statusEvents.length - 1; index >= 0; index -= 1) {
      const event = statusEvents[index]
      if (event?.type === 'error' || event?.stage === 'error') return event.message
    }
    return null
  }, [events])

  const hasLiveActivity = useMemo(() => events.some((event) => (
    event.type === 'log'
    || event.stage === 'pulling-scanner' || event.stage === 'scanning' || event.stage === 'parsing' || event.stage === 'merging'
  )), [events])

  const pullStatus: PullStatus = pullErrorMessage
    ? 'error'
    : hasCompletedScan || scannerRows.every((row) => row.status === 'done')
      ? 'complete'
      : hasLiveActivity ? 'pulling' : 'queued'

  const pullProgress = pullStatus === 'complete'
    ? 100
    : pullStatus === 'queued' || scannerRows.length === 0
      ? 0
      : Math.round(scannerRows.reduce((sum, row) => sum + row.progress, 0) / scannerRows.length)

  // Follow the scan: pulling -> logs -> results, as evidence arrives.
  useOnDepsChange([hasCompletedScan, scannerExecutionLogCount], () => {
    if (hasCompletedScan) setStage('results')
    else if (scannerExecutionLogCount > 0) setStage('logs')
    else setStage('pulling')
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="text-xs" variant={severityCounts.critical > 0 ? 'destructive' : 'outline'}>critical: {severityCounts.critical}</Badge>
          <Badge className="text-xs" variant={severityCounts.high > 0 ? 'destructive' : 'outline'}>high: {severityCounts.high}</Badge>
          <Badge className="text-xs" variant="outline">medium: {severityCounts.medium}</Badge>
          <Badge className="text-xs" variant="outline">low: {severityCounts.low}</Badge>
          <Badge className="text-xs" variant={streamStatus === 'error' ? 'destructive' : streamStatus === 'streaming' ? 'default' : 'outline'}>
            live updates: {streamStatus}
          </Badge>
        </div>
        {hasCompletedScan ? (
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={onRescan}>
            {streamStatus === 'streaming' ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw aria-hidden className="h-3.5 w-3.5" />}
            Rescan
          </Button>
        ) : (
          <Badge className="text-xs" variant="secondary">Waiting for the first scan to finish</Badge>
        )}
      </div>

      <DockerImageSecurityFlow
        activeStage={stage}
        onStageChange={setStage}
        pullStatus={pullStatus === 'queued' ? 'idle' : pullStatus}
        logsCount={streamLogEvents.length}
        resultsCount={session.vulnerabilities.length}
        pullingContent={(
          <div className="flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden!">
            {pullStatus === 'queued' ? (
              <div role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                The scan is queued on the server. This view switches to live logs and results as soon as scanning starts.
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <DockerImagePullProgressPanel
                image={imageRef}
                pullStatus={pullStatus}
                pullProgress={pullProgress}
                pullErrorMessage={pullErrorMessage}
                pullRuntimeEventCount={timelineRows.length}
                pullLayers={pullingLayers}
                pullTimelineRows={timelineRows}
                toClock={toClock}
              />
            </div>
          </div>
        )}
        logsContent={<SecurityLogsPane events={events} streamStatus={streamStatus} hasCompletedScan={hasCompletedScan} />}
        resultsContent={(
          <SecurityResultsPane
            vulnerabilities={session.vulnerabilities}
            scannerSummaries={session.scannerSummaries}
            layerEfficiency={session.effectiveScanSummary?.layerEfficiency}
          />
        )}
      />

      {inspectError ? (
        <div role="alert" className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Could not refresh image details: {errorText(inspectError)}
        </div>
      ) : null}
      {session.streamError ? (
        <div role="alert" className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Scan updates stopped: {errorText(session.streamError)}
        </div>
      ) : null}
    </div>
  )
}
