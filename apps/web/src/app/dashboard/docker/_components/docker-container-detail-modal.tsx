'use client'

import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { getDockerEntityDetail } from '@/domains/docker/mock-hooks'
import {
  getMockContainerFiles,
  getMockContainerInspectDetail,
  getMockContainerLogs,
  getMockContainerMetrics,
  getMockContainerProcesses,
  getMockContainerTerminalProfiles,
  getMockImageLayers,
} from '@/mocks/platform/entities/docker.large.mock'
import type { DockerContainerLogEntry, DockerFileEntry } from '@/mocks/platform/types'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@repo/ui/components/shadcn/chart'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Download, FilePenLine, FolderPlus, HardDrive, Pause, Pencil, Play, PlayCircle, RotateCcw, Shield, Skull, Square, Trash2, Upload } from 'lucide-react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { DockerFileBrowser } from './docker-file-browser'
import { formatFileSize, getEntryName, getParentPath, toSafePathName } from './docker-filesystem-utils'
import { DockerModalQuickActions } from './docker-modal-quick-actions'

interface DockerContainerDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: string
}

const overviewChartConfig = {
  cpu: {
    label: 'CPU %',
    color: 'var(--chart-1)',
  },
  memory: {
    label: 'Memory %',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig

export function DockerContainerDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerContainerDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)
  const [streamingEnabled, setStreamingEnabled] = useState(true)
  const [processesAutoRefresh, setProcessesAutoRefresh] = useState(true)
  const [expandedProcessPid, setExpandedProcessPid] = useState<number | null>(null)
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
  const [editedFileContentByPath, setEditedFileContentByPath] = useState<Record<string, string>>({})
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const detail = useMemo(() => getDockerEntityDetail('containers', id).container, [id])
  const image = useMemo(() => (detail?.imageId ? getDockerEntityDetail('images', detail.imageId).image : undefined), [detail?.imageId])
  const inspectDetail = useMemo(() => (detail ? getMockContainerInspectDetail(detail, image) : null), [detail, image])
  const fallbackImageLayers = useMemo(() => {
    if (!detail?.imageId) return []
    return getMockImageLayers(detail.imageId)
  }, [detail?.imageId])

  const mockFiles = useMemo(() => getMockContainerFiles(id), [id])
  const baseLogs = useMemo(() => getMockContainerLogs(id), [id])
  const metrics = useMemo(() => getMockContainerMetrics(id), [id])
  const baseProcesses = useMemo(() => getMockContainerProcesses(id), [id])
  const terminalProfiles = useMemo(() => getMockContainerTerminalProfiles(id), [id])

  const [liveLogs, setLiveLogs] = useState(baseLogs)
  const [liveProcesses, setLiveProcesses] = useState(baseProcesses)
  const [filesState, setFilesState] = useState(mockFiles)
  const logTickRef = useRef(0)
  const processTickRef = useRef(0)

  function getModeRootPath(): string {
    return fileBrowserMode === 'volume' ? selectedVolumePath : '/'
  }

  function handleFileDownload(path: string): void {
    setFileActionNotice(`Download queued for ${path}`)
  }

  function handleFileDelete(path: string, type: DockerFileEntry['type']): void {
    setFilesState((previous) => previous.filter((entry) => {
      if (entry.path === path) return false
      if (type === 'dir' && entry.path.startsWith(`${path}/`)) return false
      return true
    }))

    setSelectedFilePath((previous) => (previous && (previous === path || previous.startsWith(`${path}/`)) ? null : previous))
    setCurrentFilePath((previous) => {
      if (previous === path || previous.startsWith(`${path}/`)) {
        return getParentPath(path)
      }
      return previous
    })
    setFileActionNotice(`Deleted ${path}`)
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

    const path = renameTarget.path
    const type = renameTarget.type
    const parentPath = getParentPath(path)
    const nextPath = parentPath === '/' ? `/${nextName}` : `${parentPath}/${nextName}`

    setFilesState((previous) => previous.map((entry) => {
      if (entry.path === path) {
        return { ...entry, path: nextPath }
      }
      if (type === 'dir' && entry.path.startsWith(`${path}/`)) {
        return { ...entry, path: `${nextPath}${entry.path.slice(path.length)}` }
      }
      return entry
    }))

    setSelectedFilePath((previous) => {
      if (!previous) return previous
      if (previous === path) return nextPath
      if (type === 'dir' && previous.startsWith(`${path}/`)) {
        return `${nextPath}${previous.slice(path.length)}`
      }
      return previous
    })
    setCurrentFilePath((previous) => {
      if (previous === path) return nextPath
      if (type === 'dir' && previous.startsWith(`${path}/`)) {
        return `${nextPath}${previous.slice(path.length)}`
      }
      return previous
    })
    setFileActionNotice(`Renamed ${currentName} to ${nextName}`)
    setRenameTarget(null)
    setRenameInput('')
  }

  function handleFileChmod(path: string, type: DockerFileEntry['type']): void {
    const mode = window.prompt('Set permission mode (e.g. 644, 755)', '644')?.trim()
    if (!mode) return
    const permission = type === 'dir' ? `drwxr-${mode}` : `-rw-r-${mode}`
    setFilesState((previous) => previous.map((entry) => {
      if (entry.path === path) return { ...entry, permissions: permission }
      return entry
    }))
    setFileActionNotice(`Permissions updated for ${path} → ${mode}`)
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

    const now = new Date().toISOString()
    const newFolderEntry: DockerFileEntry = {
      path: nextPath,
      type: 'dir',
      size: '4 KB',
      owner: 'root',
      permissions: 'drwxr-xr-x',
      updatedAt: now,
    }

    setFilesState((previous) => [...previous, newFolderEntry])
    setFileActionNotice(`Folder created: ${nextPath}`)
    setNewFolderName('')
    setIsCreateFolderOpen(false)
  }

  function openEditFileModal(): void {
    if (!selectedFile) return
    const existing = editedFileContentByPath[selectedFile.path]
    setEditingFilePath(selectedFile.path)
    setEditingFileContent(existing ?? selectedFileContent)
    setIsEditFileOpen(true)
  }

  function saveEditedFile(): void {
    if (!editingFilePath) return
    setEditedFileContentByPath((previous) => ({
      ...previous,
      [editingFilePath]: editingFileContent,
    }))
    setFileActionNotice(`Saved ${editingFilePath}`)
    setIsEditFileOpen(false)
    setEditingFilePath(null)
  }

  function handleUploadFiles(files: FileList | null): void {
    if (!files || files.length === 0) return
    const now = new Date().toISOString()
    const validFiles = Array.from(files).filter((file) => file.name.trim().length > 0)
    if (validFiles.length === 0) return

    const toCreate: DockerFileEntry[] = validFiles.map((file) => {
      const basePath = currentFilePath === '/' ? '' : currentFilePath.replace(/\/$/, '')
      const safeName = file.name.replace(/\//g, '-')
      return {
        path: `${basePath}/${safeName}`,
        type: 'file',
        size: formatFileSize(file.size),
        owner: 'root',
        permissions: '-rw-r--r--',
        updatedAt: now,
      }
    })

    setFilesState((previous) => {
      const existing = new Set(previous.map((entry) => entry.path))
      const deduped = toCreate.filter((entry) => !existing.has(entry.path))
      return [...previous, ...deduped]
    })
    setFileActionNotice(`Uploaded ${String(validFiles.length)} file${validFiles.length > 1 ? 's' : ''} to ${currentFilePath}`)
  }

  function queueContainerOp(action: string): void {
    setOpsNotice(`${action} queued for ${detail?.name ?? id}`)
  }

  const volumeMounts = useMemo(() => {
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
    const edited = editedFileContentByPath[selectedFile.path]
    if (edited !== undefined) return edited
    const name = selectedFile.path.split('/').pop() ?? selectedFile.path

    if (name.endsWith('.json')) {
      return JSON.stringify(
        {
          containerId: id,
          generatedAt: new Date().toISOString(),
          file: selectedFile.path,
          status: detail?.status ?? 'unknown',
          health: detail?.health ?? 'none',
        },
        null,
        2,
      )
    }

    if (name.endsWith('.env')) {
      return [
        `CONTAINER_ID=${id}`,
        `SERVICE_ID=${detail?.serviceId ?? 'unknown'}`,
        `NODE_ENV=${detail?.environment ?? 'development'}`,
        'PORT=3000',
        'DATABASE_URL=postgres://***:***@db.internal:5432/app',
      ].join('\n')
    }

    if (name.endsWith('.ts') || name.endsWith('.js')) {
      return [
        '// Mock file preview',
        `// ${selectedFile.path}`,
        '',
        'export function health() {',
        "  return { status: 'ok' }",
        '}',
      ].join('\n')
    }

    if (name.endsWith('.log')) {
      return [
        `[${new Date().toISOString()}] INFO  Boot sequence complete`,
        `[${new Date().toISOString()}] INFO  Health check /health responded 200`,
        `[${new Date().toISOString()}] WARN  Cache miss ratio above threshold`,
      ].join('\n')
    }

    return [
      `# ${name}`,
      '',
      `Path: ${selectedFile.path}`,
      `Owner: ${selectedFile.owner}`,
      `Permissions: ${selectedFile.permissions}`,
      `Updated: ${selectedFile.updatedAt}`,
    ].join('\n')
  }, [detail?.environment, detail?.health, detail?.serviceId, detail?.status, editedFileContentByPath, id, selectedFile])

  const metricSummary = useMemo(() => {
    const cpuSeries = metrics.map((point) => point.cpu)
    const memSeries = metrics.map((point) => point.memory)
    const rxSeries = metrics.map((point) => point.networkRxKb)
    const txSeries = metrics.map((point) => point.networkTxKb)

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
  }, [metrics])

  const metricChartData = useMemo(() => metrics.slice(-24).map((point, index) => ({
    tick: point.at.slice(11, 16),
    index,
    cpu: Number(point.cpu.toFixed(1)),
    memory: Number(point.memory.toFixed(1)),
  })), [metrics])

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
    const fromInspect = inspectDetail?.layers ?? []
    if (fromInspect.length > 0) return fromInspect
    return fallbackImageLayers
  }, [fallbackImageLayers, inspectDetail?.layers])

  function layerStatus(layerId: string): 'verified' | 'cached' | 'warning' | 'pending' {
    let hash = 0
    for (let i = 0; i < layerId.length; i += 1) hash = (hash * 31 + layerId.charCodeAt(i)) >>> 0
    if (hash % 5 === 0) return 'pending'
    if (hash % 4 === 0) return 'warning'
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
    logTickRef.current = 0
  }, [baseLogs])

  useEffect(() => {
    setLiveProcesses(baseProcesses)
    processTickRef.current = 0
  }, [baseProcesses])

  useEffect(() => {
    setFilesState(mockFiles)
  }, [mockFiles])

  useEffect(() => {
    if (!open || activeTab !== 'logs' || !streamingEnabled || !inspectDetail?.streamingLogsSupported) {
      return
    }

    const templates = [
      'HTTP GET /health 200 3ms',
      'worker: queue pull completed',
      'db pool: recycled idle connection',
      'cache warmup checkpoint reached',
      'watch: source map updated',
    ]

    const interval = setInterval(() => {
      logTickRef.current += 1
      const next = templates[logTickRef.current % templates.length]
      const streamedEntry: DockerContainerLogEntry = {
        id: `stream-${id}-${String(logTickRef.current)}`,
        timestamp: new Date().toISOString(),
        stream: logTickRef.current % 5 === 0 ? 'stderr' : 'stdout',
        level: logTickRef.current % 6 === 0 ? 'warn' : 'info',
        message: next ?? 'stream update',
      }
      setLiveLogs((prev) =>
        [
          ...prev,
          streamedEntry,
        ].slice(-220),
      )
    }, 1800)

    return () => {clearInterval(interval)}
  }, [activeTab, id, inspectDetail?.streamingLogsSupported, open, streamingEnabled])

  useEffect(() => {
    if (!open || activeTab !== 'processes' || !processesAutoRefresh) {
      return
    }

    const interval = setInterval(() => {
      processTickRef.current += 1
      setLiveProcesses((prev) =>
        prev.map((proc, index) => {
          const cpuWave = Math.sin((processTickRef.current + index) / 2.2) * 2.8
          const memWave = Math.cos((processTickRef.current + index) / 3.1) * 1.6
          return {
            ...proc,
            cpuPercent: Number(Math.max(0, Math.min(99, proc.cpuPercent + cpuWave)).toFixed(1)),
            memoryPercent: Number(Math.max(0, Math.min(99, proc.memoryPercent + memWave)).toFixed(1)),
          }
        }),
      )
    }, 2000)

    return () => {clearInterval(interval)}
  }, [activeTab, open, processesAutoRefresh])

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

  return (
    <>
      <button
        type="button"
        className={className ?? 'underline-offset-4 hover:underline text-left'}
        onClick={() => {
          setActiveTab(initialTab)
          setOpen(true)
        }}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
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

              <TabsContent value="overview" className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
                  <div className="rounded border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{detail.name}</p>
                      <Badge variant={detail.status === 'running' ? 'default' : detail.status === 'restarting' ? 'secondary' : 'outline'}>{detail.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={detail.health === 'healthy' ? 'default' : detail.health === 'starting' ? 'secondary' : 'outline'}>
                        health: {detail.health}
                      </Badge>
                      <Badge variant="outline">env: {detail.environment ?? '—'}</Badge>
                      <Badge variant="outline">updated: {detail.updatedAt}</Badge>
                    </div>
                    <div className="grid gap-2 text-xs md:grid-cols-2">
                      <div className="rounded bg-muted/30 px-2 py-1.5">
                        <p className="text-muted-foreground">Service ID</p>
                        <p className="font-mono break-all">{detail.serviceId}</p>
                      </div>
                      <div className="rounded bg-muted/30 px-2 py-1.5">
                        <p className="text-muted-foreground">Stack ID</p>
                        <p className="font-mono break-all">{detail.stackId ?? '—'}</p>
                      </div>
                      <div className="rounded bg-muted/30 px-2 py-1.5 md:col-span-2">
                        <p className="text-muted-foreground">Image ID</p>
                        <p className="font-mono break-all">{detail.imageId ?? '—'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">Runtime capabilities</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">logs: {inspectDetail?.streamingLogsSupported ? 'streaming' : 'disabled'}</Badge>
                      <Badge variant="outline">watch: {inspectDetail?.runtimeConfig.watchMode ?? 'disabled'}</Badge>
                      <Badge variant="outline">restart: {inspectDetail?.runtimeConfig.restartPolicy ?? 'n/a'}</Badge>
                      <Badge variant="outline">depends_on: {inspectDetail?.composeConfig?.dependsOn.length ?? 0}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-blue-500/10 px-2 py-1.5 text-blue-700 dark:text-blue-300">
                        <p>RX total</p>
                        <p className="font-semibold">{Math.round(metricSummary.rxTotal)} KB</p>
                      </div>
                      <div className="rounded bg-purple-500/10 px-2 py-1.5 text-purple-700 dark:text-purple-300">
                        <p>TX total</p>
                        <p className="font-semibold">{Math.round(metricSummary.txTotal)} KB</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded border p-3">
                  <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                    <p className="text-muted-foreground">CPU/Memory telemetry</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">CPU {metricSummary.cpuCurrent.toFixed(1)}%</Badge>
                      <Badge variant="outline">Memory {metricSummary.memCurrent.toFixed(1)}%</Badge>
                    </div>
                  </div>

                  <ChartContainer config={overviewChartConfig} className="h-56 w-full aspect-auto">
                    <LineChart data={metricChartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="tick"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                        tickFormatter={(value: string | number, index: number) => (index % 4 === 0 ? String(value) : '')}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value: string | number) => `${String(value)}%`}
                        width={36}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent indicator="line" />}
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line
                        type="monotone"
                        dataKey="cpu"
                        stroke="var(--color-cpu)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="memory"
                        stroke="var(--color-memory)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ChartContainer>
                </div>

                <div className="grid gap-2 md:grid-cols-4 text-xs">
                  <div className="rounded border bg-muted/30 p-2">CPU peak: <span className="font-semibold">{metricSummary.cpuPeak.toFixed(1)}%</span></div>
                  <div className="rounded border bg-muted/30 p-2">Mem peak: <span className="font-semibold">{metricSummary.memPeak.toFixed(1)}%</span></div>
                  <div className="rounded border bg-muted/30 p-2">RX now: <span className="font-semibold">{metricSummary.rxCurrent.toFixed(0)} KB/s</span></div>
                  <div className="rounded border bg-muted/30 p-2">TX now: <span className="font-semibold">{metricSummary.txCurrent.toFixed(0)} KB/s</span></div>
                </div>
              </TabsContent>

              <TabsContent value="layers" className="flex min-h-0 flex-col gap-3 text-sm">
                <p className="text-xs text-muted-foreground">Image layer history for this container image (with verification status).</p>
                <div className="flex-1 min-h-0 overflow-auto rounded border divide-y">
                  {containerLayers.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">No image layer metadata is available for this container.</div>
                  ) : containerLayers.map((layer) => (
                    <div key={layer.id} className="p-2">
                      <button
                        type="button"
                        className="w-full rounded-sm px-2 py-1.5 transition-colors hover:bg-muted/60"
                        onClick={() => setExpandedLayerId((previous) => (previous === layer.id ? null : layer.id))}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-mono text-xs break-all text-left">{layer.instruction}</p>
                          <div className="flex items-center gap-1.5">
                            <Badge variant={layerStatusVariant(layerStatus(layer.id))}>{layerStatus(layer.id)}</Badge>
                            <Badge variant="outline">{layer.size}</Badge>
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
                              <Badge variant={layerStatusVariant(layerStatus(layer.id))}>{layerStatus(layer.id)}</Badge>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Instruction</p>
                              <p className="font-mono break-all">{layer.instruction}</p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="processes" className="flex min-h-0 flex-col gap-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Realtime process list (mock refresh every 2s).</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setProcessesAutoRefresh((prev) => !prev)}>
                    {processesAutoRefresh ? 'Pause refresh' : 'Resume refresh'}
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/70">
                      <tr>
                        <th className="text-left p-2">PID</th>
                        <th className="text-left p-2">User</th>
                        <th className="text-left p-2">State</th>
                        <th className="text-left p-2">CPU %</th>
                        <th className="text-left p-2">Mem %</th>
                        <th className="text-left p-2">Command</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveProcesses.map((proc) => {
                        const isExpanded = expandedProcessPid === proc.pid
                        const processLogs: DockerContainerLogEntry[] = [
                          {
                            id: `proc-${String(proc.pid)}-1`,
                            timestamp: new Date().toISOString(),
                            stream: 'stdout',
                            level: 'info',
                            message: `PID ${String(proc.pid)} (${proc.command}) heartbeat OK`,
                          },
                          {
                            id: `proc-${String(proc.pid)}-2`,
                            timestamp: new Date(Date.now() - 7_000).toISOString(),
                            stream: proc.state === 'zombie' || proc.state === 'stopped' ? 'stderr' : 'stdout',
                            level: proc.state === 'zombie' || proc.state === 'stopped' ? 'warn' : 'info',
                            message:
                              proc.state === 'zombie' || proc.state === 'stopped'
                                ? `PID ${String(proc.pid)} reported abnormal state: ${proc.state}`
                                : `PID ${String(proc.pid)} CPU ${proc.cpuPercent.toFixed(1)}% · MEM ${proc.memoryPercent.toFixed(1)}%`,
                          },
                        ]

                        return (
                          <Fragment key={`${proc.pid}-${proc.command}`}>
                            <tr
                              className="border-t cursor-pointer hover:bg-muted/40"
                              onClick={() => setExpandedProcessPid((previous) => (previous === proc.pid ? null : proc.pid))}
                            >
                              <td className="p-2 font-mono">{proc.pid}</td>
                              <td className="p-2">{proc.user}</td>
                              <td className="p-2"><Badge variant="outline">{proc.state}</Badge></td>
                              <td className="p-2">{proc.cpuPercent.toFixed(1)}</td>
                              <td className="p-2">{proc.memoryPercent.toFixed(1)}</td>
                              <td className="p-2 font-mono break-all">{proc.command}</td>
                            </tr>
                            {isExpanded ? (
                              <tr className="border-t bg-muted/20">
                                <td colSpan={6} className="p-2">
                                  <div className="rounded border bg-background/80 divide-y">
                                    {processLogs.map((log) => (
                                      <div key={log.id} className="px-3 py-2 text-xs font-mono">
                                        <span className="text-muted-foreground">[{log.timestamp}]</span>{' '}
                                        <span className="text-muted-foreground">{log.stream}</span>{' '}
                                        <span className={log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-amber-500' : ''}>{log.level}</span>{' '}
                                        <span>{log.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">Tip: click a process row to expand/collapse its logs inline.</p>
              </TabsContent>

              <TabsContent value="logs" className="flex min-h-0 flex-col gap-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">tail -f</Badge>
                  <Badge variant="outline">stdout/stderr</Badge>
                  <Badge variant="outline">SSE-ready</Badge>
                  <Button type="button" variant="outline" size="sm" onClick={() => setStreamingEnabled((prev) => !prev)}>
                    {streamingEnabled ? 'Pause stream' : 'Resume stream'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setLiveLogs(baseLogs)}>
                    Reset
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto rounded border bg-muted/20 divide-y">
                  {liveLogs.map((log) => (
                    <div key={log.id} className="p-3 text-xs font-mono">
                      <span className="text-muted-foreground">[{log.timestamp}]</span>{' '}
                      <span className="text-muted-foreground">{log.stream}</span>{' '}
                      <span className={log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-amber-500' : ''}>{log.level}</span>{' '}
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="network" className="space-y-3 text-sm">
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Port mappings</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(inspectDetail?.portMappings ?? []).map((port) => (
                      <Badge key={`${port.containerPort}-${port.protocol}-${String(port.hostPort)}`} variant="outline">
                        {port.hostIp}:{port.hostPort ?? '—'} → {port.containerPort}/{port.protocol}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {(inspectDetail?.networkConfig ?? []).map((network) => (
                    <div key={network.networkId} className="rounded border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{network.name}</p>
                        <Badge variant="outline">{network.driver}/{network.scope}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-muted-foreground">IPv4:</span> {network.ipv4 ?? '—'}</div>
                        <div><span className="text-muted-foreground">Gateway:</span> {network.gateway ?? '—'}</div>
                        <div><span className="text-muted-foreground">DNS:</span> {network.dnsServers.join(', ')}</div>
                        <div><span className="text-muted-foreground">Search:</span> {network.dnsSearch.join(', ')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="mounts" className="flex min-h-0 flex-col gap-3 text-sm">
                <div className="flex-1 min-h-0 overflow-auto rounded border divide-y">
                  {(inspectDetail?.mounts ?? []).map((mount) => (
                    <div key={`${mount.source}-${mount.target}`} className="p-3 grid gap-2 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Source</p>
                        <code className="text-xs break-all">{mount.source}</code>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Destination</p>
                        <code className="text-xs break-all">{mount.target}</code>
                      </div>
                      <div className="flex items-center gap-2 justify-start md:justify-end">
                        <Badge variant="outline">{mount.type}</Badge>
                        <Badge variant={mount.readOnly ? 'secondary' : 'default'}>{mount.readOnly ? 'ro' : 'rw'}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="files" className="flex min-h-0 flex-col gap-3 text-sm">
                <div className="rounded border p-3 bg-muted/30 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Container file browser (FTP-style navigation)</p>
                    <div className="flex items-center gap-1 rounded border bg-background p-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={fileBrowserMode === 'container' ? 'default' : 'ghost'}
                        className="h-7"
                        onClick={() => {
                          setFileBrowserMode('container')
                          setCurrentFilePath('/')
                          setSelectedFilePath(null)
                        }}
                      >
                        Container
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={fileBrowserMode === 'volume' ? 'default' : 'ghost'}
                        className="h-7"
                        disabled={volumeMounts.length === 0}
                        onClick={() => {
                          setFileBrowserMode('volume')
                          const fallback = volumeMounts[0]?.path ?? '/'
                          setCurrentFilePath(selectedVolumePath === '/' ? fallback : selectedVolumePath)
                          setSelectedFilePath(null)
                        }}
                      >
                        <HardDrive className="mr-1 h-3.5 w-3.5" />
                        Volumes
                      </Button>
                    </div>
                  </div>

                  {fileBrowserMode === 'volume' ? (
                    <div className="rounded border bg-background p-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Volume:</span>
                        <select
                          className="h-8 rounded border bg-background px-2 text-xs"
                          value={selectedVolumePath}
                          onChange={(event) => {
                            setSelectedVolumePath(event.target.value)
                            setCurrentFilePath(event.target.value)
                            setSelectedFilePath(null)
                          }}
                        >
                          {volumeMounts.map((volume) => (
                            <option key={volume.path} value={volume.path}>
                              {volume.label} ({volume.mode})
                            </option>
                          ))}
                        </select>
                        <span className="text-muted-foreground">source: {volumeMounts.find((volume) => volume.path === selectedVolumePath)?.source ?? '—'}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsCreateFolderOpen(true)
                      }}
                    >
                      <FolderPlus className="mr-1 h-3.5 w-3.5" />
                      New folder
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        uploadInputRef.current?.click()
                      }}
                    >
                      <Upload className="mr-1 h-3.5 w-3.5" />
                      Upload files
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!selectedFile}
                      onClick={openEditFileModal}
                    >
                      <FilePenLine className="mr-1 h-3.5 w-3.5" />
                      Edit file
                    </Button>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        handleUploadFiles(event.target.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </div>
                </div>

                <DockerFileBrowser
                  files={effectiveFiles}
                  currentPath={currentFilePath}
                  selectedFilePath={selectedFilePath}
                  modeRootPath={getModeRootPath()}
                  notice={fileActionNotice}
                  onCurrentPathChange={setCurrentFilePath}
                  onSelectedFilePathChange={setSelectedFilePath}
                  onDropUploadFiles={(files) => {
                    handleUploadFiles(files)
                  }}
                  getFilePreviewContent={(file) => {
                    const edited = editedFileContentByPath[file.path]
                    if (edited !== undefined) return edited
                    if (selectedFile?.path === file.path) return selectedFileContent

                    const name = file.path.split('/').pop() ?? file.path
                    if (name.endsWith('.json')) {
                      return JSON.stringify(
                        {
                          containerId: id,
                          generatedAt: new Date().toISOString(),
                          file: file.path,
                          status: detail?.status ?? 'unknown',
                          health: detail?.health ?? 'none',
                        },
                        null,
                        2,
                      )
                    }
                    if (name.endsWith('.env')) {
                      return [
                        `CONTAINER_ID=${id}`,
                        `SERVICE_ID=${detail?.serviceId ?? 'unknown'}`,
                        `NODE_ENV=${detail?.environment ?? 'development'}`,
                        'PORT=3000',
                        'DATABASE_URL=postgres://***:***@db.internal:5432/app',
                      ].join('\n')
                    }
                    if (name.endsWith('.ts') || name.endsWith('.js')) {
                      return [
                        '// Mock file preview',
                        `// ${file.path}`,
                        '',
                        'export function health() {',
                        "  return { status: 'ok' }",
                        '}',
                      ].join('\n')
                    }
                    if (name.endsWith('.log')) {
                      return [
                        `[${new Date().toISOString()}] INFO  Boot sequence complete`,
                        `[${new Date().toISOString()}] INFO  Health check /health responded 200`,
                        `[${new Date().toISOString()}] WARN  Cache miss ratio above threshold`,
                      ].join('\n')
                    }

                    return [
                      `# ${name}`,
                      '',
                      `Path: ${file.path}`,
                      `Owner: ${file.owner}`,
                      `Permissions: ${file.permissions}`,
                      `Updated: ${file.updatedAt}`,
                    ].join('\n')
                  }}
                  renderRowActions={(entry) => (
                    <>
                      <button
                        type="button"
                        title="Rename"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleFileRename(entry.path, entry.type)
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Change permission"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleFileChmod(entry.path, entry.type)
                        }}
                      >
                        <Shield className="h-3 w-3" />
                      </button>
                      {entry.type === 'file' ? (
                        <button
                          type="button"
                          title="Download"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleFileDownload(entry.path)
                          }}
                        >
                          <Download className="h-3 w-3" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        title="Delete"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-destructive transition-colors hover:bg-destructive/10"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleFileDelete(entry.path, entry.type)
                        }}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    </>
                  )}
                />
              </TabsContent>

              <TabsContent value="env" className="flex min-h-0 flex-col gap-2 text-sm">
                <div className="flex-1 min-h-0 overflow-auto rounded border divide-y">
                  {(inspectDetail?.environment ?? []).map((entry) => (
                    <div key={entry.key} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs break-all">{entry.key}</p>
                        <p className="text-xs text-muted-foreground break-all">{entry.masked ? '********' : entry.value}</p>
                      </div>
                      <Badge variant="outline">{entry.source}</Badge>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="config" className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground">Watch mode</p>
                    <p className="mt-1 font-medium">{inspectDetail?.runtimeConfig.watchMode ?? 'disabled'}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground">Restart policy</p>
                    <p className="mt-1 font-medium">{inspectDetail?.runtimeConfig.restartPolicy ?? 'n/a'}</p>
                  </div>
                  <div className="rounded border p-3">
                    <p className="text-xs text-muted-foreground">Network mode</p>
                    <p className="mt-1 font-medium">{inspectDetail?.runtimeConfig.networkMode ?? 'bridge'}</p>
                  </div>
                </div>
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {[
                        { key: 'User', value: inspectDetail?.runtimeConfig.user ?? 'default' },
                        { key: 'Working directory', value: inspectDetail?.runtimeConfig.workingDir ?? '/' },
                        { key: 'Entrypoint', value: (inspectDetail?.runtimeConfig.entrypoint ?? []).join(' ') || '—' },
                        { key: 'Command', value: (inspectDetail?.runtimeConfig.command ?? []).join(' ') || '—' },
                        { key: 'Privileged', value: inspectDetail?.runtimeConfig.privileged ? 'true' : 'false' },
                        { key: 'Readonly rootfs', value: inspectDetail?.runtimeConfig.readOnlyRootFs ? 'true' : 'false' },
                        { key: 'OOM kill disable', value: inspectDetail?.runtimeConfig.oomKillDisable ? 'true' : 'false' },
                        { key: 'IPC mode', value: inspectDetail?.runtimeConfig.ipcMode ?? 'default' },
                        { key: 'PID mode', value: inspectDetail?.runtimeConfig.pidMode ?? 'default' },
                        { key: 'Cgroupns mode', value: inspectDetail?.runtimeConfig.cgroupnsMode ?? 'default' },
                      ].map((row) => (
                        <tr key={row.key} className="border-b last:border-b-0">
                          <td className="bg-muted/30 px-3 py-2 text-muted-foreground">{row.key}</td>
                          <td className="px-3 py-2 font-medium break-all">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground mb-2">Healthcheck</p>
                  <div className="grid gap-2 md:grid-cols-2 text-xs">
                    <div>command: <code className="font-mono">{inspectDetail?.runtimeConfig.healthcheckCommand ?? 'none'}</code></div>
                    <div>interval: {inspectDetail?.runtimeConfig.healthcheckIntervalSec ?? '—'}s</div>
                    <div>timeout: {inspectDetail?.runtimeConfig.healthcheckTimeoutSec ?? '—'}s</div>
                    <div>retries: {inspectDetail?.runtimeConfig.healthcheckRetries ?? '—'}</div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="compose" className="flex min-h-0 flex-col gap-3 text-sm">
                {inspectDetail?.composeConfig ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded border p-3">
                        <p className="text-xs text-muted-foreground">Runtime</p>
                        <p className="mt-1 font-medium capitalize">{orchestrator}</p>
                      </div>
                      <div className="rounded border p-3">
                        <p className="text-xs text-muted-foreground">Ports</p>
                        <p className="mt-1 font-medium">{inspectDetail.composeConfig.ports.length}</p>
                      </div>
                      <div className="rounded border p-3">
                        <p className="text-xs text-muted-foreground">Volumes</p>
                        <p className="mt-1 font-medium">{inspectDetail.composeConfig.volumes.length}</p>
                      </div>
                    </div>

                    <div className="rounded border overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {composeRows.map((row) => (
                            <tr key={row.key} className="border-b last:border-b-0">
                              <td className="bg-muted/30 px-3 py-2 text-muted-foreground">{row.key}</td>
                              <td className="px-3 py-2 font-medium break-all">{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded border p-3">
                      <p className="text-xs text-muted-foreground mb-2">depends_on</p>
                      <div className="overflow-auto rounded border divide-y">
                        {inspectDetail.composeConfig.dependsOn.map((dep) => (
                          <div key={`${dep.service}-${dep.condition}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1.5 text-xs">
                            <span className="font-medium">{dep.service}</span>
                            <Badge variant="outline">{dep.condition}</Badge>
                            <Badge variant={dep.required ? 'default' : 'secondary'}>{dep.required ? 'required' : 'optional'}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowRawCompose((previous) => !previous)
                        }}
                      >
                        {showRawCompose ? 'Hide raw manifest' : 'Show raw manifest'}
                      </Button>
                    </div>
                    {showRawCompose ? (
                      <pre className="flex-1 min-h-0 overflow-auto rounded border bg-muted/20 p-3 text-xs">{inspectDetail.composeConfig.rawYaml}</pre>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No compose configuration available.</p>
                )}
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                {[{ k: 'projectId', v: detail.projectId }, { k: 'serviceId', v: detail.serviceId }, { k: 'logsStreamId', v: detail.logsStreamId ?? '—' }].map((label) => (
                  <div key={label.k} className="rounded border p-3 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{label.k}</span>
                    <code className="font-mono text-xs break-all">{label.v}</code>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="terminal" className="space-y-3 text-sm">
                <p className="text-muted-foreground">Interactive shell profiles (mocked terminal presets).</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {terminalProfiles.map((profile) => (
                    <div key={`${profile.shell}-${profile.user}`} className="rounded border p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <code>{profile.shell}</code>
                        {profile.recommended ? <Badge>recommended</Badge> : <Badge variant="outline">optional</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">user: {profile.user}</p>
                      <p className="text-xs text-muted-foreground">cwd: {profile.workingDir}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="security" className="space-y-2 text-sm">
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Privileged mode</span>
                  <Badge variant={inspectDetail?.runtimeConfig.privileged ? 'destructive' : 'outline'}>{inspectDetail?.runtimeConfig.privileged ? 'enabled' : 'disabled'}</Badge>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Runtime health</span>
                  <Badge variant={detail.health === 'unhealthy' ? 'destructive' : 'outline'}>{detail.health}</Badge>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Network mode</span>
                  <span>{inspectDetail?.runtimeConfig.networkMode ?? 'bridge'}</span>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Readonly filesystem</span>
                  <span>{inspectDetail?.runtimeConfig.readOnlyRootFs ? 'yes' : 'no'}</span>
                </div>
              </TabsContent>

            </Tabs>
          ) : (
            <p className="text-sm text-muted-foreground">Container not found.</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(openState) => {
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

      <Dialog open={isEditFileOpen} onOpenChange={(openState) => {
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
