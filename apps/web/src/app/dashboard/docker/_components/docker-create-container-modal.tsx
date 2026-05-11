'use client'

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useDockerImageEventsStream, useDockerImageInspect, useDockerImageList, useDockerImageSecurityScanStream, useDockerNetworkList } from '@/domains/docker/hooks'
import { dockerImageInspectDetailSchema } from '@repo/contracts-entities'
import { DockerImagePullProgressPanel } from './docker-image-pull-progress-panel'
import { DockerRuntimeStackOverview } from './docker-runtime-stack-overview'
import { DockerScanStackPanel } from './docker-scan-stack-panel'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { MultiSelect } from '@repo/ui/components/shadcn/multi-select'
import { ChevronDown, ChevronRight, Cpu, Download, HardDrive, HeartPulse, Loader2, Lock, Play, Plus, Search, Settings2, Shield, Trash2, Wifi } from 'lucide-react'

export interface DockerCreateContainerPayload {
  name: string
  image: string
  command: string
  restartPolicy: 'no' | 'always' | 'unless-stopped' | 'on-failure'
  restartMaxRetries: number | null
  networkMode: string
  selectedNetworks: string[]
  startAfterCreate: boolean
  repullImage: boolean
  containerUser: string
  privilegedMode: boolean
  readOnlyRootFs: boolean
  healthcheckEnabled: boolean
  healthcheckCommand: string
  healthcheckIntervalSec: number
  memoryLimitMb: number | null
  memoryReservationMb: number | null
  cpuShares: number | null
  cpuQuota: number | null
  cpuPeriod: number | null
  cpuLimit: number | null
  capAdd: string[]
  capDrop: string[]
  securityOptions: string[]
  dnsServers: string[]
  dnsSearch: string[]
  dnsOptions: string[]
  devices: Array<{ hostPath: string; containerPath: string; permissions: string }>
  ulimits: Array<{ name: string; soft: number; hard: number }>
  gpu: {
    enabled: boolean
    mode: 'all' | 'count' | 'specific'
    count: number
    deviceIds: string[]
    driver: string
    capabilities: string[]
    runtime: string
  }
  autoUpdate: {
    enabled: boolean
    cronExpression: string
    vulnerabilityCriteria: 'never' | 'critical' | 'high' | 'medium' | 'low' | 'any'
  }
  envVars: Array<{ key: string; value: string }>
  labels: Array<{ key: string; value: string }>
  ports: Array<{ hostPort: string; containerPort: string; protocol: 'tcp' | 'udp' }>
  volumes: Array<{ hostPath: string; containerPath: string; mode: 'rw' | 'ro' }>
  pullScanSummary: {
    pullStatus: 'idle' | 'pulling' | 'complete' | 'error'
    scanStatus: 'idle' | 'scanning' | 'complete' | 'error'
    vulnerabilities: { critical: number; high: number; medium: number; low: number }
  }
}

interface DockerCreateContainerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefilledImage?: string
  autoPull?: boolean
  skipPullTab?: boolean
  pullScanOnly?: boolean
  onCreated?: (payload: DockerCreateContainerPayload) => void
}

type Stage = 'image' | 'pulling' | 'scan' | 'container'

type VulnerabilityCriteria = 'never' | 'critical' | 'high' | 'medium' | 'low' | 'any'

interface ScanFindingRow {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: string
  packageName: string
  packageType: string
  currentVersion: string
  fixedVersion: string | null
}

interface ScanSourceLogRow {
  at: string
  message: string
}

interface ScanSourceStreamRow {
  source: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  findingsCount: number
  startedAt: string
  visibleLogs: ScanSourceLogRow[]
}

interface PullRuntimeEventRow {
  timestamp: string
  action: string
  message: string
}

interface ScanTimelineEventRow {
  timestamp: string
  type: 'status' | 'log' | 'result' | 'complete' | 'error'
  stage: 'queued' | 'pulling-scanner' | 'scanning' | 'parsing' | 'merging' | 'completed' | 'error'
  scanner: 'trivy' | 'grype' | 'dive' | null
  message: string
  progress: number | null
}

interface ConfigSet {
  id: number
  name: string
  description?: string
  envVars?: Array<{ key: string; value: string }>
  labels?: Array<{ key: string; value: string }>
  ports?: Array<{ hostPort: string; containerPort: string; protocol: 'tcp' | 'udp' }>
  volumes?: Array<{ hostPath: string; containerPath: string; mode: 'rw' | 'ro' }>
  networkMode?: string
  restartPolicy?: 'no' | 'always' | 'unless-stopped' | 'on-failure'
}

const LIST_INPUT = { query: { limit: 200, offset: 0 } } as const
const SCAN_STAGE_ORDER: Array<ScanTimelineEventRow['stage']> = [
  'queued',
  'pulling-scanner',
  'scanning',
  'parsing',
  'merging',
  'completed',
  'error',
]

const SCANNER_ORDER: Array<Exclude<ScanTimelineEventRow['scanner'], null>> = ['trivy', 'grype', 'dive']

const COMMON_CAPABILITIES = ['SYS_ADMIN', 'SYS_PTRACE', 'NET_ADMIN', 'NET_RAW', 'SYS_TIME', 'CHOWN', 'SETUID', 'SETGID'] as const
const COMMON_ULIMITS = ['nofile', 'nproc', 'core', 'stack', 'memlock'] as const
const COMMON_GPU_CAPABILITIES = ['gpu', 'compute', 'utility', 'graphics', 'video', 'display'] as const
const CONFIG_PRESETS: ConfigSet[] = [
  {
    id: 1,
    name: 'Web service baseline',
    description: 'HTTP service with sane defaults',
    envVars: [{ key: 'NODE_ENV', value: 'production' }],
    ports: [{ hostPort: '8080', containerPort: '3000', protocol: 'tcp' }],
    restartPolicy: 'unless-stopped',
    networkMode: 'bridge',
  },
  {
    id: 2,
    name: 'Worker baseline',
    description: 'Background worker profile',
    envVars: [{ key: 'WORKER_CONCURRENCY', value: '4' }],
    restartPolicy: 'always',
    networkMode: 'bridge',
  },
]

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function fuzzyScore(query: string, candidate: string): number {
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
  if (hits === q.length) return 320 - (c.length - q.length)
  return -1
}

function nowIso(): string {
  return new Date().toISOString()
}

function toClock(iso: string): string {
  if (iso.length < 19) {
    return iso
  }

  return iso.slice(11, 19)
}

