'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useDockerCloseContainerTerminalSession,
  useDockerContainerEventsStream,
  useDockerContainerFiles,
  useDockerContainerInspect,
  useDockerImageInspect,
  useDockerImageSecurityScanStream,
  useDockerContainerLogsStream,
  useDockerContainerLogsSnapshot,
  useDockerContainerProcessLogsStream,
  useDockerContainerProcessesStream,
  useDockerContainerReadFile,
  useDockerRunContainerAction,
  useDockerContainerTerminalSessionStream,
  useDockerRuntimeEventSubscriber,
  useDockerCreateContainerDirectory,
  useDockerDeleteContainerPath,
  useDockerOpenContainerTerminalSession,
  useDockerRenameContainerPath,
  useDockerSendContainerTerminalInput,
  useDockerWriteContainerFile,
} from '@/domains/docker/hooks'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import {
  dockerContainerInspectDetailSchema,
  dockerContainerLogEntrySchema,
  dockerContainerProcessEntrySchema,
  dockerImageInspectDetailSchema,
  type DockerContainer,
  type DockerContainerLogEntry,
  type DockerContainerProcessEntry,
  type DockerContainerMetricPoint,
  type DockerFileEntry,
  type DockerImageSecurityScanEvent,
  type DockerTerminalProfile,
  type DockerVulnerabilityEntry,
} from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Pause, Play, PlayCircle, RotateCcw, Skull, Square, Trash2 } from 'lucide-react'
import { getMockImageLayers } from '@/mocks/platform/entities/docker.large.mock'
import { getEntryName, getParentPath, toSafePathName } from '../docker-filesystem-utils'
import { DockerDetailLoadingState } from '../docker-loading-states'
import { DockerModalQuickActions } from '../docker-modal-quick-actions'
import { toast } from 'sonner'
import { DockerContainerLogsTab } from '../../containers/_components/container-detail-modal/logs-tab'
import {
} from "./tabs";
import { isRecord, isObjectLike } from "@repo/type-guards";
import {
  DockerContainerComposeTab,
  DockerContainerConfigTab,
  DockerContainerEnvTab,
  DockerContainerFilesTab,
  DockerContainerLabelsTab,
  DockerContainerLayersTab,
  DockerContainerMountsTab,
  DockerContainerNetworkTab,
  DockerContainerOverviewTab,
  DockerContainerProcessesTab,
  DockerContainerSecurityTab,
  DockerContainerTerminalTab,
} from './tabs'


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
interface DockerContainerDetailModalTriggerProps {
  id: string
  container?: DockerContainer | null
  onContainerStateChange?: () => Promise<unknown> | unknown
  children: ReactNode
  className?: string
  initialTab?: string
}

/**
 * Internal props for the heavy modal content. Inherits the entity-bound
 * fields (id, container, onContainerStateChange, initialTab) from the
 * trigger props and adds `open` / `onOpenChange` for controlled state.
 * `children` is intentionally omitted — the trigger consumes it for the
 * button label, the content renders its own JSX.
 */
type DockerContainerDetailModalContentProps = Omit<
  DockerContainerDetailModalTriggerProps,
  "children" | "className"
> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const debugDockerModalLogs = createContextFilterDebugLogger('DockerContainerDetailModalTrigger', 'docker-web-modal')

function inferLogLevel(message: string): DockerContainerLogEntry['level'] {
  if (/\b(error|fatal|panic)\b/iu.test(message)) return 'error'
  if (/\b(warn|warning)\b/iu.test(message)) return 'warn'
  return 'info'
}

function coerceContainerLogEntry(payload: unknown): DockerContainerLogEntry | null {
  const direct = dockerContainerLogEntrySchema.safeParse(payload)
  if (direct.success) {
    return direct.data
  }

  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const record = isRecord(payload) ? payload : {}

  const rawMessage =
    typeof record.message === 'string'
      ? record.message
      : typeof record.log === 'string'
        ? record.log
        : typeof record.line === 'string'
          ? record.line
          : typeof record.data === 'string'
            ? record.data
            : null

  if (!rawMessage) {
    return null
  }

  const timestampSource =
    typeof record.timestamp === 'string' || typeof record.timestamp === 'number'
      ? record.timestamp
      : typeof record.time === 'string' || typeof record.time === 'number'
        ? record.time
        : typeof record.at === 'string' || typeof record.at === 'number'
          ? record.at
          : Date.now()

  const parsedTimestamp = new Date(timestampSource)
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date().toISOString() : parsedTimestamp.toISOString()

  const stream = record.stream === 'stderr' ? 'stderr' : 'stdout'
  const level =
    record.level === 'error' || record.level === 'warn' || record.level === 'info'
      ? record.level
      : inferLogLevel(rawMessage)

  const id =
    typeof record.id === 'string' && record.id.length > 0
      ? record.id
      : `${timestamp}:${stream}:${level}:${rawMessage.slice(0, 120)}`

  return {
    id,
    timestamp,
    stream,
    level,
    message: rawMessage,
  }
}

function extractContainerLogEntries(payload: unknown, depth = 0): DockerContainerLogEntry[] {
  if (depth > 5) {
    return []
  }

  const direct = coerceContainerLogEntry(payload)
  if (direct) {
    return [direct]
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown
      return extractContainerLogEntries(parsed, depth + 1)
    } catch {
      return []
    }
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => extractContainerLogEntries(entry, depth + 1))
  }

  if (typeof payload !== 'object' || payload === null) {
    return []
  }

  const record = isRecord(payload) ? payload : {}
  const nestedCandidates = [
    record.body,
    record.data,
    record.payload,
    record.event,
    record.result,
    record.value,
    record.entry,
    record.entries,
    record.items,
    record.chunk,
  ]

  return nestedCandidates.flatMap((candidate) => extractContainerLogEntries(candidate, depth + 1))
}

function resolveFallbackPayloadMessage(payload: unknown, depth = 0): string | null {
  if (depth > 6 || payload == null) {
    return null
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed) {
      return null
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return resolveFallbackPayloadMessage(JSON.parse(trimmed) as unknown, depth + 1)
      } catch {
        return trimmed
      }
    }

    return trimmed
  }

  if (typeof payload !== 'object') {
    return String(payload)
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const nested = resolveFallbackPayloadMessage(entry, depth + 1)
      if (nested) {
        return nested
      }
    }
    return null
  }

  const record = isRecord(payload) ? payload : {}

  for (const key of ['message', 'log', 'line'] as const) {
    if (typeof record[key] === 'string' && record[key].trim().length > 0) {
      return record[key].trim()
    }
  }

  for (const key of ['body', 'data', 'payload', 'event', 'result', 'value', 'entry', 'entries', 'items', 'chunk'] as const) {
    const nested = resolveFallbackPayloadMessage(record[key], depth + 1)
    if (nested) {
      return nested
    }
  }

  try {
    const serialized = JSON.stringify(payload)
    return serialized && serialized.length > 0 ? serialized : null
  } catch {
    return null
  }
}

const STREAM_QUERY_BASE_OPTIONS = {
  refetchInterval: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: Infinity,
  retry: false,
} as const

const INSPECT_REFRESH_COOLDOWN_MS = 400

const INSPECT_REFRESH_ACTIONS = new Set([
  'create',
  'start',
  'stop',
  'die',
  'kill',
  'pause',
  'unpause',
  'restart',
  'rename',
  'destroy',
  'update',
  'health_status',
])

const CONTAINER_METRICS_STREAM_ACTIONS = ['metrics'] as const

const METRIC_CHART_WINDOW_SIZE = 40

const DOCKER_TIMESTAMP_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(.*)$/u
const DOCKER_TIMESTAMP_BOUNDARY_REGEX = /(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s)/gu
const LIVE_LOG_PAGE_SIZE = 100
const LIVE_LOG_INITIAL_PAGE_INDEX = 1
const LIVE_LOG_LIMIT = 20_000
const PROCESS_LOG_LIMIT = 300
const SECURITY_SCAN_EVENT_LIMIT = 800

interface DockerTerminalSessionState {
  sessionId: string
  profiles: DockerTerminalProfile[]
  output: string[]
  input: string
  closed: boolean
}

