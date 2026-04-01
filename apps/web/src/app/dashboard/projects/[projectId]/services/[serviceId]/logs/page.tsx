'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'
import { DockerSelectionToggle } from '@/app/dashboard/docker/_components/docker-page-utilities'
import {
  useDockerContainerList,
  useDockerDeploymentList,
  useDockerMeshSseState,
} from '@/domains/docker/mock-hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Toggle } from '@repo/ui/components/shadcn/toggle'
import { ArrowLeft, Pause, Play, Search, WrapText } from 'lucide-react'
import { ServiceSectionNav } from '../_components/service-section-nav'

const LIST_INPUT = {
  query: {
    limit: 300,
    offset: 0,
  },
} as const

interface ServiceLogLine {
  id: string
  containerId: string | null
  containerName: string
  source: 'deployment' | 'mesh' | 'replica'
  status: string
  message: string
  timestamp: string
}

interface ServiceItem {
  id: string
  name: string
}

interface ProjectItem {
  id: string
}

interface DockerContainerLite {
  id: string
  name: string
  projectId: string
  serviceId: string
  status: string
  health: string
  updatedAt: string
  startedAt?: string | null
}

interface DeploymentLite {
  id: string
  projectId: string
  serviceId: string
  containerName?: string | null
  status: string
  environment: string
  updatedAt: string
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

export default function DashboardServiceLogsPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const searchParams = useSearchParams()
  const projectId = params.projectId
  const serviceId = params.serviceId
  const logsViewportRef = useRef<HTMLDivElement | null>(null)

  const [logsSearchTerm, setLogsSearchTerm] = useState('')
  const [replicaSearchTerm, setReplicaSearchTerm] = useState('')
  const [logsSourceFilter, setLogsSourceFilter] = useState<'all' | ServiceLogLine['source']>('all')
  const [logsReplicaFilter, setLogsReplicaFilter] = useState('all')
  const [selectedReplicaNames, setSelectedReplicaNames] = useState<Set<string>>(new Set())
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [isWrapEnabled, setIsWrapEnabled] = useState(true)
  const [fontSizePx, setFontSizePx] = useState(12)
  const [pausedSnapshot, setPausedSnapshot] = useState<ServiceLogLine[] | null>(null)
  const [clearedAt, setClearedAt] = useState<number | null>(null)

  const project = useMemo<ProjectItem | null>(
    () => (MOCK_PROJECTS as ProjectItem[]).find((item: ProjectItem) => item.id === projectId) ?? null,
    [projectId],
  )
  const services = useMemo<ServiceItem[]>(() => (MOCK_SERVICES_BY_PROJECT[projectId] ?? []) as ServiceItem[], [projectId])
  const service = useMemo(() => services.find((item: ServiceItem) => item.id === serviceId) ?? null, [serviceId, services])

  const { data: deploymentData } = useDockerDeploymentList(LIST_INPUT)
  const { data: containerData } = useDockerContainerList(LIST_INPUT)
  const { state: meshState, status: meshSseStatus } = useDockerMeshSseState()

  const allContainers = useMemo(() => (containerData?.data ?? []) as DockerContainerLite[], [containerData?.data])
  const allDeployments = useMemo(() => (deploymentData?.data ?? []) as DeploymentLite[], [deploymentData?.data])

  const serviceContainers = useMemo(() => {
    return allContainers
      .filter((container: DockerContainerLite) => container.projectId === projectId && container.serviceId === serviceId)
      .sort((a: DockerContainerLite, b: DockerContainerLite) => a.name.localeCompare(b.name))
  }, [allContainers, projectId, serviceId])

  const replicaNames = useMemo(() => serviceContainers.map((container: DockerContainerLite) => container.name), [serviceContainers])

  const filteredReplicaNames = useMemo(() => {
    const normalized = replicaSearchTerm.trim().toLowerCase()
    if (!normalized) return replicaNames
    return replicaNames.filter((name: string) => name.toLowerCase().includes(normalized))
  }, [replicaNames, replicaSearchTerm])