function titleCaseStage(stage: ScanTimelineEventRow['stage']): string {
  if (stage === 'pulling-scanner') {
    return 'Pulling scanner'
  }

  return stage.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function DockerCreateContainerModal({
  open,
  onOpenChange,
  prefilledImage,
  autoPull = false,
  skipPullTab = false,
  pullScanOnly = false,
  onCreated,
}: DockerCreateContainerModalProps) {
  const { data: networkData } = useDockerNetworkList(LIST_INPUT)
  const { data: imageData } = useDockerImageList(LIST_INPUT)
  const availableNetworks = networkData?.data ?? []
  const imageEntities = imageData?.data ?? []

  const [activeStage, setActiveStage] = useState<Stage>(skipPullTab ? 'container' : 'image')
  const [pullStatus, setPullStatus] = useState<'idle' | 'pulling' | 'complete' | 'error'>('idle')
  const [pullProgress, setPullProgress] = useState(0)
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'complete' | 'error'>('idle')
  const [scanProgress, setScanProgress] = useState(0)
  const [scanVulns, setScanVulns] = useState({ critical: 0, high: 0, medium: 0, low: 0 })
  const [pullErrorMessage, setPullErrorMessage] = useState<string | null>(null)
  const [scanErrorMessage, setScanErrorMessage] = useState<string | null>(null)
  const [pullLogs, setPullLogs] = useState<Array<{ at: string; message: string }>>([])
  const [pullRuntimeEvents, setPullRuntimeEvents] = useState<PullRuntimeEventRow[]>([])
  const [pulledImageLayers, setPulledImageLayers] = useState<Array<{ id: string; instruction: string; size: string; createdAt: string }>>([])
  const [liveScanFindings, setLiveScanFindings] = useState<ScanFindingRow[]>([])
  const [liveScanSources, setLiveScanSources] = useState<Record<string, ScanSourceStreamRow>>({})
  const [scanTimelineEvents, setScanTimelineEvents] = useState<ScanTimelineEventRow[]>([])

  const [name, setName] = useState('')
  const [image, setImage] = useState(prefilledImage ?? '')
  const [command, setCommand] = useState('')
  const [restartPolicy, setRestartPolicy] = useState<'no' | 'always' | 'unless-stopped' | 'on-failure'>('no')
  const [restartMaxRetries, setRestartMaxRetries] = useState<string>('')
  const [networkMode, setNetworkMode] = useState('bridge')
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [startAfterCreate, setStartAfterCreate] = useState(true)
  const [repullImage, setRepullImage] = useState(true)
  const [containerUser, setContainerUser] = useState('')

  const [ports, setPorts] = useState<Array<{ hostPort: string; containerPort: string; protocol: 'tcp' | 'udp' }>>([{ hostPort: '', containerPort: '', protocol: 'tcp' }])
  const [volumes, setVolumes] = useState<Array<{ hostPath: string; containerPath: string; mode: 'rw' | 'ro' }>>([{ hostPath: '', containerPath: '', mode: 'rw' }])
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
  const [labels, setLabels] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])

  const [showResources, setShowResources] = useState(false)
  const [showSecurity, setShowSecurity] = useState(false)
  const [showHealth, setShowHealth] = useState(false)
  const [showDns, setShowDns] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
  const [showGpu, setShowGpu] = useState(false)
  const [showUlimits, setShowUlimits] = useState(false)

  const [memoryLimitMb, setMemoryLimitMb] = useState('')
  const [memoryReservationMb, setMemoryReservationMb] = useState('')
  const [cpuLimit, setCpuLimit] = useState('')
  const [cpuShares, setCpuShares] = useState('')
  const [cpuQuota, setCpuQuota] = useState('')
  const [cpuPeriod, setCpuPeriod] = useState('')
  const [privilegedMode, setPrivilegedMode] = useState(false)
  const [readOnlyRootFs, setReadOnlyRootFs] = useState(false)
  const [capAdd, setCapAdd] = useState<string[]>([])
  const [capDrop, setCapDrop] = useState<string[]>([])
  const [securityOptions, setSecurityOptions] = useState<string[]>([])
  const [dnsServers, setDnsServers] = useState<string[]>([])
  const [dnsSearch, setDnsSearch] = useState<string[]>([])
  const [dnsOptions, setDnsOptions] = useState<string[]>([])
  const [devices, setDevices] = useState<Array<{ hostPath: string; containerPath: string; permissions: string }>>([])
  const [ulimits, setUlimits] = useState<Array<{ name: string; soft: string; hard: string }>>([])
  const [gpuEnabled, setGpuEnabled] = useState(false)
  const [gpuMode, setGpuMode] = useState<'all' | 'count' | 'specific'>('all')
  const [gpuCount, setGpuCount] = useState(1)
  const [gpuDeviceIds, setGpuDeviceIds] = useState<string[]>([])
  const [gpuDriver, setGpuDriver] = useState('')
  const [gpuCapabilities, setGpuCapabilities] = useState<string[]>(['gpu'])
  const [runtime, setRuntime] = useState('')
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false)
  const [autoUpdateCronExpression, setAutoUpdateCronExpression] = useState('0 3 * * *')
  const [vulnerabilityCriteria, setVulnerabilityCriteria] = useState<VulnerabilityCriteria>('never')
  const [selectedConfigSetId, setSelectedConfigSetId] = useState('')
  const [healthcheckEnabled, setHealthcheckEnabled] = useState(false)
  const [healthcheckCommand, setHealthcheckCommand] = useState('')
  const [healthcheckIntervalSec, setHealthcheckIntervalSec] = useState('30')

  const [submitting, setSubmitting] = useState(false)
  const seenLiveScanEventSetRef = useRef<Set<string>>(new Set())
  const seenLiveScanEventQueueRef = useRef<string[]>([])
  const seenPullRuntimeEventSetRef = useRef<Set<string>>(new Set())
  const seenPullRuntimeEventQueueRef = useRef<string[]>([])
  const seenScanTimelineEventSetRef = useRef<Set<string>>(new Set())
  const seenScanTimelineEventQueueRef = useRef<string[]>([])

  const scanEnabled = true
  const showContainerStage = !pullScanOnly
  const hasCriticalOrHigh = scanVulns.critical > 0 || scanVulns.high > 0
  const isBusy = submitting || pullStatus === 'pulling' || scanStatus === 'scanning'

  const canOpenScan = pullStatus === 'complete' || skipPullTab
  const canOpenContainer = showContainerStage && (skipPullTab || pullStatus === 'complete')

  const selectedImageEntity = useMemo(() => {
    const normalizedImage = image.trim().toLowerCase()
    if (!normalizedImage) {
      return null
    }

    return imageEntities.find((entity) => {
      const tag = entity.tag ?? 'latest'
      const fullRef = `${entity.registry}/${entity.repository}:${tag}`.toLowerCase()
      const repositoryRef = `${entity.registry}/${entity.repository}`.toLowerCase()

      return normalizedImage === fullRef || normalizedImage === repositoryRef
    }) ?? null
  }, [image, imageEntities])

  const imageInspectQuery = useDockerImageInspect(
    {
      query: {
        imageId: selectedImageEntity?.id ?? '',
      },
    },
    {
      enabled: false,
    },
  )

  function appendPullLog(message: string): void {
    setPullLogs((previous) => [...previous, { at: nowIso(), message }].slice(-200))
  }

  function appendPullRuntimeEvent(action: string, message: string, timestamp = nowIso()): void {
    const key = `${timestamp}|${action}|${message}`
    if (seenPullRuntimeEventSetRef.current.has(key)) {
      return
    }

    seenPullRuntimeEventSetRef.current.add(key)
    seenPullRuntimeEventQueueRef.current.push(key)

    if (seenPullRuntimeEventQueueRef.current.length > 2_000) {
      const dropped = seenPullRuntimeEventQueueRef.current.shift()
      if (dropped) {
        seenPullRuntimeEventSetRef.current.delete(dropped)
      }
    }

    setPullRuntimeEvents((previous) => [...previous, { timestamp, action, message }].slice(-240))
    appendPullLog(`[${action}] ${message}`)
  }

  function appendScanTimelineEvent(event: ScanTimelineEventRow): void {
    const key = [
      event.timestamp,
      event.type,
      event.stage,
      event.scanner ?? 'pipeline',
      event.message,
      event.progress ?? 'na',
    ].join('|')

    if (seenScanTimelineEventSetRef.current.has(key)) {
      return
    }

    seenScanTimelineEventSetRef.current.add(key)
    seenScanTimelineEventQueueRef.current.push(key)

    if (seenScanTimelineEventQueueRef.current.length > 2_000) {
      const dropped = seenScanTimelineEventQueueRef.current.shift()
      if (dropped) {
        seenScanTimelineEventSetRef.current.delete(dropped)
      }
    }

    setScanTimelineEvents((previous) => [...previous, event].slice(-300))
  }

  useEffect(() => {
    if (!open) return
    setActiveStage(skipPullTab ? 'container' : 'image')
    setPullStatus(skipPullTab ? 'complete' : 'idle')
    setPullProgress(skipPullTab ? 100 : 0)
    setScanStatus('idle')
    setScanProgress(0)
    setScanVulns({ critical: 0, high: 0, medium: 0, low: 0 })
    setPullErrorMessage(null)
    setScanErrorMessage(null)
    setPullLogs([])
    setPullRuntimeEvents([])
    setPulledImageLayers([])
    setLiveScanFindings([])
    setLiveScanSources({})
    setScanTimelineEvents([])
    seenLiveScanEventSetRef.current.clear()
    seenLiveScanEventQueueRef.current = []
    seenPullRuntimeEventSetRef.current.clear()
    seenPullRuntimeEventQueueRef.current = []
    seenScanTimelineEventSetRef.current.clear()
    seenScanTimelineEventQueueRef.current = []
    setImage(prefilledImage ?? '')
    setName(prefilledImage ? `${slugify(prefilledImage.split('/').at(-1) ?? 'container')}-run` : '')
    setCommand('')
    setRestartPolicy('no')
    setRestartMaxRetries('')
    setNetworkMode('bridge')
    setSelectedNetworks([])
    setStartAfterCreate(true)
    setRepullImage(true)
    setContainerUser('')
    setPorts([{ hostPort: '', containerPort: '', protocol: 'tcp' }])
    setVolumes([{ hostPath: '', containerPath: '', mode: 'rw' }])
    setEnvVars([{ key: '', value: '' }])
    setLabels([{ key: '', value: '' }])
    setShowResources(false)
    setShowSecurity(false)
    setShowHealth(false)
    setShowDns(false)
    setShowDevices(false)
    setShowGpu(false)
    setShowUlimits(false)
    setMemoryLimitMb('')
    setMemoryReservationMb('')
    setCpuLimit('')
    setCpuShares('')
    setCpuQuota('')
    setCpuPeriod('')
    setPrivilegedMode(false)
    setReadOnlyRootFs(false)
    setCapAdd([])
    setCapDrop([])
    setSecurityOptions([])
    setDnsServers([])
    setDnsSearch([])
    setDnsOptions([])
    setDevices([])
    setUlimits([])
    setGpuEnabled(false)
    setGpuMode('all')
    setGpuCount(1)
    setGpuDeviceIds([])
    setGpuDriver('')
    setGpuCapabilities(['gpu'])
    setRuntime('')
    setAutoUpdateEnabled(false)
    setAutoUpdateCronExpression('0 3 * * *')
    setVulnerabilityCriteria('never')
    setSelectedConfigSetId('')
    setHealthcheckEnabled(false)
    setHealthcheckCommand('')
    setHealthcheckIntervalSec('30')
    setSubmitting(false)
  }, [open, prefilledImage, skipPullTab])

  useEffect(() => {
    if (!open || !autoPull || skipPullTab) return
    if (!prefilledImage) return
    if (pullStatus !== 'idle') return
    void startPull()
  }, [autoPull, open, prefilledImage, pullStatus, skipPullTab])

  async function startPull(): Promise<void> {
    if (!image.trim()) return
    if (pullStatus === 'pulling') return

    setActiveStage('pulling')
    setPullStatus('pulling')
    setPullProgress(10)
    setPullErrorMessage(null)
    setPullLogs([])
    setPullRuntimeEvents([])
    setPulledImageLayers([])
    seenPullRuntimeEventSetRef.current.clear()
    seenPullRuntimeEventQueueRef.current = []
    appendPullLog(`Resolving image ${image.trim()} from runtime catalog…`)

    if (!selectedImageEntity?.id) {
      const message = 'Image is not available in the local runtime catalog yet. Pull API wiring is not available from this modal.'
      setPullStatus('error')
      setPullProgress(0)
      setPullErrorMessage(message)
      appendPullLog(message)
      return
    }

    setPullProgress(35)

    try {
      const inspectResult = await imageInspectQuery.refetch()
      const parsedInspect = dockerImageInspectDetailSchema.safeParse(inspectResult.data)

      if (inspectResult.error || !parsedInspect.success) {
        const message = inspectResult.error instanceof Error
          ? inspectResult.error.message
          : 'Unable to inspect image metadata for pull stage.'
        setPullStatus('error')
        setPullProgress(0)
        setPullErrorMessage(message)
        appendPullLog(message)
        return
      }

      const inspectData = parsedInspect.data

      setPulledImageLayers(inspectData.layers)
      setPullProgress(100)
      setPullStatus('complete')
      appendPullLog(`Image resolved: ${inspectData.imageId}`)
      appendPullLog(`Loaded ${String(inspectData.layers.length)} layer records from runtime inspect.`)

      if (scanEnabled) {
        setActiveStage('scan')
        startScan(true)
      } else if (showContainerStage) {
        setActiveStage('container')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error during pull preparation.'
      setPullStatus('error')
      setPullProgress(0)
      setPullErrorMessage(message)
      appendPullLog(message)
    }
  }

  function startLiveScan(): void {
    if (!selectedImageEntity?.id) {
      setScanStatus('error')
      setScanProgress(0)
      setScanErrorMessage('Image is not available in runtime catalog. Pull or discover the image first.')
      return
    }

    setScanErrorMessage(null)
    setScanStatus('scanning')
    setScanProgress(1)
    setScanVulns({ critical: 0, high: 0, medium: 0, low: 0 })
    setLiveScanFindings([])
    setLiveScanSources({})
    setScanTimelineEvents([])
    seenLiveScanEventSetRef.current.clear()
    seenLiveScanEventQueueRef.current = []
    seenScanTimelineEventSetRef.current.clear()
    seenScanTimelineEventQueueRef.current = []

    appendScanTimelineEvent({
      timestamp: nowIso(),
      type: 'status',
      stage: 'queued',
      scanner: null,
      message: 'Scan queued and waiting for scanner initialization.',
      progress: 1,
    })
  }

  function startScan(force = false): void {
    if (!force && !canOpenScan) return
    if (scanStatus === 'scanning') return

    startLiveScan()
  }

  const stageBadge = useMemo(() => {
    if (pullStatus === 'pulling' || scanStatus === 'scanning') return 'Preparing runtime…'
    if (pullStatus === 'error') return 'Pull failed'
    if (scanStatus === 'error') return 'Scan failed'
    if (scanStatus === 'complete' && hasCriticalOrHigh) return 'Security attention required'
    if (scanStatus === 'complete' && pullScanOnly) return 'Pull & scan complete'
    if (scanStatus === 'complete') return 'Scan complete'
    if (pullStatus === 'complete') return 'Image ready'
    return 'Idle'
  }, [hasCriticalOrHigh, pullScanOnly, pullStatus, scanStatus])

  const imageCatalog = useMemo(() => {
    return imageEntities.map((entity) => {
      const tag = entity.tag ?? 'latest'
      const repositoryBase = `${entity.registry}/${entity.repository}`
      return {
        id: entity.id,
        tag,
        repositoryBase,
        imageRef: `${repositoryBase}:${tag}`,
      }
    })
  }, [imageEntities])

  const imageRuntimeEventsQuery = useDockerImageEventsStream(
    {
      query: {
        actions: ['pull', 'create', 'import', 'load', 'tag'],
      },
    },
    {
      enabled: open && pullStatus === 'pulling',
    },
  )

  const liveScanQuery = useDockerImageSecurityScanStream(
    {
      query: {
        imageId: selectedImageEntity?.id ?? '',
        refreshIntervalMs: 500,
      },
    },
    {
      enabled:
        open
        && scanStatus === 'scanning'
        && Boolean(selectedImageEntity?.id),
    },
  )

  useEffect(() => {
    if (!open || pullStatus !== 'pulling') {
      return
    }

    const runtimeEvent = imageRuntimeEventsQuery.event
    if (!runtimeEvent) {
      return
    }

    const repositoryBase = `${selectedImageEntity?.registry ?? ''}/${selectedImageEntity?.repository ?? ''}`
      .toLowerCase()
      .replace(/^\//u, '')
    const currentImageRef = image.trim().toLowerCase()
    const payloadImageName = (runtimeEvent.payload.imageName ?? '').toLowerCase()
    const payloadRepo = (runtimeEvent.payload.repository ?? '').toLowerCase()

    const imageNameMatch = payloadImageName.length > 0 && (
      currentImageRef.includes(payloadImageName)
      || payloadImageName.includes(currentImageRef)
    )
    const repoMatch = payloadRepo.length > 0 && repositoryBase.length > 0 && payloadRepo === repositoryBase
    const actorMatch = runtimeEvent.actorId !== null && selectedImageEntity?.id?.startsWith(runtimeEvent.actorId) === true

    if (!imageNameMatch && !repoMatch && !actorMatch) {
      return
    }

    const eventMessage = runtimeEvent.payload.imageName
      ?? runtimeEvent.payload.repository
      ?? runtimeEvent.from
      ?? 'image runtime event'

    appendPullRuntimeEvent(runtimeEvent.action, eventMessage, runtimeEvent.timestamp)

    if (runtimeEvent.action === 'pull') {
      setPullProgress((previous) => Math.max(previous, 56))
      return
    }

    if (runtimeEvent.action === 'create' || runtimeEvent.action === 'import' || runtimeEvent.action === 'load') {
      setPullProgress((previous) => Math.max(previous, 76))
      return
    }

    if (runtimeEvent.action === 'tag') {
      setPullProgress((previous) => Math.max(previous, 92))
    }
  }, [image, imageRuntimeEventsQuery.event, open, pullStatus, selectedImageEntity?.id, selectedImageEntity?.registry, selectedImageEntity?.repository])

  useEffect(() => {
    if (scanStatus !== 'scanning' || !selectedImageEntity?.id) {
      return
    }

    const events = liveScanQuery.events
    if (events.length === 0) {
      return
    }

    for (const event of events) {
      const eventKey = [
        event.timestamp,
        event.type,
        event.stage,
        event.scanner ?? 'engine',
        event.message,
        event.logLine ?? '',
      ].join('|')

      if (seenLiveScanEventSetRef.current.has(eventKey)) {
        continue
      }

      seenLiveScanEventSetRef.current.add(eventKey)
      seenLiveScanEventQueueRef.current.push(eventKey)

      if (seenLiveScanEventQueueRef.current.length > 2_000) {
        const oldestKey = seenLiveScanEventQueueRef.current.shift()
        if (oldestKey) {
          seenLiveScanEventSetRef.current.delete(oldestKey)
        }
      }

      if (typeof event.progress === 'number') {
        setScanProgress((previous) => Math.max(previous, event.progress ?? 0))
      }

      appendScanTimelineEvent({
        timestamp: event.timestamp,
        type: event.type,
        stage: event.stage,
        scanner: event.scanner,
        message: event.logLine ?? event.message,
        progress: event.progress,
      })

      const source = event.scanner ?? 'engine'
      const nextMessage = event.logLine ?? event.message

      setLiveScanSources((previous) => {
        const existing = previous[source] ?? {
          source,
          status: 'queued' as const,
          progress: 0,
          findingsCount: 0,
          startedAt: event.timestamp,
          visibleLogs: [] as ScanSourceLogRow[],
        }

        const nextStatus: ScanSourceStreamRow['status'] =
          event.type === 'error'
            ? 'failed'
            : event.type === 'result' || event.type === 'complete'
              ? 'completed'
              : 'running'

        const nextLogs = nextMessage
          ? [...existing.visibleLogs, { at: event.timestamp, message: nextMessage }].slice(-80)
          : existing.visibleLogs

        return {
          ...previous,
          [source]: {
            ...existing,
            status: nextStatus,
            progress: Math.max(existing.progress, event.progress ?? 0),
            findingsCount: event.scannerResult?.findingsCount ?? existing.findingsCount,
            visibleLogs: nextLogs,
          },
        }
      })

      if (Array.isArray(event.vulnerabilities)) {
        const summary = event.vulnerabilities.reduce(
          (accumulator, vulnerability) => {
            accumulator[vulnerability.severity] += 1
            return accumulator
          },
          { critical: 0, high: 0, medium: 0, low: 0 },
        )

        const mappedFindings: ScanFindingRow[] = event.vulnerabilities.map((finding) => ({
          id: finding.id,
          severity: finding.severity,
          source: finding.scannerSources?.join(', ') ?? event.scanner ?? 'scanner',
          packageName: finding.packageName,
          packageType: 'package',
          currentVersion: finding.currentVersion,
          fixedVersion: finding.fixedVersion,
        }))

        setScanVulns(summary)
        setLiveScanFindings(mappedFindings)
      }

      if (event.type === 'error') {
        setScanStatus('error')
        setScanErrorMessage(event.logLine ?? event.message)
        appendPullLog(`[scan-error] ${event.logLine ?? event.message}`)
        return
      }

      if (event.type === 'complete') {
        setScanStatus('complete')
        setScanProgress(100)
        appendPullLog('Scan stream completed and findings synchronized.')
        if (showContainerStage) {
          setActiveStage('container')
        }
      }
    }
  }, [liveScanQuery.events, scanStatus, selectedImageEntity?.id, showContainerStage])

  useEffect(() => {
    if (scanStatus !== 'scanning' || !selectedImageEntity?.id || !liveScanQuery.isError) {
      return
    }

    setScanStatus('error')
    setScanErrorMessage(
      liveScanQuery.error instanceof Error
        ? liveScanQuery.error.message
        : 'Security scan stream failed before completion.',
    )
  }, [liveScanQuery.error, liveScanQuery.isError, scanStatus, selectedImageEntity?.id])

  const fuzzyImageSuggestions = useMemo(() => {
    const query = image.trim()
    if (!query) return imageCatalog.slice(0, 12)
    return imageCatalog
      .map((item) => ({ item, score: fuzzyScore(query, item.imageRef) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.item)
  }, [image, imageCatalog])

  const pullLayers = useMemo(() => {
    const fallbackLayers = selectedImageEntity
      ? [{
        id: selectedImageEntity.id,
        instruction: 'Resolve image metadata',
        size: selectedImageEntity.sizeBytes === null ? '—' : `${String(selectedImageEntity.sizeBytes)} B`,
        createdAt: selectedImageEntity.createdAt,
      }]
      : []

    const layers = pulledImageLayers.length > 0 ? pulledImageLayers : fallbackLayers
    const layerCount = Math.max(1, layers.length)

    return layers.map((layer, index) => {
      const threshold = ((index + 1) / layerCount) * 100
      let status: 'waiting' | 'downloading' | 'extracting' | 'done' = 'waiting'
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
      return {
        id: layer.id,
        digest: layer.id,
        instruction: layer.instruction,
        size: layer.size,
        status,
        progress,
      }
    })
  }, [pullProgress, pullStatus, pulledImageLayers, selectedImageEntity])

  const scanSourceStreams = useMemo(() => {
    const streams = Object.values(liveScanSources)
    if (streams.length > 0) {
      return streams
    }

    return [
      {
        source: selectedImageEntity?.id ? 'engine' : 'runtime',
        status:
          scanStatus === 'error'
            ? 'failed'
            : scanStatus === 'complete'
              ? 'completed'
              : scanStatus === 'scanning'
                ? 'running'
                : 'queued',
        progress: scanProgress,
        findingsCount: liveScanFindings.length,
        startedAt: nowIso(),
        visibleLogs: scanErrorMessage ? [{ at: nowIso(), message: scanErrorMessage }] : [],
      } satisfies ScanSourceStreamRow,
    ]
  }, [liveScanFindings.length, liveScanSources, scanErrorMessage, scanProgress, scanStatus, selectedImageEntity?.id])

  const scanLogs = useMemo(() => {
    return scanSourceStreams.flatMap((source) => source.visibleLogs.map((log) => ({ ...log, source: source.source })))
  }, [scanSourceStreams])

  const rawScanLines = useMemo(() => {
    return scanLogs.map((row) => `${row.at} [${row.source}] ${row.message}`)
  }, [scanLogs])

  const pullTimelineRows = useMemo(() => {
    const fromRuntime = pullRuntimeEvents.map((event) => ({
      at: event.timestamp,
      type: event.action,
      message: event.message,
    }))

    const fromLocalLogs = pullLogs.map((event) => ({
      at: event.at,
      type: 'local',
      message: event.message,
    }))

    return [...fromRuntime, ...fromLocalLogs]
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-160)
  }, [pullLogs, pullRuntimeEvents])

  const scanStageSummaryRows = useMemo(() => {
    return SCAN_STAGE_ORDER.map((stage) => {
      const stageEvents = scanTimelineEvents.filter((event) => event.stage === stage)
      const first = stageEvents.at(0) ?? null
      const last = stageEvents.at(-1) ?? null
      const maxProgress = stageEvents.reduce((max, event) => Math.max(max, event.progress ?? 0), 0)

      let status: 'pending' | 'active' | 'complete' | 'failed' = 'pending'
      if (stage === 'error' && stageEvents.length > 0) {
        status = 'failed'
      } else if (stageEvents.length > 0) {
        status = stage === 'completed' || (last?.type === 'complete') ? 'complete' : 'active'
      }

      return {
        stage,
        status,
        first,
        last,
        maxProgress,
      }
    })
  }, [scanTimelineEvents])

  const scannerPullRows = useMemo(() => {
    return SCANNER_ORDER.map((scanner) => {
      const allScannerEvents = scanTimelineEvents.filter((event) => event.scanner === scanner)
      const pullEvents = allScannerEvents.filter((event) => event.stage === 'pulling-scanner')
      const progress = pullEvents.reduce((max, event) => Math.max(max, event.progress ?? 0), 0)
      const latestPull = pullEvents.at(-1) ?? null
      const hasAdvancedPastPull = allScannerEvents.some((event) => event.stage !== 'pulling-scanner')
      const hasScannerError = allScannerEvents.some((event) => event.type === 'error')

      return {
        scanner,
        status: hasScannerError
          ? 'failed'
          : hasAdvancedPastPull
            ? 'completed'
            : pullEvents.length > 0
              ? 'running'
              : 'queued',
        progress,
        latestPull,
      }
    })
  }, [scanTimelineEvents])

  const networkOptions = useMemo(() => {
    return availableNetworks.map((network) => ({
      value: network.id,
      label: network.name,
      description: `${network.driver} • ${network.scope} • ${network.subnet ?? 'no subnet'}`,
    }))
  }, [availableNetworks])

  const scanFindings = useMemo(() => liveScanFindings, [liveScanFindings])

  function updateArrayItem<T>(setState: Dispatch<SetStateAction<T[]>>, index: number, next: T): void {
    setState((previous) => previous.map((item, i) => (i === index ? next : item)))
  }

  function addArrayItem<T>(setState: Dispatch<SetStateAction<T[]>>, value: T): void {
    setState((previous) => [...previous, value])
  }

  function removeArrayItem<T>(setState: Dispatch<SetStateAction<T[]>>, index: number): void {
    setState((previous) => previous.filter((_, i) => i !== index))
  }

  function applyConfigSet(configSetId: string): void {
    setSelectedConfigSetId(configSetId)
    const configSet = CONFIG_PRESETS.find((set) => String(set.id) === configSetId)
    if (!configSet) return

    if (configSet.envVars?.length) setEnvVars(configSet.envVars)
    if (configSet.labels?.length) setLabels(configSet.labels)
    if (configSet.ports?.length) setPorts(configSet.ports)
    if (configSet.volumes?.length) setVolumes(configSet.volumes)
    if (configSet.networkMode) setNetworkMode(configSet.networkMode)
    if (configSet.restartPolicy) setRestartPolicy(configSet.restartPolicy)
  }

  function addCapability(type: 'add' | 'drop', cap: string): void {
    const normalized = cap.trim().toUpperCase()
    if (!normalized) return
    if (type === 'add') {
      setCapAdd((previous) => (previous.includes(normalized) ? previous : [...previous, normalized]))
      return
    }
    setCapDrop((previous) => (previous.includes(normalized) ? previous : [...previous, normalized]))
  }

  function addSimpleString(setter: Dispatch<SetStateAction<string[]>>, value: string): void {
    const normalized = value.trim()
    if (!normalized) return
    setter((previous) => (previous.includes(normalized) ? previous : [...previous, normalized]))
  }

  function submitContainer(): void {
    if (!name.trim() || !image.trim()) {
      return
    }

    setSubmitting(true)

    const payload: DockerCreateContainerPayload = {
      name: name.trim(),
      image: image.trim(),
      command: command.trim(),
      restartPolicy,
      restartMaxRetries: restartPolicy === 'on-failure' && restartMaxRetries.trim() ? Number(restartMaxRetries) : null,
      networkMode,
      selectedNetworks,
      startAfterCreate,
      repullImage,
      containerUser,
      privilegedMode,
      readOnlyRootFs,
      healthcheckEnabled,
      healthcheckCommand: healthcheckCommand.trim(),
      healthcheckIntervalSec: Number(healthcheckIntervalSec) || 30,
      memoryLimitMb: memoryLimitMb.trim() ? Number(memoryLimitMb) : null,
      memoryReservationMb: memoryReservationMb.trim() ? Number(memoryReservationMb) : null,
      cpuShares: cpuShares.trim() ? Number(cpuShares) : null,
      cpuQuota: cpuQuota.trim() ? Number(cpuQuota) : null,
      cpuPeriod: cpuPeriod.trim() ? Number(cpuPeriod) : null,
      cpuLimit: cpuLimit.trim() ? Number(cpuLimit) : null,
      capAdd,
      capDrop,
      securityOptions,
      dnsServers,
      dnsSearch,
      dnsOptions,
      devices: devices.filter((entry) => entry.hostPath.trim() && entry.containerPath.trim()),
      ulimits: ulimits
        .filter((entry) => entry.name.trim() && entry.soft.trim() && entry.hard.trim())
        .map((entry) => ({ name: entry.name, soft: Number(entry.soft), hard: Number(entry.hard) })),
      gpu: {
        enabled: gpuEnabled,
        mode: gpuMode,
        count: gpuCount,
        deviceIds: gpuDeviceIds,
        driver: gpuDriver,
        capabilities: gpuCapabilities,
        runtime,
      },
      autoUpdate: {
        enabled: autoUpdateEnabled,
        cronExpression: autoUpdateCronExpression,
        vulnerabilityCriteria,
      },
      envVars: envVars.filter((entry) => entry.key.trim().length > 0),
      labels: labels.filter((entry) => entry.key.trim().length > 0),
      ports: ports.filter((entry) => entry.containerPort.trim() && entry.hostPort.trim()),
      volumes: volumes.filter((entry) => entry.hostPath.trim() && entry.containerPath.trim()),
      pullScanSummary: {
        pullStatus,
        scanStatus,
        vulnerabilities: scanVulns,
      },
    }

    try {
      onCreated?.(payload)
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBusy) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="w-[85vw] max-w-7xl! h-[85vh] max-h-[85vh] p-0 flex flex-col overflow-hidden"
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isBusy) event.preventDefault()
        }}
      >
        <DialogHeader className="px-5 py-4 border-b bg-muted/25 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogTitle>{pullScanOnly ? 'Pull & scan image' : 'Create new container'}</DialogTitle>
              <DialogDescription className="text-xs">
                {pullScanOnly
                  ? 'Image workflow: choose image → pull layers → run vulnerability scan'
                  : 'Multi-stage flow: pull image → scan vulnerabilities → configure container runtime'}
              </DialogDescription>
            </div>
            <Badge variant="outline">{stageBadge}</Badge>
          </div>
        </DialogHeader>

        {!skipPullTab ? (
          <div className="flex items-center gap-2 border-b px-5 bg-muted/10 shrink-0 overflow-x-auto">
            <button
              type="button"
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeStage === 'image' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveStage('image')}
            >
              <Search className="h-4 w-4" /> Image
            </button>
            <span className="text-muted-foreground/60">→</span>
            <button
              type="button"
              disabled={!image.trim()}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-40 ${activeStage === 'pulling' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveStage('pulling')}
            >
              <Download className="h-4 w-4" /> Pulling
              {pullStatus === 'pulling' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {pullStatus === 'complete' ? <Badge variant="default" className="h-5 px-1 text-[10px]">done</Badge> : null}
            </button>
            <span className="text-muted-foreground/60">→</span>
            <button
              type="button"
              disabled={!canOpenScan}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-40 ${activeStage === 'scan' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveStage('scan')}
            >
              <Shield className="h-4 w-4" /> Scan
              {scanStatus === 'scanning' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {scanStatus === 'complete' ? <Badge variant={hasCriticalOrHigh ? 'destructive' : 'default'} className="h-5 px-1 text-[10px]">done</Badge> : null}
            </button>
            {showContainerStage ? (
              <>
                <span className="text-muted-foreground/60">→</span>
                <button
                  type="button"
                  disabled={!canOpenContainer}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 disabled:opacity-40 ${activeStage === 'container' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setActiveStage('container')}
                >
                  Container
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-hidden">
          <div className={`h-full px-5 py-4 ${activeStage === 'image' ? 'block' : 'hidden'}`}>
            <div className="h-full flex flex-col gap-3">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Image</label>
                <Input
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  placeholder="ghcr.io/org/app:latest"
                />
              </div>

              <div className="rounded-lg border bg-background/80 p-2 text-xs flex-1 min-h-0 flex flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-muted-foreground">Image & tag list</p>
                  <Badge variant="outline">{fuzzyImageSuggestions.length} matches</Badge>
                </div>
                <div className="flex-1 min-h-0 overflow-auto rounded border">
                  {fuzzyImageSuggestions.length > 0 ? (
                    <div className="divide-y">
                      {fuzzyImageSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/50 ${image === suggestion.imageRef ? 'bg-primary/5' : ''}`}
                          onMouseDown={(event) => {
                            event.preventDefault()
                            setImage(suggestion.imageRef)
                          }}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[11px]">{suggestion.repositoryBase}</p>
                            <p className="text-muted-foreground">tag: {suggestion.tag}</p>
                          </div>
                          <Badge variant={image === suggestion.imageRef ? 'default' : 'secondary'}>{image === suggestion.imageRef ? 'Selected' : 'Select'}</Badge>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="p-3 text-muted-foreground">No fuzzy match yet — keep typing.</p>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Tip: pick an image+tag here, then continue to pulling.</p>
              </div>

              <div className="mt-auto flex items-center gap-2">
                <Button type="button" onClick={() => { void startPull() }} disabled={!image.trim() || pullStatus === 'pulling'}>
                  {pullStatus === 'pulling' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {pullStatus === 'pulling' ? 'Pulling image…' : 'Start pulling'}
                </Button>
                <Button type="button" variant="outline" disabled={!image.trim()} onClick={() => setActiveStage('pulling')}>
                  View pulling details
                </Button>
              </div>
            </div>
          </div>

          <div className={`h-full px-5 py-4 ${activeStage === 'pulling' ? 'block' : 'hidden'}`}>
            <div className="h-full flex flex-col gap-3 min-h-0">
              <DockerImagePullProgressPanel
                image={image}
                pullStatus={pullStatus}
                pullProgress={pullProgress}
                pullErrorMessage={pullErrorMessage}
                pullRuntimeEventCount={pullRuntimeEvents.length}
                pullLayers={pullLayers}
                pullTimelineRows={pullTimelineRows}
                toClock={toClock}
              />

              <div className="mt-auto flex items-center gap-2">
                <Button type="button" onClick={() => { void startPull() }} disabled={!image.trim() || pullStatus === 'pulling'}>
                  {pullStatus === 'pulling' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {pullStatus === 'pulling' ? 'Pulling image…' : 'Start pull'}
                </Button>
                <Button type="button" variant="outline" disabled={!canOpenScan} onClick={() => setActiveStage('scan')}>
                  Continue to scan
                </Button>
              </div>
            </div>
          </div>

          <div className={`h-full px-5 py-4 ${activeStage === 'scan' ? 'block' : 'hidden'}`}>
            <div className="h-full flex flex-col gap-3 min-h-0">
              <DockerScanStackPanel
                scanStatus={scanStatus}
                scanProgress={scanProgress}
                scanErrorMessage={scanErrorMessage}
                scanVulns={scanVulns}
                scanStageSummaryRows={scanStageSummaryRows}
                scannerPullRows={scannerPullRows}
                scanSourceStreams={scanSourceStreams}
                scanFindings={scanFindings}
                rawScanLines={rawScanLines}
                canStartScan={canOpenScan}
                onStartScan={() => startScan()}
                titleCaseStage={titleCaseStage}
                toClock={toClock}
              />

              <div className="mt-auto flex items-center gap-2">
                {showContainerStage ? (
                  <Button type="button" variant="outline" disabled={scanStatus !== 'complete'} onClick={() => setActiveStage('container')}>
                    Continue to config
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className={`h-full px-5 py-4 overflow-y-auto ${activeStage === 'container' && showContainerStage ? 'block' : 'hidden'}`}>
            <div className="space-y-4">
              <DockerRuntimeStackOverview
                image={image}
                pullStatus={pullStatus}
                scanStatus={scanStatus}
                portsCount={ports.filter((entry) => entry.containerPort.trim() && entry.hostPort.trim()).length}
                volumesCount={volumes.filter((entry) => entry.hostPath.trim() && entry.containerPath.trim()).length}
                envVarsCount={envVars.filter((entry) => entry.key.trim().length > 0).length}
                labelsCount={labels.filter((entry) => entry.key.trim().length > 0).length}
                networkMode={networkMode}
                selectedNetworksCount={selectedNetworks.length}
              />

              <div className="rounded border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Config set</p>
                <select
                  className="h-9 w-full rounded border bg-background px-2 text-sm"
                  value={selectedConfigSetId}
                  onChange={(event) => applyConfigSet(event.target.value)}
                >
                  <option value="">Select a config set…</option>
                  {CONFIG_PRESETS.map((configSet) => (
                    <option key={configSet.id} value={String(configSet.id)}>{configSet.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground">Container name *</label>
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="my-service-web" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Image *</label>
                  <Input value={image} onChange={(event) => setImage(event.target.value)} placeholder="ghcr.io/org/app:latest" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground">Command</label>
                  <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="bun run start" />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="text-xs text-muted-foreground">Restart policy</label>
                  <select className="h-9 w-full rounded border bg-background px-2 text-sm" value={restartPolicy} onChange={(event) => setRestartPolicy(event.target.value as 'no' | 'always' | 'unless-stopped' | 'on-failure')}>
                    <option value="no">No</option>
                    <option value="always">Always</option>
                    <option value="unless-stopped">Unless stopped</option>
                    <option value="on-failure">On failure</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Network mode</label>
                  <select className="h-9 w-full rounded border bg-background px-2 text-sm" value={networkMode} onChange={(event) => setNetworkMode(event.target.value)}>
                    <option value="bridge">bridge</option>
                    <option value="host">host</option>
                    <option value="none">none</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={startAfterCreate} onChange={(event) => setStartAfterCreate(event.target.checked)} />
                    Start after create
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={repullImage} onChange={(event) => setRepullImage(event.target.checked)} /> Pull image before deploy</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={readOnlyRootFs} onChange={(event) => setReadOnlyRootFs(event.target.checked)} /> Readonly rootfs</label>
              </div>

              {restartPolicy === 'on-failure' ? (
                <div>
                  <label className="text-xs text-muted-foreground">Restart max retries</label>
                  <Input value={restartMaxRetries} onChange={(event) => setRestartMaxRetries(event.target.value)} placeholder="3" />
                </div>
              ) : null}

              <div className="rounded border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Ports</p>
                {ports.map((port, index) => (
                  <div key={`port-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                    <Input value={port.hostPort} onChange={(event) => updateArrayItem(setPorts, index, { ...port, hostPort: event.target.value })} placeholder="host" />
                    <Input value={port.containerPort} onChange={(event) => updateArrayItem(setPorts, index, { ...port, containerPort: event.target.value })} placeholder="container" />
                    <select className="h-9 rounded border bg-background px-2 text-sm" value={port.protocol} onChange={(event) => updateArrayItem(setPorts, index, { ...port, protocol: event.target.value as 'tcp' | 'udp' })}>
                      <option value="tcp">tcp</option>
                      <option value="udp">udp</option>
                    </select>
                    <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted" onClick={() => removeArrayItem(setPorts, index)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(setPorts, { hostPort: '', containerPort: '', protocol: 'tcp' })}>
                  <Plus className="h-4 w-4" /> Add port
                </Button>
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Volumes</p>
                {volumes.map((volume, index) => (
                  <div key={`volume-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                    <Input value={volume.hostPath} onChange={(event) => updateArrayItem(setVolumes, index, { ...volume, hostPath: event.target.value })} placeholder="/host/path" />
                    <Input value={volume.containerPath} onChange={(event) => updateArrayItem(setVolumes, index, { ...volume, containerPath: event.target.value })} placeholder="/container/path" />
                    <select className="h-9 rounded border bg-background px-2 text-sm" value={volume.mode} onChange={(event) => updateArrayItem(setVolumes, index, { ...volume, mode: event.target.value as 'rw' | 'ro' })}>
                      <option value="rw">rw</option>
                      <option value="ro">ro</option>
                    </select>
                    <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted" onClick={() => removeArrayItem(setVolumes, index)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(setVolumes, { hostPath: '', containerPath: '', mode: 'rw' })}>
                  <Plus className="h-4 w-4" /> Add volume
                </Button>
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowResources((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><Cpu className="h-4 w-4" />Resources</span>
                  {showResources ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showResources ? (
                  <div className="border-t p-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Memory limit (MB)</label>
                      <Input value={memoryLimitMb} onChange={(event) => setMemoryLimitMb(event.target.value)} placeholder="512" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Memory reservation (MB)</label>
                      <Input value={memoryReservationMb} onChange={(event) => setMemoryReservationMb(event.target.value)} placeholder="256" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CPU limit (cores)</label>
                      <Input value={cpuLimit} onChange={(event) => setCpuLimit(event.target.value)} placeholder="1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CPU shares</label>
                      <Input value={cpuShares} onChange={(event) => setCpuShares(event.target.value)} placeholder="1024" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CPU quota</label>
                      <Input value={cpuQuota} onChange={(event) => setCpuQuota(event.target.value)} placeholder="50000" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">CPU period</label>
                      <Input value={cpuPeriod} onChange={(event) => setCpuPeriod(event.target.value)} placeholder="100000" />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowSecurity((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><Shield className="h-4 w-4" />Security</span>
                  {showSecurity ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showSecurity ? (
                  <div className="border-t p-3 space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground">Container user</label>
                      <Input value={containerUser} onChange={(event) => setContainerUser(event.target.value)} placeholder="user:group or UID:GID" />
                    </div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privilegedMode} onChange={(event) => setPrivilegedMode(event.target.checked)} /> Privileged mode</label>
                    <label className="flex items-center gap-2 text-sm"><Lock className="h-4 w-4" /> Security options</label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input placeholder="e.g. no-new-privileges" onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        addSimpleString(setSecurityOptions, event.currentTarget.value)
                        event.currentTarget.value = ''
                      }} />
                      <Button type="button" variant="outline" size="sm" onClick={() => addCapability('add', 'NET_ADMIN')}>+ cap</Button>
                    </div>
                    {securityOptions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {securityOptions.map((option) => (
                          <Badge key={option} variant="outline" className="text-[10px]">{option}</Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Capabilities</p>
                      <div className="flex flex-wrap gap-1.5">
                        {COMMON_CAPABILITIES.map((cap) => (
                          <button
                            key={cap}
                            type="button"
                            className={`rounded border px-2 py-0.5 text-[10px] ${capAdd.includes(cap) ? 'bg-green-50 border-green-400' : 'hover:bg-muted/40'}`}
                            onClick={() => addCapability('add', cap)}
                          >
                            +{cap}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowHealth((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><HeartPulse className="h-4 w-4" />Healthcheck</span>
                  {showHealth ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showHealth ? (
                  <div className="border-t p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={healthcheckEnabled} onChange={(event) => setHealthcheckEnabled(event.target.checked)} /> Enable healthcheck</label>
                    {healthcheckEnabled ? (
                      <>
                        <div>
                          <label className="text-xs text-muted-foreground">Command</label>
                          <Input value={healthcheckCommand} onChange={(event) => setHealthcheckCommand(event.target.value)} placeholder="curl -f http://localhost:3000/health || exit 1" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Interval (seconds)</label>
                          <Input value={healthcheckIntervalSec} onChange={(event) => setHealthcheckIntervalSec(event.target.value)} placeholder="30" />
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Environment variables</p>
                {envVars.map((entry, index) => (
                  <div key={`env-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <Input value={entry.key} onChange={(event) => updateArrayItem(setEnvVars, index, { ...entry, key: event.target.value })} placeholder="KEY" />
                    <Input value={entry.value} onChange={(event) => updateArrayItem(setEnvVars, index, { ...entry, value: event.target.value })} placeholder="value" />
                    <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted" onClick={() => removeArrayItem(setEnvVars, index)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(setEnvVars, { key: '', value: '' })}>
                  <Plus className="h-4 w-4" /> Add env
                </Button>
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Labels</p>
                {labels.map((entry, index) => (
                  <div key={`label-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <Input value={entry.key} onChange={(event) => updateArrayItem(setLabels, index, { ...entry, key: event.target.value })} placeholder="com.example.key" />
                    <Input value={entry.value} onChange={(event) => updateArrayItem(setLabels, index, { ...entry, value: event.target.value })} placeholder="value" />
                    <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted" onClick={() => removeArrayItem(setLabels, index)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(setLabels, { key: '', value: '' })}>
                  <Plus className="h-4 w-4" /> Add label
                </Button>
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Attached networks</p>
                <MultiSelect
                  options={networkOptions}
                  value={selectedNetworks}
                  onValueChange={setSelectedNetworks}
                  placeholder="Select attached networks"
                  searchPlaceholder="Search networks..."
                  emptyMessage="No network found."
                />
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowDns((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><Wifi className="h-4 w-4" />DNS settings</span>
                  {showDns ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showDns ? (
                  <div className="border-t p-3 space-y-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input placeholder="DNS server (8.8.8.8)" onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        addSimpleString(setDnsServers, event.currentTarget.value)
                        event.currentTarget.value = ''
                      }} />
                      <Button type="button" variant="outline" size="sm" onClick={() => addSimpleString(setDnsServers, '8.8.8.8')}>Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">{dnsServers.map((item) => <Badge key={item} variant="outline" className="text-[10px]">{item}</Badge>)}</div>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input placeholder="Search domain (example.com)" onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        addSimpleString(setDnsSearch, event.currentTarget.value)
                        event.currentTarget.value = ''
                      }} />
                      <Button type="button" variant="outline" size="sm" onClick={() => addSimpleString(setDnsSearch, 'local')}>Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">{dnsSearch.map((item) => <Badge key={item} variant="outline" className="text-[10px]">{item}</Badge>)}</div>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input placeholder="DNS option (ndots:5)" onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        addSimpleString(setDnsOptions, event.currentTarget.value)
                        event.currentTarget.value = ''
                      }} />
                      <Button type="button" variant="outline" size="sm" onClick={() => addSimpleString(setDnsOptions, 'ndots:5')}>Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">{dnsOptions.map((item) => <Badge key={item} variant="outline" className="text-[10px]">{item}</Badge>)}</div>
                  </div>
                ) : null}
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowDevices((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><HardDrive className="h-4 w-4" />Devices</span>
                  {showDevices ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showDevices ? (
                  <div className="border-t p-3 space-y-2">
                    {devices.map((device, index) => (
                      <div key={`device-${String(index)}`} className="grid gap-2 md:grid-cols-[1fr_1fr_120px_auto]">
                        <Input value={device.hostPath} onChange={(event) => updateArrayItem(setDevices, index, { ...device, hostPath: event.target.value })} placeholder="/dev/sda" />
                        <Input value={device.containerPath} onChange={(event) => updateArrayItem(setDevices, index, { ...device, containerPath: event.target.value })} placeholder="/dev/sda" />
                        <Input value={device.permissions} onChange={(event) => updateArrayItem(setDevices, index, { ...device, permissions: event.target.value })} placeholder="rwm" />
                        <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted" onClick={() => removeArrayItem(setDevices, index)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(setDevices, { hostPath: '', containerPath: '', permissions: 'rwm' })}><Plus className="h-4 w-4" /> Add device</Button>
                  </div>
                ) : null}
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowGpu((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><Settings2 className="h-4 w-4" />GPU</span>
                  {showGpu ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showGpu ? (
                  <div className="border-t p-3 space-y-3">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpuEnabled} onChange={(event) => setGpuEnabled(event.target.checked)} /> Enable GPU</label>
                    {gpuEnabled ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="text-xs text-muted-foreground">Mode</label>
                            <select className="h-9 w-full rounded border bg-background px-2 text-sm" value={gpuMode} onChange={(event) => setGpuMode(event.target.value as 'all' | 'count' | 'specific')}>
                              <option value="all">all</option>
                              <option value="count">count</option>
                              <option value="specific">specific</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Count</label>
                            <Input value={String(gpuCount)} onChange={(event) => setGpuCount(Number(event.target.value) || 1)} />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Driver</label>
                            <Input value={gpuDriver} onChange={(event) => setGpuDriver(event.target.value)} placeholder="nvidia" />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Runtime</label>
                          <Input value={runtime} onChange={(event) => setRuntime(event.target.value)} placeholder="nvidia" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Capabilities</label>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {COMMON_GPU_CAPABILITIES.map((cap) => (
                              <button key={cap} type="button" className={`rounded border px-2 py-0.5 text-[10px] ${gpuCapabilities.includes(cap) ? 'bg-violet-50 border-violet-400' : 'hover:bg-muted/40'}`} onClick={() => setGpuCapabilities((previous) => (previous.includes(cap) ? previous.filter((item) => item !== cap) : [...previous, cap]))}>{cap}</button>
                            ))}
                          </div>
                        </div>
                        {gpuMode === 'specific' ? (
                          <div>
                            <label className="text-xs text-muted-foreground">Device IDs (comma separated)</label>
                            <Input value={gpuDeviceIds.join(',')} onChange={(event) => setGpuDeviceIds(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="0,1" />
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40" onClick={() => setShowUlimits((prev) => !prev)}>
                  <span className="text-sm font-medium inline-flex items-center gap-2"><Settings2 className="h-4 w-4" />Ulimits</span>
                  {showUlimits ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showUlimits ? (
                  <div className="border-t p-3 space-y-2">
                    {ulimits.map((item, index) => (
                      <div key={`ulimit-${String(index)}`} className="grid gap-2 md:grid-cols-[160px_1fr_1fr_auto]">
                        <select className="h-9 rounded border bg-background px-2 text-sm" value={item.name} onChange={(event) => updateArrayItem(setUlimits, index, { ...item, name: event.target.value })}>
                          {COMMON_ULIMITS.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                        <Input value={item.soft} onChange={(event) => updateArrayItem(setUlimits, index, { ...item, soft: event.target.value })} placeholder="soft" />
                        <Input value={item.hard} onChange={(event) => updateArrayItem(setUlimits, index, { ...item, hard: event.target.value })} placeholder="hard" />
                        <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border hover:bg-muted" onClick={() => removeArrayItem(setUlimits, index)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => addArrayItem(setUlimits, { name: 'nofile', soft: '', hard: '' })}><Plus className="h-4 w-4" /> Add ulimit</Button>
                  </div>
                ) : null}
              </div>

              <div className="rounded border p-3 space-y-3">
                <p className="text-xs text-muted-foreground">Auto-update</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoUpdateEnabled} onChange={(event) => setAutoUpdateEnabled(event.target.checked)} /> Enable auto-update</label>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Cron expression</label>
                    <Input value={autoUpdateCronExpression} onChange={(event) => setAutoUpdateCronExpression(event.target.value)} placeholder="0 3 * * *" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Vulnerability threshold</label>
                    <select className="h-9 w-full rounded border bg-background px-2 text-sm" value={vulnerabilityCriteria} onChange={(event) => setVulnerabilityCriteria(event.target.value as VulnerabilityCriteria)}>
                      <option value="never">never</option>
                      <option value="critical">critical</option>
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                      <option value="any">any</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/20 shrink-0 flex items-center justify-between">
          <div>
            {((activeStage === 'container' && showContainerStage) || (pullScanOnly && activeStage === 'scan')) && hasCriticalOrHigh ? (
              <p className="text-xs text-amber-600">Critical/high vulnerabilities detected. Review before deploying.</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
              {pullScanOnly ? 'Close' : 'Cancel'}
            </Button>
            {showContainerStage ? (
              <Button
                type="button"
                onClick={submitContainer}
                disabled={isBusy || activeStage !== 'container' || !name.trim() || !image.trim()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {submitting ? 'Creating…' : 'Create container'}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
