import type { DockerPullLayerRow, DockerPullTimelineRow } from '../docker-image-pull-progress-panel'
import type { DockerScannerPullRow } from '../docker-scan-stack-panel'

/** Pure helpers and row types for the pull and scan stages of the create-container dialog. */

export type PullStatus = 'idle' | 'pulling' | 'complete' | 'error'
export type ScanStatus = 'idle' | 'scanning' | 'complete' | 'error'
export type Stage = 'image' | 'pulling' | 'scan' | 'container'

export interface ScanFindingRow {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: string
  packageName: string
  packageType: string
  currentVersion: string
  fixedVersion: string | null
}

export interface ScanSourceLogRow { at: string; message: string }

export interface ScanSourceStreamRow {
  source: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  findingsCount: number
  startedAt: string
  visibleLogs: ScanSourceLogRow[]
}

export interface PullRuntimeEventRow { timestamp: string; action: string; message: string }

export interface ScanTimelineEventRow {
  timestamp: string
  type: 'status' | 'log' | 'result' | 'complete' | 'error'
  stage: 'queued' | 'pulling-scanner' | 'scanning' | 'parsing' | 'merging' | 'completed' | 'error'
  scanner: 'trivy' | 'grype' | 'dive' | null
  message: string
  progress: number | null
}

export interface PulledLayer { id: string; instruction: string; size: string; createdAt: string }

export const SCAN_STAGE_ORDER: ScanTimelineEventRow['stage'][] = ['queued', 'pulling-scanner', 'scanning', 'parsing', 'merging', 'completed', 'error']
export const SCANNER_ORDER: Exclude<ScanTimelineEventRow['scanner'], null>[] = ['trivy', 'grype', 'dive']

export function nowIso(): string {
  return new Date().toISOString()
}

export function toClock(iso: string): string {
  return iso.length < 19 ? iso : iso.slice(11, 19)
}

export function titleCaseStage(stage: string): string {
  if (stage === 'pulling-scanner') return 'Pulling scanner'
  return stage.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase()
  const c = candidate.toLowerCase()
  if (!q) return 0
  if (c === q) return 1000
  if (c.startsWith(q)) return 750 - (c.length - q.length)
  const includesAt = c.indexOf(q)
  if (includesAt >= 0) return 600 - includesAt * 2

  let qi = 0
  let hits = 0
  for (let i = 0; i < c.length && qi < q.length; i += 1) {
    if (c[i] === q[qi]) {
      qi += 1
      hits += 1
    }
  }
  return hits === q.length ? 320 - (c.length - q.length) : -1
}

export function buildPullLayers(
  pulled: PulledLayer[],
  fallback: PulledLayer | null,
  pullStatus: PullStatus,
  pullProgress: number,
): DockerPullLayerRow[] {
  const layers = pulled.length > 0 ? pulled : fallback ? [fallback] : []
  const layerCount = Math.max(1, layers.length)

  return layers.map((layer, index) => {
    const threshold = ((index + 1) / layerCount) * 100
    let status: DockerPullLayerRow['status'] = 'waiting'
    let progress = 0
    if (pullStatus === 'complete') {
      status = 'done'
      progress = 100
    } else if (pullStatus === 'pulling') {
      if (pullProgress >= threshold + 6) {
        status = 'done'
        progress = 100
      } else if (pullProgress >= threshold - 6) {
        status = 'extracting'
        progress = Math.min(99, Math.max(12, Math.round((pullProgress / threshold) * 100)))
      } else if (pullProgress >= threshold - 18) {
        status = 'downloading'
        progress = Math.min(86, Math.max(8, Math.round((pullProgress / threshold) * 74)))
      }
    }
    return { id: layer.id, digest: layer.id, instruction: layer.instruction, size: layer.size, status, progress }
  })
}

export function buildPullTimelineRows(
  runtimeEvents: PullRuntimeEventRow[],
  localLogs: { at: string; message: string }[],
): DockerPullTimelineRow[] {
  const fromRuntime = runtimeEvents.map((event) => ({ at: event.timestamp, type: event.action, message: event.message }))
  const fromLocal = localLogs.map((event) => ({ at: event.at, type: 'local', message: event.message }))
  return [...fromRuntime, ...fromLocal].sort((a, b) => a.at.localeCompare(b.at)).slice(-160)
}

export function buildScanStageSummaryRows(events: ScanTimelineEventRow[]) {
  return SCAN_STAGE_ORDER.map((stage) => {
    const stageEvents = events.filter((event) => event.stage === stage)
    const first = stageEvents.at(0) ?? null
    const last = stageEvents.at(-1) ?? null
    const maxProgress = stageEvents.reduce((max, event) => Math.max(max, event.progress ?? 0), 0)

    let status: 'pending' | 'active' | 'complete' | 'failed' = 'pending'
    if (stage === 'error' && stageEvents.length > 0) status = 'failed'
    else if (stageEvents.length > 0) status = stage === 'completed' || last?.type === 'complete' ? 'complete' : 'active'

    return { stage, status, first, last, maxProgress }
  })
}

export function buildScannerPullRows(events: ScanTimelineEventRow[]): DockerScannerPullRow[] {
  return SCANNER_ORDER.map((scanner) => {
    const all = events.filter((event) => event.scanner === scanner)
    const pullEvents = all.filter((event) => event.stage === 'pulling-scanner')
    const progress = pullEvents.reduce((max, event) => Math.max(max, event.progress ?? 0), 0)
    const latestPull = pullEvents.at(-1) ?? null
    const advanced = all.some((event) => event.stage !== 'pulling-scanner')
    const failed = all.some((event) => event.type === 'error')

    const status: DockerScannerPullRow['status'] = failed ? 'failed' : advanced ? 'completed' : pullEvents.length > 0 ? 'running' : 'queued'
    return { scanner, status, progress, latestPull: latestPull ? { message: latestPull.message } : null }
  })
}

export function buildScanSourceStreams(
  live: Record<string, ScanSourceStreamRow>,
  ctx: { hasImageId: boolean; scanStatus: ScanStatus; scanProgress: number; findingsCount: number; scanErrorMessage: string | null },
): ScanSourceStreamRow[] {
  const streams = Object.values(live)
  if (streams.length > 0) return streams

  const status: ScanSourceStreamRow['status'] =
    ctx.scanStatus === 'error' ? 'failed' : ctx.scanStatus === 'complete' ? 'completed' : ctx.scanStatus === 'scanning' ? 'running' : 'queued'
  const at = nowIso()
  return [{
    source: ctx.hasImageId ? 'engine' : 'runtime',
    status,
    progress: ctx.scanProgress,
    findingsCount: ctx.findingsCount,
    startedAt: at,
    visibleLogs: ctx.scanErrorMessage ? [{ at, message: ctx.scanErrorMessage }] : [],
  }]
}

export function buildStageBadge(args: { pullStatus: PullStatus; scanStatus: ScanStatus; hasCriticalOrHigh: boolean; pullScanOnly: boolean }): string {
  const { pullStatus, scanStatus, hasCriticalOrHigh, pullScanOnly } = args
  if (pullStatus === 'pulling') return 'Pulling the image…'
  if (scanStatus === 'scanning') return 'Scanning the image…'
  if (pullStatus === 'error') return 'Pull failed'
  if (scanStatus === 'error') return 'Scan failed'
  if (scanStatus === 'complete' && hasCriticalOrHigh) return 'Security attention required'
  if (scanStatus === 'complete' && pullScanOnly) return 'Pull & scan complete'
  if (scanStatus === 'complete') return 'Scan complete'
  if (pullStatus === 'complete') return 'Image ready'
  return 'Not started'
}