export function DockerContainerDetailModalTrigger({
  id,
  container = null,
  onContainerStateChange,
  children,
  className,
  initialTab = 'overview',
}: DockerContainerDetailModalTriggerProps) {
  // Trigger is intentionally tiny: it owns ONLY the open/close flag and
  // renders a button. The heavy modal content (20+ useState + ~10 queries
  // + 2k lines of JSX) lives in a separate function that is mounted
  // *only* while the dialog is open. Without this split, every cell of
  // the container table (60 rows × 3 triggers = 180 instances) would
  // run the full hook set on every SSE event, even when the user never
  // opens a single modal.
  const [open, setOpen] = useState(false)

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
  }, [])

  return (
    <>
      <button
        type="button"
        className={className ?? 'underline-offset-4 hover:underline text-left'}
        onClick={handleOpen}
      >
        {children}
      </button>
      {open ? (
        <DockerContainerDetailModalContent
          id={id}
          container={container}
          onContainerStateChange={onContainerStateChange}
          initialTab={initialTab}
          open={open}
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </>
  )
}

/**
 * Heavy container detail modal — only mounted while the dialog is open.
 * Owns all the state, queries, and JSX for the modal body. Splitting
 * this out from the trigger keeps the per-row trigger cost at O(1)
 * (just one button + one useState) instead of O(20+ useState + 10
 * useQuery + 2k JSX lines) per row.
 */
function DockerContainerDetailModalContent({
  id,
  container = null,
  onContainerStateChange,
  initialTab = 'overview',
  open,
  onOpenChange,
}: DockerContainerDetailModalContentProps) {
  // Sync the controlled `open` state with the trigger's intent: when
  // the user closes the modal, the trigger sets `open` to false which
  // unmounts this component entirely (no residual state).
  // `open` is read by the `<Dialog>` below to keep the radix portal in
  // sync with the trigger.
  void open
  const [activeTab, setActiveTab] = useState('overview')
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)
  const [streamingEnabled, setStreamingEnabled] = useState(true)
  const [logsHasMoreHistory, setLogsHasMoreHistory] = useState(true)
  const [logsHistoryPageIndex, setLogsHistoryPageIndex] = useState(LIVE_LOG_INITIAL_PAGE_INDEX)
  const [logsTimeRangeStart, setLogsTimeRangeStart] = useState<string | null>(null)
  const [logsTimeRangeEnd, setLogsTimeRangeEnd] = useState<string | null>(null)
  const [processesAutoRefresh, setProcessesAutoRefresh] = useState(true)
  const [expandedProcessPid, setExpandedProcessPid] = useState<number | null>(null)
  const [expandedProcessLogs, setExpandedProcessLogs] = useState<DockerContainerLogEntry[]>([])
  const [showRawCompose, setShowRawCompose] = useState(false)
  const [currentFilePath, setCurrentFilePath] = useState('/')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileActionNotice, setFileActionNotice] = useState<string | null>(null)
  const [fileBrowserMode, setFileBrowserMode] = useState<'container' | 'volume'>('container')
  const [selectedVolumePath, setSelectedVolumePath] = useState<string>('/')
  const [renameTarget, setRenameTarget] = useState<{ path: string; type: DockerFileEntry['type'] } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false)
  const [isEditFileOpen, setIsEditFileOpen] = useState(false)
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null)
  const [editingFileContent, setEditingFileContent] = useState('')
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const [terminalSessions, setTerminalSessions] = useState<DockerTerminalSessionState[]>([])
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const lastInspectRefreshAtRef = useRef(0)
  const lastInspectEventFingerprintRef = useRef<string | null>(null)
  const securityScanEventKeySetRef = useRef<Set<string>>(new Set())
  const securityScanEventKeyQueueRef = useRef<string[]>([])

  const activeTerminalSession = useMemo(() => {
    if (!activeTerminalSessionId) {
      return null
    }

    return terminalSessions.find((session) => session.sessionId === activeTerminalSessionId) ?? null
  }, [activeTerminalSessionId, terminalSessions])

  const containerMetricsStreamInput = useMemo(
    () => ({
      query: {
        filter: {
          containerId: {
            operator: 'eq' as const,
            value: id,
          },
          action: {
            operator: 'in' as const,
            value: [...CONTAINER_METRICS_STREAM_ACTIONS],
          },
        },
      },
    }),
    [id],
  )

  const containerLogsStreamInput = useMemo(
    () => ({
      query: {
        containerId: id,
        tail: LIVE_LOG_PAGE_SIZE,
        refreshIntervalMs: activeTab === 'logs' ? 400 : 2_000,
        ...(logsTimeRangeStart ? { since: logsTimeRangeStart } : {}),
        ...(logsTimeRangeEnd ? { until: logsTimeRangeEnd } : {}),
      },
    }),
    [activeTab, id, logsTimeRangeEnd, logsTimeRangeStart],
  )

  const containerLogsSnapshotInput = useMemo(
    () => ({
      query: {
        containerId: id,
        tail: LIVE_LOG_PAGE_SIZE * logsHistoryPageIndex,
        ...(logsTimeRangeStart ? { since: logsTimeRangeStart } : {}),
        ...(logsTimeRangeEnd ? { until: logsTimeRangeEnd } : {}),
      },
    }),
    [id, logsHistoryPageIndex, logsTimeRangeEnd, logsTimeRangeStart],
  )

  const containerProcessesStreamInput = useMemo(
    () => ({
      query: {
        containerId: id,
        refreshIntervalMs: 400,
      },
    }),
    [id],
  )

  const containerProcessLogsStreamInput = useMemo(
    () => ({
      query: {
        containerId: id,
        pid: expandedProcessPid ?? 0,
        tail: 300,
        refreshIntervalMs: 400,
      },
    }),
    [expandedProcessPid, id],
  )

  const terminalSessionStreamInput = useMemo(
    () => ({
      query: {
        sessionId: activeTerminalSessionId ?? '',
      },
    }),
    [activeTerminalSessionId],
  )

  const metricsStreamOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: open && activeTab === 'overview',
    }),
    [activeTab, open],
  )

  const logsStreamOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: open && streamingEnabled,
    }),
    [open, streamingEnabled],
  )

  const processesStreamOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: open && activeTab === 'processes',
    }),
    [activeTab, open],
  )

  const processLogsStreamOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: open && activeTab === 'processes' && expandedProcessPid !== null,
    }),
    [activeTab, expandedProcessPid, open],
  )

  const terminalStreamOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: open && activeTab === 'terminal' && activeTerminalSessionId !== null && !activeTerminalSession?.closed,
    }),
    [activeTab, activeTerminalSession?.closed, activeTerminalSessionId, open],
  )

  const containerMetricsStreamQuery = useDockerContainerEventsStream(containerMetricsStreamInput, metricsStreamOptions)
  const inspectQueryOptions = useMemo(
    () => ({
      ...STREAM_QUERY_BASE_OPTIONS,
      enabled: open,
    }),
    [open],
  )
  const inspectQuery = useDockerContainerInspect(
    {
      query: {
        containerId: id,
      },
    },
    inspectQueryOptions,
  )
  const refetchInspect = inspectQuery.refetch
  const containerLogsSnapshotQuery = useDockerContainerLogsSnapshot(
    containerLogsSnapshotInput,
    {
      enabled: open && activeTab === 'logs',
    },
  )
  const containerLogsStreamQuery = useDockerContainerLogsStream(containerLogsStreamInput, logsStreamOptions)
  const containerProcessesStreamQuery = useDockerContainerProcessesStream(containerProcessesStreamInput, processesStreamOptions)
  const containerProcessLogsStreamQuery = useDockerContainerProcessLogsStream(containerProcessLogsStreamInput, processLogsStreamOptions)
  const filesQuery = useDockerContainerFiles(
    {
      query: {
        containerId: id,
        path: currentFilePath,
      },
    },
    {
      enabled: open && activeTab === 'files',
    },
  )
  const selectedFileQuery = useDockerContainerReadFile(
    {
      query: {
        containerId: id,
        path: selectedFilePath ?? '/',
      },
    },
    {
      enabled: open && activeTab === 'files' && selectedFilePath !== null,
    },
  )

  const writeFileMutation = useDockerWriteContainerFile()
  const deletePathMutation = useDockerDeleteContainerPath()
  const renamePathMutation = useDockerRenameContainerPath()
  const createDirectoryMutation = useDockerCreateContainerDirectory()
  const runContainerActionMutation = useDockerRunContainerAction()
  const openTerminalSessionMutation = useDockerOpenContainerTerminalSession()
  const sendTerminalInputMutation = useDockerSendContainerTerminalInput()
  const closeTerminalSessionMutation = useDockerCloseContainerTerminalSession()
  const terminalSessionStreamQuery = useDockerContainerTerminalSessionStream(terminalSessionStreamInput, terminalStreamOptions)
  const inspectDetail = useMemo(() => {
    const parsed = dockerContainerInspectDetailSchema.safeParse(inspectQuery.data)
    return parsed.success ? parsed.data : null
  }, [inspectQuery.data])

  const detail = useMemo<DockerContainer | null>(() => {
    if (container) {
      return container
    }

    if (!inspectDetail) {
      return null
    }

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
      createdAt: inspectDetail.generatedAt,
      updatedAt: inspectDetail.generatedAt,
    }
  }, [container, id, inspectDetail])

  const securityImageInspectQuery = useDockerImageInspect(
    {
      query: {
        imageId: detail?.imageId ?? '__missing-image-id__',
      },
    },
    {
      enabled:
        open
        && (activeTab === 'security' || activeTab === 'layers')
        && typeof detail?.imageId === 'string'
        && detail.imageId.length > 0,
    },
  )

  const securityScanStreamQuery = useDockerImageSecurityScanStream(
    {
      query: {
        imageId: detail?.imageId ?? '__missing-image-id__',
        refreshIntervalMs: 500,
      },
    },
    {
      enabled:
        open
        && activeTab === 'security'
        && typeof detail?.imageId === 'string'
        && detail.imageId.length > 0,
    },
  )

  const securityImageInspectDetail = useMemo(() => {
    const parsed = dockerImageInspectDetailSchema.safeParse(securityImageInspectQuery.data)
    return parsed.success ? parsed.data : null
  }, [securityImageInspectQuery.data])

  const securityVulnerabilities = useMemo<DockerVulnerabilityEntry[]>(
    () => securityImageInspectDetail?.vulnerabilities ?? [],
    [securityImageInspectDetail?.vulnerabilities],
  )

  const securitySeverityCounts = useMemo(() => {
    return securityVulnerabilities.reduce(
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
  }, [securityVulnerabilities])

  const isDetailLoading = inspectQuery.isLoading && !detail

  const baseLogs = useMemo<DockerContainerLogEntry[]>(() => {
    return []
  }, [])

  const baseMetrics = useMemo<DockerContainerMetricPoint[]>(() => {
    if (!detail) return []

    const now = Date.now()
    const cpu = detail.cpuPercent ?? 0
    const memory = detail.memoryPercent ?? 0

    return Array.from({ length: 24 }).map((_, index) => {
      const at = new Date(now - (23 - index) * 60_000).toISOString()
      return {
        at,
        cpu,
        memory,
        networkRxKb: 0,
        networkTxKb: 0,
        ioReadKb: 0,
        ioWriteKb: 0,
      }
    })
  }, [detail])

  const baseProcesses = useMemo(() => inspectDetail?.processes ?? [], [inspectDetail?.processes])
  const defaultTerminalProfiles = useMemo<DockerTerminalProfile[]>(() => {
    const user = inspectDetail?.runtimeConfig.user ?? 'root'
    const workingDir = inspectDetail?.runtimeConfig.workingDir ?? '/'

    return [
      { shell: 'bash', user, workingDir, recommended: true },
      { shell: 'sh', user, workingDir, recommended: false },
    ]
  }, [inspectDetail?.runtimeConfig.user, inspectDetail?.runtimeConfig.workingDir])

  const containerMetricsEvent = containerMetricsStreamQuery.event ?? null

  const [liveLogs, setLiveLogs] = useState(baseLogs)
  const [liveMetrics, setLiveMetrics] = useState(baseMetrics)
  const [liveProcesses, setLiveProcesses] = useState(baseProcesses)
  const [securityScanEvents, setSecurityScanEvents] = useState<DockerImageSecurityScanEvent[]>([])
  const [filesState, setFilesState] = useState<DockerFileEntry[]>([])
  const [lastMetricAt, setLastMetricAt] = useState<string | null>(null)
  const [lastRuntimeContainerEventAt, setLastRuntimeContainerEventAt] = useState<string | null>(null)
  const [lastRuntimeContainerAction, setLastRuntimeContainerAction] = useState<string | null>(null)

  const runtimeStreamStatus = useMemo<'idle' | 'shared' | 'live'>(() => {
    if (!open) return 'idle'
    if (lastRuntimeContainerEventAt) return 'live'
    return 'shared'
  }, [lastRuntimeContainerEventAt, open])

  function matchesRuntimeTarget(payloadContainerId: string | null, payloadContainerName: string | null): boolean {
    const normalizedPayloadId = payloadContainerId?.trim() ?? null
    const normalizedTargetId = id.trim()
    const normalizedPayloadName = payloadContainerName?.trim().replace(/^\/+/, '') ?? null
    const normalizedTargetName = detail?.name.trim().replace(/^\/+/, '') ?? null

    const idMatches =
      normalizedPayloadId !== null
      && (
        normalizedPayloadId === normalizedTargetId
        || normalizedTargetId.startsWith(normalizedPayloadId)
        || normalizedPayloadId.startsWith(normalizedTargetId)
      )

    const nameMatches =
      normalizedPayloadName !== null
      && normalizedTargetName !== null
      && normalizedPayloadName === normalizedTargetName

    return idMatches || nameMatches
  }

  function explodeCompositeLogEntry(entry: DockerContainerLogEntry): DockerContainerLogEntry[] {
    const normalizedMessage = entry.message.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    if (normalizedMessage.length === 0) {
      return [entry]
    }

    const lineReadyMessage = normalizedMessage.includes('\n')
      ? normalizedMessage
      : normalizedMessage.replace(DOCKER_TIMESTAMP_BOUNDARY_REGEX, '\n').trimStart()

    const lines = lineReadyMessage
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (lines.length <= 1) {
      return [
        {
          ...entry,
          message: normalizedMessage,
        },
      ]
    }

    return lines.map((line, index) => {
      const timestampMatch = DOCKER_TIMESTAMP_PREFIX_REGEX.exec(line)
      const timestamp = timestampMatch?.[1] ? new Date(timestampMatch[1]).toISOString() : entry.timestamp
      const message = timestampMatch?.[2] ?? line

      const inferredLevel: DockerContainerLogEntry['level'] = /\b(error|fatal|panic)\b/iu.test(message)
        ? 'error'
        : /\b(warn|warning)\b/iu.test(message)
          ? 'warn'
          : entry.level

      const inferredStream: DockerContainerLogEntry['stream'] = /\bstderr\b/iu.test(message)
        ? 'stderr'
        : entry.stream

      return {
        ...entry,
        id: `${entry.id}:${String(index)}`,
        timestamp,
        stream: inferredStream,
        level: inferredLevel,
        message,
      }
    })
  }

  function parseLogTimestamp(value: string): number {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function mergeContainerLogsWithLimit(
    entries: DockerContainerLogEntry[],
    limit: number,
  ): DockerContainerLogEntry[] {
    if (entries.length === 0) {
      return entries
    }

    const dedupedByKey = new Map<string, DockerContainerLogEntry>()
    for (const entry of entries) {
      const key = `${entry.timestamp}|${entry.stream}|${entry.message}`
      dedupedByKey.set(key, entry)
    }

    const ordered = Array.from(dedupedByKey.values()).sort(
      (left, right) => parseLogTimestamp(left.timestamp) - parseLogTimestamp(right.timestamp),
    )

    if (ordered.length <= limit) {
      return ordered
    }

    return ordered.slice(-limit)
  }

  function getModeRootPath(): string {
    return fileBrowserMode === 'volume' ? selectedVolumePath : '/'
  }

  function handleFileDownload(path: string): void {
    const content = selectedFileQuery.data?.content
    if (!content) {
      setFileActionNotice(`No file content available for ${path}`)
      return
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = path.split('/').pop() ?? 'container-file.txt'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)

    setFileActionNotice(`Downloaded ${path}`)
  }

  function handleFileDelete(path: string, type: DockerFileEntry['type']): void {
    deletePathMutation.mutate(
      {
        containerId: id,
        path,
      },
      {
        onSuccess: () => {
          setSelectedFilePath((previous) => (previous && (previous === path || previous.startsWith(`${path}/`)) ? null : previous))
          setCurrentFilePath((previous) => {
            if (previous === path || previous.startsWith(`${path}/`)) {
              return getParentPath(path)
            }
            return previous
          })
          setFileActionNotice(`Deleted ${path}`)
          void filesQuery.refetch()
        },
        onError: (error) => {
          setFileActionNotice(`Delete failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      },
    )
  }

  function handleFileRename(path: string, type: DockerFileEntry['type']): void {
    const currentName = getEntryName(path)
    setRenameTarget({ path, type })
    setRenameInput(currentName)
  }

  function confirmFileRename(): void {
    if (!renameTarget) return
    const currentName = getEntryName(renameTarget.path)
    const nextName = renameInput.trim()
    if (!nextName || nextName === currentName) {
      setRenameTarget(null)
      setRenameInput('')
      return
    }

    const currentPath = renameTarget.path
    const type = renameTarget.type
    const parentPath = getParentPath(currentPath)
    const nextPath = parentPath === '/' ? `/${nextName}` : `${parentPath}/${nextName}`

    renamePathMutation.mutate(
      {
        containerId: id,
        path: currentPath,
        nextPath,
      },
      {
        onSuccess: () => {
          setSelectedFilePath((previous) => {
            if (!previous) return previous
            if (previous === currentPath) return nextPath
            if (type === 'dir' && previous.startsWith(`${currentPath}/`)) {
              return `${nextPath}${previous.slice(currentPath.length)}`
            }
            return previous
          })
          setCurrentFilePath((previous) => {
            if (previous === currentPath) return nextPath
            if (type === 'dir' && previous.startsWith(`${currentPath}/`)) {
              return `${nextPath}${previous.slice(currentPath.length)}`
            }
            return previous
          })
          setFileActionNotice(`Renamed ${currentName} to ${nextName}`)
          setRenameTarget(null)
          setRenameInput('')
          void filesQuery.refetch()
        },
        onError: (error) => {
          setFileActionNotice(`Rename failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      },
    )
  }

  function handleFileChmod(path: string, type: DockerFileEntry['type']): void {
    void type
    setFileActionNotice(`chmod is not available yet for ${path}`)
  }

  function handleCreateFolder(): void {
    const safeFolderName = toSafePathName(newFolderName)
    if (!safeFolderName) return

    const nextPath = currentFilePath === '/'
      ? `/${safeFolderName}`
      : `${currentFilePath.replace(/\/$/, '')}/${safeFolderName}`

    const exists = filesState.some((entry) => entry.path === nextPath)
    if (exists) {
      setFileActionNotice(`Cannot create ${safeFolderName}: already exists`)
      return
    }

    createDirectoryMutation.mutate(
      {
        containerId: id,
        path: nextPath,
      },
      {
        onSuccess: () => {
          setFileActionNotice(`Folder created: ${nextPath}`)
          setNewFolderName('')
          setIsCreateFolderOpen(false)
          void filesQuery.refetch()
        },
        onError: (error) => {
          setFileActionNotice(`Create folder failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      },
    )
  }

  function openEditFileModal(): void {
    if (!selectedFile) return
    setEditingFilePath(selectedFile.path)
    setEditingFileContent(selectedFileContent)
    setIsEditFileOpen(true)
  }

  function saveEditedFile(): void {
    if (!editingFilePath) return
    writeFileMutation.mutate(
      {
        containerId: id,
        path: editingFilePath,
        content: editingFileContent,
        createParents: true,
      },
      {
        onSuccess: () => {
          setFileActionNotice(`Saved ${editingFilePath}`)
          setIsEditFileOpen(false)
          setEditingFilePath(null)
          void selectedFileQuery.refetch()
          void filesQuery.refetch()
        },
        onError: (error) => {
          setFileActionNotice(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      },
    )
  }

  function handleUploadFiles(files: FileList | null): void {
    if (!files || files.length === 0) return
    const validFiles = Array.from(files).filter((file) => file.name.trim().length > 0)
    if (validFiles.length === 0) return

    void Promise.all(
      validFiles.map(async (file) => {
        const basePath = currentFilePath === '/' ? '' : currentFilePath.replace(/\/$/, '')
        const safeName = file.name.replace(/\//g, '-')
        const targetPath = `${basePath}/${safeName}`
        const content = await file.text()

        return writeFileMutation.mutateAsync({
          containerId: id,
          path: targetPath,
          content,
          createParents: true,
        })
      }),
    )
      .then(() => {
        setFileActionNotice(`Uploaded ${String(validFiles.length)} file${validFiles.length > 1 ? 's' : ''} to ${currentFilePath}`)
        void filesQuery.refetch()
      })
      .catch((error) => {
        setFileActionNotice(`Upload failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  function queueContainerOp(action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove'): void {
    runContainerActionMutation.mutate(
      {
        containerId: id,
        action,
      },
      {
        onSuccess: async () => {
          setOpsNotice(`${action} completed for ${detail?.name ?? id}`)
          toast.success(`${action} completed`, {
            description: detail?.name ?? id,
          })

          await Promise.all([
            refetchInspect(),
            onContainerStateChange ? Promise.resolve(onContainerStateChange()) : Promise.resolve(),
          ])
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error)
          setOpsNotice(`${action} failed for ${detail?.name ?? id}: ${message}`)
          toast.error(`${action} failed`, {
            description: message,
          })
        },
      },
    )
  }

  function resolveTerminalWorkingDirForEntry(path: string, type: DockerFileEntry['type']): string {
    return type === 'dir' ? path : getParentPath(path)
  }

  function escapeShellPath(pathValue: string): string {
    return `'${pathValue.replace(/'/g, `'"'"'`)}'`
  }

  function appendTerminalChunk(sessionId: string, chunk: string): void {
    setTerminalSessions((previous) => previous.map((session) => {
      if (session.sessionId !== sessionId) {
        return session
      }

      return {
        ...session,
        output: [...session.output, chunk].slice(-1200),
      }
    }))
  }

  function createTerminalSession(workingDir?: string): void {
    if (openTerminalSessionMutation.isPending) {
      return
    }

    openTerminalSessionMutation.mutate(
      {
        containerId: id,
        shell: 'sh',
        user: inspectDetail?.runtimeConfig.user ?? 'root',
        workingDir: workingDir ?? inspectDetail?.runtimeConfig.workingDir ?? '/',
      },
      {
        onSuccess: (response) => {
          const body = response.body
          const nextSession: DockerTerminalSessionState = {
            sessionId: body.sessionId,
            profiles: body.profiles.length > 0 ? body.profiles : defaultTerminalProfiles,
            output: [],
            input: '',
            closed: false,
          }

          setTerminalSessions((previous) => {
            if (previous.some((session) => session.sessionId === nextSession.sessionId)) {
              return previous
            }
            return [...previous, nextSession]
          })
          setActiveTerminalSessionId(nextSession.sessionId)
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error)
          toast.error('Failed to open terminal session', { description: message })
        },
      },
    )
  }

  function closeTerminalSession(sessionId: string): void {
    const session = terminalSessions.find((candidate) => candidate.sessionId === sessionId)

    if (session && !session.closed) {
      closeTerminalSessionMutation.mutate({ sessionId })
    }

    setTerminalSessions((previous) => {
      const remaining = previous.filter((candidate) => candidate.sessionId !== sessionId)
      setActiveTerminalSessionId((current) => (current === sessionId ? (remaining[0]?.sessionId ?? null) : current))
      return remaining
    })
  }

  function sendInputToTerminalSession(sessionId: string, input: string): void {
    if (input.length === 0) {
      return
    }

    sendTerminalInputMutation.mutate(
      {
        sessionId,
        input,
      },
      {
        onError: (error) => {
          appendTerminalChunk(sessionId, `\r\n[error] ${error instanceof Error ? error.message : String(error)}\r\n`)
        },
      },
    )
  }

  function sendTerminalCommand(): void {
    if (!activeTerminalSession || activeTerminalSession.closed || activeTerminalSession.input.trim().length === 0) {
      return
    }

    const commandPayload = activeTerminalSession.input.endsWith('\n')
      ? activeTerminalSession.input
      : `${activeTerminalSession.input}\n`

    sendInputToTerminalSession(activeTerminalSession.sessionId, commandPayload)

    setTerminalSessions((previous) => previous.map((session) => {
      if (session.sessionId !== activeTerminalSession.sessionId) {
        return session
      }

      return {
        ...session,
        input: '',
      }
    }))
  }

  function sendTerminalControlInput(value: string): void {
    if (!activeTerminalSession || activeTerminalSession.closed) {
      return
    }

    sendInputToTerminalSession(activeTerminalSession.sessionId, value)
  }

  function handleActiveTerminalInputChange(value: string): void {
    if (!activeTerminalSessionId) {
      return
    }

    setTerminalSessions((previous) => previous.map((session) => {
      if (session.sessionId !== activeTerminalSessionId) {
        return session
      }

      return {
        ...session,
        input: value,
      }
    }))
  }

  function clearActiveTerminalOutput(): void {
    if (!activeTerminalSessionId) {
      return
    }

    setTerminalSessions((previous) => previous.map((session) => {
      if (session.sessionId !== activeTerminalSessionId) {
        return session
      }

      return {
        ...session,
        output: [],
      }
    }))
  }

  function handleGoToTerminalPath(path: string, type: DockerFileEntry['type']): void {
    const targetWorkingDir = resolveTerminalWorkingDirForEntry(path, type)
    setActiveTab('terminal')

    if (activeTerminalSession && !activeTerminalSession.closed) {
      const command = `cd ${escapeShellPath(targetWorkingDir)}\n`
      sendInputToTerminalSession(activeTerminalSession.sessionId, command)
      return
    }

    createTerminalSession(targetWorkingDir)
  }

  function handleOpenNewTerminalAtPath(path: string, type: DockerFileEntry['type']): void {
    const targetWorkingDir = resolveTerminalWorkingDirForEntry(path, type)
    setActiveTab('terminal')
    createTerminalSession(targetWorkingDir)
  }

  const volumeMounts = useMemo<Array<{ label: string; path: string; source: string; mode: 'ro' | 'rw' }>>(() => {
    const mounts = inspectDetail?.mounts ?? []
    const volumes = mounts.filter((mount) => mount.type === 'volume')
    return volumes.map((mount) => ({
      label: mount.target,
      path: mount.target,
      source: mount.source,
      mode: mount.readOnly ? 'ro' : 'rw',
    }))
  }, [inspectDetail?.mounts])

  const effectiveFiles = useMemo(() => {
    if (fileBrowserMode === 'container') return filesState
    const root = selectedVolumePath.replace(/\/$/, '') || '/'
    return filesState.filter((entry) => entry.path === root || entry.path.startsWith(`${root}/`))
  }, [fileBrowserMode, filesState, selectedVolumePath])

  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null
    return effectiveFiles.find((entry) => entry.path === selectedFilePath && entry.type === 'file') ?? null
  }, [effectiveFiles, selectedFilePath])

  const selectedFileContent = useMemo(() => {
    if (!selectedFile) return ''
    return selectedFileQuery.data?.content ?? ''
  }, [selectedFile, selectedFileQuery.data?.content])

  const metricSummary = useMemo(() => {
    const cpuSeries = liveMetrics.map((point) => point.cpu)
    const memSeries = liveMetrics.map((point) => point.memory)
    const rxSeries = liveMetrics.map((point) => point.networkRxKb)
    const txSeries = liveMetrics.map((point) => point.networkTxKb)

    const cpuPeak = cpuSeries.length > 0 ? Math.max(...cpuSeries) : 0
    const memPeak = memSeries.length > 0 ? Math.max(...memSeries) : 0
    const rxPeak = rxSeries.length > 0 ? Math.max(...rxSeries) : 0
    const txPeak = txSeries.length > 0 ? Math.max(...txSeries) : 0

    const cpuCurrent = cpuSeries.length > 0 ? cpuSeries[cpuSeries.length - 1] ?? 0 : 0
    const memCurrent = memSeries.length > 0 ? memSeries[memSeries.length - 1] ?? 0 : 0
    const rxCurrent = rxSeries.length > 0 ? rxSeries[rxSeries.length - 1] ?? 0 : 0
    const txCurrent = txSeries.length > 0 ? txSeries[txSeries.length - 1] ?? 0 : 0

    return {
      cpuPeak,
      memPeak,
      rxPeak,
      txPeak,
      cpuCurrent,
      memCurrent,
      rxCurrent,
      txCurrent,
      rxTotal: rxSeries.reduce((sum, value) => sum + value, 0),
      txTotal: txSeries.reduce((sum, value) => sum + value, 0),
    }
  }, [liveMetrics])

  const metricChartData = useMemo(() => {
    const parseMetricTimestamp = (timestamp: string): number => {
      const parsed = Date.parse(timestamp)
      return Number.isNaN(parsed) ? 0 : parsed
    }

    const ordered = [...liveMetrics]
      .sort((left, right) => parseMetricTimestamp(left.at) - parseMetricTimestamp(right.at))
      .slice(-METRIC_CHART_WINDOW_SIZE)

    return ordered.map((point, index) => {
      const baseTick = point.at.slice(11, 19)
      const decimal = point.at.slice(20, 21)

      return {
        tick: `${baseTick}.${decimal}`,
        index,
        cpu: Number(point.cpu.toFixed(1)),
        memory: Number(point.memory.toFixed(1)),
      }
    })
  }, [liveMetrics])

  const orchestrator = useMemo<'compose' | 'swarm' | 'kubernetes'>(() => {
    const label = inspectDetail?.composeConfig?.labels['orchestrator.runtime']?.toLowerCase() ?? ''
    if (label.includes('swarm')) return 'swarm'
    if (label.includes('k8') || label.includes('kube')) return 'kubernetes'
    return 'compose'
  }, [inspectDetail?.composeConfig?.labels])

  const composeRows = useMemo<{ key: string; value: string }[]>(() => {
    const compose = inspectDetail?.composeConfig
    if (!compose) return []
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
        { key: 'Memory request/limit', value: compose.memReservationMb && compose.memLimitMb ? `${String(compose.memReservationMb)} / ${String(compose.memLimitMb)} MB` : '—' },
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
  }, [inspectDetail?.composeConfig, orchestrator])

  const containerLayers = useMemo(() => {
    if (inspectDetail?.layers && inspectDetail.layers.length > 0) {
      return inspectDetail.layers
    }

    if (securityImageInspectDetail?.layers && securityImageInspectDetail.layers.length > 0) {
      return securityImageInspectDetail.layers
    }

    return getMockImageLayers(detail?.imageId ?? id)
  }, [detail?.imageId, id, inspectDetail?.layers, securityImageInspectDetail?.layers])

  function layerStatus(layerId: string): 'verified' | 'cached' | 'warning' | 'pending' {
    let hash = 0
    for (let i = 0; i < layerId.length; i += 1) hash = (hash * 31 + layerId.charCodeAt(i)) >>> 0
    const hasHighRisk = securityVulnerabilities.some((entry) => entry.severity === 'critical' || entry.severity === 'high')
    if (hasHighRisk && hash % 4 === 0) return 'warning'
    if (hash % 5 === 0) return 'pending'
    if (hash % 3 === 0) return 'cached'
    return 'verified'
  }

  function layerStatusVariant(status: 'verified' | 'cached' | 'warning' | 'pending'): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'verified') return 'default'
    if (status === 'cached') return 'secondary'
    if (status === 'warning') return 'destructive'
    return 'outline'
  }

  useEffect(() => {
    setLiveLogs(baseLogs)
  }, [baseLogs])

  useEffect(() => {
    if (!containerLogsSnapshotQuery.data) {
      return
    }

    const snapshotEntries = containerLogsSnapshotQuery.data.entries
      .flatMap((entry) => explodeCompositeLogEntry(entry))

    setLiveLogs((previous) => mergeContainerLogsWithLimit([...snapshotEntries, ...previous], LIVE_LOG_LIMIT))

    const requestedTailSize = LIVE_LOG_PAGE_SIZE * logsHistoryPageIndex

    if (snapshotEntries.length < requestedTailSize) {
      setLogsHasMoreHistory(false)
      return
    }

    const earliestTimestamp = snapshotEntries[0]?.timestamp
    if (!logsTimeRangeStart || !earliestTimestamp) {
      setLogsHasMoreHistory(true)
      return
    }

    const earliestMillis = Date.parse(earliestTimestamp)
    const rangeStartMillis = Date.parse(logsTimeRangeStart)

    if (!Number.isFinite(earliestMillis) || !Number.isFinite(rangeStartMillis)) {
      setLogsHasMoreHistory(true)
      return
    }

    setLogsHasMoreHistory(earliestMillis > rangeStartMillis)
  }, [
    containerLogsSnapshotQuery.data,
    logsHistoryPageIndex,
    logsTimeRangeStart,
  ])

  useEffect(() => {
    setLiveMetrics(baseMetrics)
  }, [baseMetrics])

  useEffect(() => {
    if (!streamingEnabled || !containerLogsStreamQuery.data) return

    debugDockerModalLogs('containerLogsPayloadReceived', {
      tab: activeTab,
      open,
      streamingEnabled,
      dataShape: Array.isArray(containerLogsStreamQuery.data) ? 'array' : typeof containerLogsStreamQuery.data,
      fetchStatus: containerLogsStreamQuery.fetchStatus,
      isLoading: containerLogsStreamQuery.isLoading,
      liveLogsCount: liveLogs.length,
    })

    const payloads = Array.isArray(containerLogsStreamQuery.data)
      ? containerLogsStreamQuery.data
      : [containerLogsStreamQuery.data]

    const nextPayloads = payloads

    if (nextPayloads.length === 0) {
      return
    }

    const normalizedEntries: DockerContainerLogEntry[] = []

    nextPayloads.forEach((payload, payloadIndex) => {
      const extracted = extractContainerLogEntries(payload)
        .flatMap((entry) => explodeCompositeLogEntry(entry))

      if (extracted.length === 0) {
        const fallbackMessage = resolveFallbackPayloadMessage(payload)
        if (fallbackMessage) {
          const normalizedMessage = fallbackMessage.length > 2_000
            ? `${fallbackMessage.slice(0, 2_000)}…`
            : fallbackMessage

          normalizedEntries.push({
            id: `modal:${id}:fallback:${String(payloadIndex)}:${normalizedMessage.slice(0, 120)}`,
            timestamp: new Date().toISOString(),
            stream: 'stdout',
            level: 'info',
            message: normalizedMessage,
          })

          debugDockerModalLogs('containerLogsFallbackUsed', {
            payloadIndex,
            preview: normalizedMessage.slice(0, 180),
          })
        }
      }

      normalizedEntries.push(...extracted)
    })

    debugDockerModalLogs('containerLogsParsed', {
      payloadCount: nextPayloads.length,
      parsedCount: normalizedEntries.length,
    })

    if (normalizedEntries.length === 0) {
      debugDockerModalLogs('containerLogsNoEntriesAfterParse', {
        payloadCount: nextPayloads.length,
      })
      return
    }

    setLiveLogs((previous) => {
      const merged = mergeContainerLogsWithLimit([...previous, ...normalizedEntries], LIVE_LOG_LIMIT)

      debugDockerModalLogs('containerLogsMerged', {
        previousCount: previous.length,
        incomingCount: normalizedEntries.length,
        mergedCount: merged.length,
      })

      return merged
    })
  }, [
    activeTab,
    containerLogsStreamQuery.data,
    containerLogsStreamQuery.fetchStatus,
    containerLogsStreamQuery.isLoading,
    id,
    liveLogs.length,
    open,
    streamingEnabled,
  ])

  useEffect(() => {
    securityScanEventKeySetRef.current = new Set()
    securityScanEventKeyQueueRef.current = []
    setSecurityScanEvents([])
  }, [detail?.imageId])

  useEffect(() => {
    const events = securityScanStreamQuery.events
    if (events.length === 0) {
      return
    }

    for (const event of events) {
      setSecurityScanEvents((previous) => {
        const key = [
          event.timestamp,
          event.type,
          event.stage,
          event.scanner ?? 'none',
          event.message,
          event.logLine ?? '',
        ].join('|')

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
          const droppedKey = securityScanEventKeyQueueRef.current.shift()
          if (droppedKey) {
            securityScanEventKeySetRef.current.delete(droppedKey)
          }
        }

        return next
      })
    }
  }, [securityScanStreamQuery.events])

  useDockerRuntimeEventSubscriber({
    enabled: open,
    cooldownMs: INSPECT_REFRESH_COOLDOWN_MS,
    filter: (event) => {
      if (event.source !== 'container') {
        return false
      }

      if (!INSPECT_REFRESH_ACTIONS.has(event.action)) {
        return false
      }

      return matchesRuntimeTarget(event.payload.containerId, event.payload.containerName)
    },
    onEvent: (event) => {
      const fingerprint = event.eventId
        ?? `${event.action}:${event.timestamp}`

      if (lastInspectEventFingerprintRef.current === fingerprint) {
        return
      }

      const now = Date.now()
      if (now - lastInspectRefreshAtRef.current < INSPECT_REFRESH_COOLDOWN_MS) {
        return
      }

      lastInspectEventFingerprintRef.current = fingerprint
      lastInspectRefreshAtRef.current = now
      setLastRuntimeContainerEventAt(event.timestamp)
      setLastRuntimeContainerAction(event.action)

      void Promise.all([
        refetchInspect(),
        onContainerStateChange ? Promise.resolve(onContainerStateChange()) : Promise.resolve(),
      ])
    },
  })

  useEffect(() => {
    if (!containerMetricsEvent) return
    if (containerMetricsEvent.action !== 'metrics') return

    const payload = containerMetricsEvent.payload
    if (!matchesRuntimeTarget(payload.containerId, payload.containerName)) {
      return
    }

    const metricsPoint = payload.metrics

    if (!metricsPoint) {
      return
    }

    setLastMetricAt(metricsPoint.at)
    setLiveMetrics((previous) => [...previous, metricsPoint].slice(-120))
  }, [containerMetricsEvent, detail?.name, id])

  useEffect(() => {
    if (!processesAutoRefresh) return
    setLiveProcesses(baseProcesses)
  }, [baseProcesses, processesAutoRefresh])

  useEffect(() => {
    if (!processesAutoRefresh || !containerProcessesStreamQuery.data) {
      return
    }

    const snapshot = containerProcessesStreamQuery.data as { data?: unknown }
    if (!snapshot.data || !Array.isArray(snapshot.data)) {
      return
    }

    const parsed = snapshot.data
      .map((entry) => dockerContainerProcessEntrySchema.safeParse(entry))
      .filter((result): result is { success: true; data: DockerContainerProcessEntry } => result.success)
      .map((result) => result.data)

    setLiveProcesses(parsed)
  }, [containerProcessesStreamQuery.data, processesAutoRefresh])

  useEffect(() => {
    if (!containerProcessLogsStreamQuery.data || expandedProcessPid === null) {
      return
    }

    const payloads = Array.isArray(containerProcessLogsStreamQuery.data)
      ? containerProcessLogsStreamQuery.data
      : [containerProcessLogsStreamQuery.data]

    const nextPayloads = payloads

    if (nextPayloads.length === 0) {
      return
    }

    const normalizedEntries = nextPayloads
      .flatMap((payload) => extractContainerLogEntries(payload))
      .flatMap((entry) => explodeCompositeLogEntry(entry))

    if (normalizedEntries.length === 0) {
      return
    }

    setExpandedProcessLogs((previous) => {
      return mergeContainerLogsWithLimit([...previous, ...normalizedEntries], PROCESS_LOG_LIMIT)
    })
  }, [containerProcessLogsStreamQuery.data, expandedProcessPid])

  useEffect(() => {
    setExpandedProcessLogs([])
  }, [expandedProcessPid])

  useEffect(() => {
    const queryData = filesQuery.data
    if (!queryData) {
      return
    }

    setFilesState(queryData.entries)
  }, [filesQuery.data])

  useEffect(() => {
    if (!open || activeTab !== 'terminal' || terminalSessions.length > 0 || openTerminalSessionMutation.isPending) {
      return
    }

    createTerminalSession()
  }, [
    activeTab,
    open,
    openTerminalSessionMutation,
    terminalSessions.length,
  ])

  useEffect(() => {
    const currentSessionId = activeTerminalSessionId
    const event = terminalSessionStreamQuery.data as
      | { type?: 'output' | 'status' | 'error'; data?: string; timestamp?: string }
      | undefined

    if (!currentSessionId || !event || typeof event.data !== 'string') {
      return
    }

    const chunk = (() => {
      if (event.type === 'output') {
        return event.data
      }

      if (event.type === 'error') {
        return `\r\n[error] ${event.data}\r\n`
      }

      const prefix = event.timestamp ? `[${event.timestamp}] ` : ''
      return `\r\n${prefix}${event.data}\r\n`
    })()

    const shouldMarkClosed = event.type === 'status'
      && (() => {
        const normalizedStatus = event.data.toLowerCase()
        return normalizedStatus.includes('shell exited') || normalizedStatus.includes('shell closed') || normalizedStatus.includes('session closed')
      })()

    setTerminalSessions((previous) => previous.map((session) => {
      if (session.sessionId !== currentSessionId) {
        return session
      }

      return {
        ...session,
        closed: shouldMarkClosed ? true : session.closed,
        output: [...session.output, chunk].slice(-1200),
      }
    }))
  }, [activeTerminalSessionId, terminalSessionStreamQuery.data])

  useEffect(() => {
    if (!open && terminalSessions.length > 0) {
      terminalSessions
        .filter((session) => !session.closed)
        .forEach((session) => {
          closeTerminalSessionMutation.mutate({ sessionId: session.sessionId })
        })

      setTerminalSessions([])
      setActiveTerminalSessionId(null)
    }
  }, [closeTerminalSessionMutation, open, terminalSessions])

  useEffect(() => {
    setCurrentFilePath('/')
    setSelectedFilePath(null)
    setFileActionNotice(null)
    setFileBrowserMode('container')
    setSelectedVolumePath('/')
    setRenameTarget(null)
    setRenameInput('')
    setNewFolderName('')
    setIsCreateFolderOpen(false)
    setIsEditFileOpen(false)
    setEditingFilePath(null)
    setEditingFileContent('')
    setOpsNotice(null)
    setActiveTab(initialTab)
    setExpandedLayerId(null)
    setTerminalSessions([])
    setActiveTerminalSessionId(null)
    setLastMetricAt(null)
    setLastRuntimeContainerEventAt(null)
    setLastRuntimeContainerAction(null)
    setLiveLogs([])
    setLogsHasMoreHistory(true)
    setLogsHistoryPageIndex(LIVE_LOG_INITIAL_PAGE_INDEX)
    setLogsTimeRangeStart(null)
    setLogsTimeRangeEnd(null)
  }, [id, initialTab])

  useEffect(() => {
    if (volumeMounts.length === 0) {
      if (fileBrowserMode === 'volume') {
        setFileBrowserMode('container')
      }
      return
    }

    if (selectedVolumePath === '/' || !volumeMounts.some((volume) => volume.path === selectedVolumePath)) {
      setSelectedVolumePath(volumeMounts[0]?.path ?? '/')
    }
  }, [fileBrowserMode, selectedVolumePath, volumeMounts])

  useEffect(() => {
    if (fileBrowserMode === 'container') {
      if (currentFilePath === '/') return
      return
    }
    const nextRoot = selectedVolumePath || '/'
    if (currentFilePath === '/' || !currentFilePath.startsWith(nextRoot)) {
      setCurrentFilePath(nextRoot)
      setSelectedFilePath(null)
    }
  }, [currentFilePath, fileBrowserMode, selectedVolumePath])

  function handleLoadOlderLogs(): void {
    if (containerLogsSnapshotQuery.isFetching || !logsHasMoreHistory) {
      return
    }

    setLogsHistoryPageIndex((previous) => previous + 1)
  }

  function handleApplyLogsTimeRange(range: { start: string | null; end: string | null }): void {
    setLogsTimeRangeStart(range.start)
    setLogsTimeRangeEnd(range.end)
    setLogsHistoryPageIndex(LIVE_LOG_INITIAL_PAGE_INDEX)
    setLogsHasMoreHistory(true)
  }

  function handleClearLogsTimeRange(): void {
    setLogsTimeRangeStart(null)
    setLogsTimeRangeEnd(null)
    setLogsHistoryPageIndex(LIVE_LOG_INITIAL_PAGE_INDEX)
    setLogsHasMoreHistory(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[96vw]! max-w-350! h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>Container details</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
              </div>
              <DockerModalQuickActions
                actions={[
                  { label: 'Start', icon: Play, onClick: () => queueContainerOp('start') },
                  { label: 'Stop', icon: Square, onClick: () => queueContainerOp('stop') },
                  { label: 'Restart', icon: RotateCcw, onClick: () => queueContainerOp('restart') },
                  { label: 'Pause', icon: Pause, onClick: () => queueContainerOp('pause') },
                  { label: 'Unpause', icon: PlayCircle, onClick: () => queueContainerOp('unpause') },
                  { label: 'Kill', icon: Skull, onClick: () => queueContainerOp('kill') },
                ]}
                dangerAction={{ label: 'Remove', icon: Trash2, onClick: () => queueContainerOp('remove') }}
              />
            </div>
            {opsNotice ? <p className="text-xs text-muted-foreground">{opsNotice}</p> : null}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                inspect: {inspectQuery.isFetching ? 'loading' : inspectQuery.isError ? 'error' : 'ready'}
              </Badge>
              <Badge variant="outline">
                runtime stream: {runtimeStreamStatus}{lastRuntimeContainerAction ? ` (${lastRuntimeContainerAction})` : ''}
              </Badge>
              <Badge variant="outline">
                metrics: {lastMetricAt ? `last ${lastMetricAt.slice(11, 19)}` : 'waiting'}
              </Badge>
            </div>
          </DialogHeader>
          {detail ? (
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="layers">Layers</TabsTrigger>
                <TabsTrigger className="shrink-0" value="processes">Processes</TabsTrigger>
                <TabsTrigger className="shrink-0" value="logs">Logs</TabsTrigger>
                <TabsTrigger className="shrink-0" value="network">Network</TabsTrigger>
                <TabsTrigger className="shrink-0" value="mounts">Mounts</TabsTrigger>
                <TabsTrigger className="shrink-0" value="files">Files</TabsTrigger>
                <TabsTrigger className="shrink-0" value="env">Environment</TabsTrigger>
                <TabsTrigger className="shrink-0" value="config">Config</TabsTrigger>
                <TabsTrigger className="shrink-0" value="compose">Compose</TabsTrigger>
                <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
                <TabsTrigger className="shrink-0" value="terminal">Terminal</TabsTrigger>
                <TabsTrigger className="shrink-0" value="security">Security</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                {inspectQuery.isLoading && !inspectDetail ? (
                  <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                    Loading container runtime details…
                  </div>
                ) : (
                  <DockerContainerOverviewTab
                    detail={detail}
                    inspectDetail={inspectDetail}
                    metricSummary={metricSummary}
                    metricChartData={metricChartData}
                  />
                )}
              </TabsContent>

              <TabsContent value="layers" className="flex min-h-0 flex-col gap-3 text-sm">
                <DockerContainerLayersTab
                  containerLayers={containerLayers}
                  expandedLayerId={expandedLayerId}
                  securityVulnerabilitiesCount={securityVulnerabilities.length}
                  onToggleLayer={(layerId) => setExpandedLayerId((previous) => (previous === layerId ? null : layerId))}
                  layerStatus={layerStatus}
                  layerStatusVariant={layerStatusVariant}
                />
              </TabsContent>

              <TabsContent value="processes">
                {containerProcessesStreamQuery.isLoading && liveProcesses.length === 0 ? (
                  <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                    Loading process list…
                  </div>
                ) : (
                  <DockerContainerProcessesTab
                    liveProcesses={liveProcesses}
                    expandedProcessPid={expandedProcessPid}
                    expandedProcessLogs={expandedProcessLogs}
                    processesAutoRefresh={processesAutoRefresh}
                    onToggleAutoRefresh={() => setProcessesAutoRefresh((prev) => !prev)}
                    onToggleProcess={(pid) => setExpandedProcessPid((previous) => (previous === pid ? null : pid))}
                  />
                )}
              </TabsContent>

              <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col overflow-hidden!">
                {containerLogsSnapshotQuery.isLoading && liveLogs.length === 0 ? (
                  <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                    Connecting log stream…
                  </div>
                ) : (
                  <DockerContainerLogsTab
                    liveLogs={liveLogs}
                    streamingEnabled={streamingEnabled}
                    onToggleStreaming={() => setStreamingEnabled((prev) => !prev)}
                    onReset={() => {
                      setLiveLogs([])
                      setLogsHistoryPageIndex(LIVE_LOG_INITIAL_PAGE_INDEX)
                      setLogsHasMoreHistory(true)
                    }}
                    hasMoreHistory={logsHasMoreHistory}
                    isLoadingHistory={containerLogsSnapshotQuery.isFetching}
                    onLoadOlderLogs={handleLoadOlderLogs}
                    timeRange={{
                      start: logsTimeRangeStart,
                      end: logsTimeRangeEnd,
                    }}
                    onApplyTimeRange={handleApplyLogsTimeRange}
                    onClearTimeRange={handleClearLogsTimeRange}
                    streamingLogsSupported={inspectDetail?.streamingLogsSupported ?? false}
                  />
                )}
              </TabsContent>

              <TabsContent value="network" className="space-y-3 text-sm">
                <DockerContainerNetworkTab
                  networks={inspectDetail?.networkConfig ?? []}
                  portMappings={inspectDetail?.portMappings ?? []}
                />
              </TabsContent>

              <TabsContent value="mounts" className="flex min-h-0 flex-col gap-3 text-sm">
                <DockerContainerMountsTab mounts={inspectDetail?.mounts ?? []} />
              </TabsContent>

              <TabsContent value="files" className="flex min-h-0 flex-col gap-3 text-sm">
                <DockerContainerFilesTab
                  fileBrowserMode={fileBrowserMode}
                  volumeMounts={volumeMounts}
                  selectedVolumePath={selectedVolumePath}
                  currentFilePath={currentFilePath}
                  selectedFilePath={selectedFilePath}
                  selectedFile={selectedFile}
                  selectedFileContent={selectedFileContent}
                  effectiveFiles={effectiveFiles}
                  fileActionNotice={fileActionNotice}
                  uploadInputRef={uploadInputRef}
                  onSetFileBrowserMode={setFileBrowserMode}
                  onSetSelectedVolumePath={setSelectedVolumePath}
                  onSetCurrentFilePath={setCurrentFilePath}
                  onSetSelectedFilePath={setSelectedFilePath}
                  onOpenCreateFolder={() => setIsCreateFolderOpen(true)}
                  onTriggerUploadPicker={() => uploadInputRef.current?.click()}
                  onOpenEditFileModal={openEditFileModal}
                  onUploadFiles={handleUploadFiles}
                  modeRootPath={getModeRootPath()}
                  onRenameFile={handleFileRename}
                  onChmodFile={handleFileChmod}
                  onDownloadFile={handleFileDownload}
                  onDeletePath={handleFileDelete}
                  onGoToTerminalPath={handleGoToTerminalPath}
                  onOpenNewTerminalPath={handleOpenNewTerminalAtPath}
                />
              </TabsContent>

              <TabsContent value="env" className="flex min-h-0 flex-col gap-2 text-sm">
                <DockerContainerEnvTab environment={inspectDetail?.environment ?? []} />
              </TabsContent>

              <TabsContent value="config" className="space-y-3 text-sm">
                <DockerContainerConfigTab runtimeConfig={inspectDetail?.runtimeConfig ?? null} />
              </TabsContent>

              <TabsContent value="compose" className="flex min-h-0 flex-col gap-3 text-sm">
                <DockerContainerComposeTab
                  composeConfig={inspectDetail?.composeConfig ?? null}
                  orchestrator={orchestrator}
                  composeRows={composeRows}
                  showRawCompose={showRawCompose}
                  onToggleShowRawCompose={() => setShowRawCompose((previous) => !previous)}
                />
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                <DockerContainerLabelsTab
                  labels={[
                    { key: 'projectId', value: detail.projectId },
                    { key: 'serviceId', value: detail.serviceId },
                    { key: 'logsStreamId', value: detail.logsStreamId ?? '—' },
                  ]}
                />
              </TabsContent>

              <TabsContent value="terminal" className="flex min-h-0 flex-1 flex-col overflow-hidden!">
                <DockerContainerTerminalTab
                  terminalSessions={terminalSessions}
                  activeTerminalSessionId={activeTerminalSessionId}
                  isSending={sendTerminalInputMutation.isPending}
                  onCreateTerminalSession={() => {
                    createTerminalSession()
                  }}
                  onActivateTerminalSession={setActiveTerminalSessionId}
                  onCloseTerminalSession={closeTerminalSession}
                  onTerminalInputChange={handleActiveTerminalInputChange}
                  onSend={sendTerminalCommand}
                  onClearOutput={clearActiveTerminalOutput}
                  onSendControlInput={sendTerminalControlInput}
                />
              </TabsContent>

              <TabsContent value="security" className="space-y-2 text-sm">
                <DockerContainerSecurityTab
                  severityCounts={securitySeverityCounts}
                  imageId={detail?.imageId}
                  isFetching={securityImageInspectQuery.isFetching}
                  hasScannerDetail={Boolean(securityImageInspectDetail)}
                  errorMessage={securityImageInspectQuery.error instanceof Error ? securityImageInspectQuery.error.message : securityImageInspectQuery.error ? String(securityImageInspectQuery.error) : null}
                  scanSummary={securityImageInspectDetail?.scanSummary ?? null}
                  scanEvents={securityScanEvents}
                  scanStreamStatus={
                    securityScanStreamQuery.isError
                      ? 'error'
                      : securityScanStreamQuery.fetchStatus === 'fetching'
                        ? 'streaming'
                        : 'idle'
                  }
                  privileged={inspectDetail?.runtimeConfig.privileged ?? false}
                  readOnlyRootFs={inspectDetail?.runtimeConfig.readOnlyRootFs ?? false}
                  networkMode={inspectDetail?.runtimeConfig.networkMode ?? null}
                  health={detail.health}
                  vulnerabilities={securityVulnerabilities}
                />
              </TabsContent>

            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading container details…" />
          ) : (
            <p className="text-sm text-muted-foreground">Container not found.</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(openState: boolean) => {
        if (!openState) {
          setRenameTarget(null)
          setRenameInput('')
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.type === 'dir' ? 'folder' : 'file'}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{renameTarget?.path}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="file-rename-input">New name</label>
            <input
              id="file-rename-input"
              type="text"
              value={renameInput}
              autoFocus
              className="w-full rounded border bg-background px-3 py-2 text-sm"
              onChange={(event) => setRenameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  confirmFileRename()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setRenameTarget(null)
              setRenameInput('')
            }}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmFileRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">Location: {currentFilePath}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="new-folder-input">Folder name</label>
            <input
              id="new-folder-input"
              type="text"
              value={newFolderName}
              autoFocus
              className="w-full rounded border bg-background px-3 py-2 text-sm"
              placeholder="e.g. config"
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleCreateFolder()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setIsCreateFolderOpen(false)
              setNewFolderName('')
            }}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateFolder}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditFileOpen} onOpenChange={(openState: boolean) => {
        setIsEditFileOpen(openState)
        if (!openState) {
          setEditingFilePath(null)
        }
      }}>
        <DialogContent className="w-[92vw] max-w-4xl h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit file</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{editingFilePath ?? selectedFile?.path ?? 'No file selected'}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <textarea
              className="h-full w-full resize-none rounded border bg-background p-3 text-xs font-mono"
              value={editingFileContent}
              onChange={(event) => setEditingFileContent(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setIsEditFileOpen(false)
              setEditingFilePath(null)
            }}>
              Cancel
            </Button>
            <Button type="button" onClick={saveEditedFile}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