  const preselectedReplicaNames = useMemo(() => {
    const raw = searchParams.get('replicas')
    if (!raw) return new Set<string>()

    const requestedReplicas = raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0)

    if (requestedReplicas.length === 0) return new Set<string>()

    const available = new Set(replicaNames)
    return new Set(requestedReplicas.filter((name) => available.has(name)))
  }, [replicaNames, searchParams])

  const effectiveSelectedReplicaNames = selectionTouched ? selectedReplicaNames : preselectedReplicaNames

  const logs = useMemo<ServiceLogLine[]>(() => {
    const projected: ServiceLogLine[] = []
    const serviceDeployments = allDeployments.filter(
      (deployment: DeploymentLite) => deployment.projectId === projectId && deployment.serviceId === serviceId,
    )

    for (const deployment of serviceDeployments.slice(0, 120)) {
      const containerName = deployment.containerName ?? `service-${deployment.id.slice(0, 8)}`
      const message =
        deployment.status === 'failed'
          ? `Deployment failed in ${deployment.environment}`
          : deployment.status === 'success'
            ? `Deployment completed in ${deployment.environment}`
            : `Deployment ${deployment.status} in ${deployment.environment}`

      projected.push({
        id: deployment.id,
        containerId: null,
        containerName,
        source: 'deployment',
        status: deployment.status,
        message,
        timestamp: deployment.updatedAt,
      })
    }

    for (const container of serviceContainers) {
      projected.push({
        id: `${container.id}-runtime`,
        containerId: container.id,
        containerName: container.name,
        source: 'replica',
        status: container.status,
        message: `${container.name} runtime ${container.status} · health ${container.health}`,
        timestamp: container.updatedAt,
      })

      if (container.startedAt) {
        projected.push({
          id: `${container.id}-started`,
          containerId: container.id,
          containerName: container.name,
          source: 'replica',
          status: 'started',
          message: `${container.name} started at ${formatDate(container.startedAt)}`,
          timestamp: container.startedAt,
        })
      }
    }

    projected.push({
      id: `mesh-state-${String(meshState.revision)}-${serviceId}`,
      containerId: null,
      containerName: service?.name ?? 'mesh-control-plane',
      source: 'mesh',
      status: meshSseStatus,
      message: `Mesh ${meshState.reason.replaceAll('_', ' ')} · ${String(meshState.sessions.length)} sessions · ${String(meshState.peers.length)} peers`,
      timestamp: meshState.emittedAt,
    })

    return projected.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [allDeployments, meshSseStatus, meshState, projectId, service?.name, serviceContainers, serviceId])

  const filteredLogs = useMemo(() => {
    const normalized = logsSearchTerm.trim().toLowerCase()

    return logs.filter((log) => {
      if (logsSourceFilter !== 'all' && log.source !== logsSourceFilter) return false
      if (logsReplicaFilter !== 'all' && log.containerName !== logsReplicaFilter) return false
      if (effectiveSelectedReplicaNames.size > 0 && !effectiveSelectedReplicaNames.has(log.containerName)) return false
      if (clearedAt && new Date(log.timestamp).getTime() < clearedAt) return false

      if (!normalized) return true

      return (
        log.containerName.toLowerCase().includes(normalized)
        || log.message.toLowerCase().includes(normalized)
        || log.status.toLowerCase().includes(normalized)
      )
    })
  }, [clearedAt, effectiveSelectedReplicaNames, logs, logsReplicaFilter, logsSearchTerm, logsSourceFilter])

  const displayedLogs = isPaused ? (pausedSnapshot ?? filteredLogs) : filteredLogs

  useEffect(() => {
    if (!isAutoScroll || !logsViewportRef.current) return
    logsViewportRef.current.scrollTop = logsViewportRef.current.scrollHeight
  }, [displayedLogs, isAutoScroll])

  const selectedVisibleReplicasCount = filteredReplicaNames.filter((name: string) => effectiveSelectedReplicaNames.has(name)).length
  const allVisibleReplicasSelected =
    filteredReplicaNames.length > 0 && selectedVisibleReplicasCount === filteredReplicaNames.length
  const someVisibleReplicasSelected =
    selectedVisibleReplicasCount > 0 && selectedVisibleReplicasCount < filteredReplicaNames.length

  if (!project) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>This project does not exist in the mock entities dataset.</AlertDescription>
      </Alert>
    )
  }

  if (!service) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist in the selected project mock dataset.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/dashboard/projects/${projectId}/services/${serviceId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to service
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service logs</h1>
          <p className="text-sm text-muted-foreground">
            Replica-aware logs. Select one or many replicas to inspect individual or combined stream output.
          </p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="logs" />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
          <div className="border-b border-border/60 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={replicaSearchTerm}
                onChange={(event) => {
                  setReplicaSearchTerm(event.target.value)
                }}
                placeholder="Filter replicas..."
                className="h-9 border-border/70 bg-background/70 pl-9"
              />
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setSelectionTouched(true)
                  setSelectedReplicaNames(new Set(filteredReplicaNames))
                }}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setSelectionTouched(true)
                  setSelectedReplicaNames(new Set())
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] space-y-1 overflow-auto px-2 py-2">
            {filteredReplicaNames.map((replicaName: string) => {
              const isSelected = effectiveSelectedReplicaNames.has(replicaName)
              return (
                <div
                  key={replicaName}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${isSelected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:border-border/50 hover:bg-muted/30'}`}
                >
                  <DockerSelectionToggle
                    ariaLabel={`Select logs for ${replicaName}`}
                    shape="round"
                    pressed={isSelected}
                    onPressedChange={(pressed: boolean) => {
                      setSelectedReplicaNames((previous) => {
                        setSelectionTouched(true)
                        const next = new Set(previous)
                        if (pressed) next.add(replicaName)
                        else next.delete(replicaName)
                        return next
                      })
                    }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{replicaName}</p>
                    <p className="text-[10px] text-muted-foreground">service replica</p>
                  </div>
                </div>
              )
            })}
            {filteredReplicaNames.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">No replicas match your filter.</p>
            ) : null}
          </div>

          <div className="border-t border-border/60 px-3 py-2">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{effectiveSelectedReplicaNames.size} selected</span>
              <span>{replicaNames.length} replicas</span>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {allVisibleReplicasSelected
                ? 'All visible selected'
                : someVisibleReplicasSelected
                  ? 'Partial visible selected'
                  : 'None visible selected'}
            </Badge>
          </div>
        </aside>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
          <div className="border-b border-border/60 bg-background/70 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-medium">Live</span>
                <Badge variant="outline" className="text-[10px]">{meshSseStatus}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isPaused}
                  onPressedChange={(value) => {
                    if (value) {
                      setPausedSnapshot(filteredLogs)
                    } else {
                      setPausedSnapshot(null)
                    }
                    setIsPaused(value)
                  }}
                  className="h-8 gap-1.5 data-[state=on]:border-amber-500/40 data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-200"
                >
                  {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Toggle>

                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isAutoScroll}
                  onPressedChange={setIsAutoScroll}
                  className="h-8 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
                >
                  Auto-scroll
                </Toggle>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setFontSizePx((previous) => (previous >= 14 ? 11 : previous + 1))
                  }}
                >
                  {fontSizePx}px
                </Button>

                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isWrapEnabled}
                  onPressedChange={setIsWrapEnabled}
                  className="h-8 gap-1.5 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
                >
                  <WrapText className="h-3.5 w-3.5" />
                  Wrap
                </Toggle>
                

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    const payload = displayedLogs
                      .map((log) => `${formatDate(log.timestamp)}\t${log.containerName}\t${log.source}\t${log.message}`)
                      .join('\n')
                    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const anchor = document.createElement('a')
                    anchor.href = url
                    anchor.download = `${service.name}-logs.txt`
                    anchor.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Download
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setClearedAt(Date.now())
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={logsSearchTerm}
                  onChange={(event) => {
                    setLogsSearchTerm(event.target.value)
                  }}
                  className="h-9 border-border/70 bg-background/70 pl-9"
                  placeholder="Search logs"
                />
              </div>
              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={logsSourceFilter}
                onChange={(event) => {
                  setLogsSourceFilter(event.target.value as 'all' | ServiceLogLine['source'])
                }}
              >
                <option value="all">All sources</option>
                <option value="replica">Replicas</option>
                <option value="deployment">Deployments</option>
                <option value="mesh">Mesh</option>
              </select>
              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={logsReplicaFilter}
                onChange={(event) => {
                  setLogsReplicaFilter(event.target.value)
                }}
              >
                <option value="all">All replicas</option>
                {replicaNames.map((replica: string) => (
                  <option key={replica} value={replica}>{replica}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs">
            <Badge variant="outline">{replicaNames.length} replicas</Badge>
            <Badge variant="outline">{effectiveSelectedReplicaNames.size} selected</Badge>
            <Badge variant="outline">{displayedLogs.length} lines</Badge>
            {effectiveSelectedReplicaNames.size > 1 ? <Badge>Combined stream</Badge> : null}

            <div className="ml-auto flex items-center gap-2">
              <DockerSelectionToggle
                ariaLabel="Select all visible replicas"
                shape="round"
                pressed={allVisibleReplicasSelected}
                indeterminate={someVisibleReplicasSelected}
                onPressedChange={(pressed: boolean) => {
                  if (pressed) {
                    setSelectionTouched(true)
                    setSelectedReplicaNames(new Set(filteredReplicaNames))
                  } else {
                    setSelectionTouched(true)
                    setSelectedReplicaNames(new Set())
                  }
                }}
              />
              <span className="text-[11px] text-muted-foreground">Visible list select</span>
            </div>
          </div>

          <div
            ref={logsViewportRef}
            className={`max-h-[72vh] overflow-auto bg-[#070b14] px-4 py-3 font-mono text-green-300 ${isWrapEnabled ? 'whitespace-pre-wrap wrap-break-word' : 'whitespace-pre'}`}
            style={{ fontSize: `${String(fontSizePx)}px` }}
          >
            {displayedLogs.map((log) => (
              <p key={log.id} className="mb-0.5">
                <span className="text-emerald-400">[{formatDate(log.timestamp)}]</span>{' '}
                <span className="text-slate-200">[{log.containerName}]</span>{' '}
                <span className="text-blue-300">[{log.source}]</span>{' '}
                {log.message}
              </p>
            ))}
            {displayedLogs.length === 0 ? <p className="text-slate-400">No logs match the current filters.</p> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
