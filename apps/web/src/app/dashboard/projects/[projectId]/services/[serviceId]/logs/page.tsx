'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { DockerSelectionToggle } from '@/app/dashboard/docker/_components/docker-page-utilities'
import {
  useDockerContainerList,
  useDockerDeploymentList,
} from '@/domains/docker/hooks'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { ReplicaSidebar } from './_components/replica-sidebar'
import {
  filterServiceActivity,
  formatActivityLines,
  projectServiceActivity,
  type DeploymentLite,
  type DockerContainerLite,
  type ServiceLogLine,
} from './_utils/service-activity'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import { InlineError, SectionHeading } from '../../../../_components/workload/WorkloadStates'
import { Toggle } from '@deployer/ui/components/shadcn/toggle'
import { Check, Copy, Pause, Play, Search, WrapText } from 'lucide-react'
import { formatDateTime as formatDate } from '@/lib/format/date'

const LIST_INPUT = {
  query: {
    limit: 300,
    offset: 0,
  },
} as const

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
  const [copied, setCopied] = useState(false)

  const { data: deploymentData, isLoading: deploymentLoading, error: deploymentError, refetch: refetchDeployments } = useDockerDeploymentList(LIST_INPUT)
  const { data: containerData, isLoading: containerLoading } = useDockerContainerList(LIST_INPUT)
  const { state: meshState, status: meshSseStatus } = useMeshSseState()

  // ── Derived state (ALL hooks MUST run unconditionally — no early returns
  //    before them, or React throws "Rendered more hooks than during the
  //    previous render" which corrupts the hook order and lets queries fire
  //    with template `:id` params). ──────────────────────────────────────────
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

  const logs = useMemo(
    () => projectServiceActivity({ deployments: allDeployments, serviceContainers, meshState, meshSseStatus, serviceId }),
    [allDeployments, meshSseStatus, meshState, serviceContainers, serviceId],
  )

  const filteredLogs = useMemo(
    () => filterServiceActivity(logs, {
      searchTerm: logsSearchTerm,
      source: logsSourceFilter,
      replica: logsReplicaFilter,
      selectedReplicaNames: effectiveSelectedReplicaNames,
      clearedAt,
    }),
    [clearedAt, effectiveSelectedReplicaNames, logs, logsReplicaFilter, logsSearchTerm, logsSourceFilter],
  )

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

  // Loading / error states — AFTER all hooks (Rules of Hooks: returns must
  // come after every unconditional hook call).
  if (deploymentLoading || containerLoading) {
    return <PageSkeleton label="Loading service activity" blocks={1} withStrip={false} />
  }

  if (deploymentError) {
    return <InlineError title="Could not load service activity" error={deploymentError} onRetry={() => void refetchDeployments()} />
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Activity"
        description="Status events for this service: deployment results, replica state and mesh changes. This is not the process output of your containers — open a replica in Docker for that."
      />
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <ReplicaSidebar
          searchTerm={replicaSearchTerm}
          onSearchTermChange={setReplicaSearchTerm}
          visibleReplicaNames={filteredReplicaNames}
          totalReplicaCount={replicaNames.length}
          selectedReplicaNames={effectiveSelectedReplicaNames}
          allVisibleSelected={allVisibleReplicasSelected}
          someVisibleSelected={someVisibleReplicasSelected}
          onSelectAllVisible={() => {
            setSelectionTouched(true)
            setSelectedReplicaNames(new Set(filteredReplicaNames))
          }}
          onClearSelection={() => {
            setSelectionTouched(true)
            setSelectedReplicaNames(new Set())
          }}
          onToggleReplica={(replicaName, pressed) => {
            setSelectionTouched(true)
            setSelectedReplicaNames((previous) => {
              const next = new Set(previous)
              if (pressed) next.add(replicaName)
              else next.delete(replicaName)
              return next
            })
          }}
        />

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
          <div className="border-b border-border/60 bg-background/70 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className={`size-2 rounded-full ${meshSseStatus === 'connected' ? 'bg-status-live' : 'bg-status-idle'}`} aria-hidden />
                <span className="font-medium">{meshSseStatus === 'connected' ? 'Live' : 'Not live'}</span>
                <Badge variant="outline" className="text-xs">Event stream: {meshSseStatus}</Badge>
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
                  Follow newest
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
                  className="h-8 gap-1.5"
                  onClick={() => {
                    const text = formatActivityLines(displayedLogs)
                    void navigator.clipboard.writeText(text).then(() => {
                      setCopied(true)
                      window.setTimeout(() => { setCopied(false) }, 1500)
                    })
                  }}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    const payload = formatActivityLines(displayedLogs)
                    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const anchor = document.createElement('a')
                    anchor.href = url
                    anchor.download = `${serviceId}-logs.txt`
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
                  placeholder="Search events"
                />
              </div>
              <select aria-label="Filter by source"
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
              <select aria-label="Filter by replica"
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
            <Badge variant="outline">{displayedLogs.length} events</Badge>
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
              <span className="text-xs text-muted-foreground">Select all visible</span>
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
            {displayedLogs.length === 0 ? <p className="text-slate-300">No events match the current filters.</p> : null}
          </div>
        </section>
      </div>
    </div>
  )
}
