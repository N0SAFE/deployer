'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DockerContainerDetailModalTrigger } from '../_components/container-detail-modal'
import { DockerInlineLoadingState, DockerTableLoadingRows } from '../_components/docker-loading-states'
import {
  useDockerRuntimeActivityDetail,
  useDockerRuntimeActivityList,
} from '@/domains/docker/hooks'
import { dockerEndpoints } from '@/domains/docker/endpoints'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Activity, Search } from 'lucide-react'
import type { DockerRuntimeActivityEntity } from '@repo/contracts-entities'
import { isRecord, isObjectLike } from "@repo/type-guards"


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
type ActivityStatus = DockerRuntimeActivityEntity['status']
type ActivityCategory = DockerRuntimeActivityEntity['category']
type ActivitySeverity = DockerRuntimeActivityEntity['severity']

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function toStatusBadgeVariant(status: ActivityStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default'
  if (status === 'error') return 'destructive'
  if (status === 'running') return 'secondary'
  if (status === 'queued') return 'outline'
  return 'secondary'
}

function toSeverityBadgeVariant(severity: ActivitySeverity): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (severity === 'error') return 'destructive'
  if (severity === 'warning') return 'secondary'
  return 'outline'
}

function toCategoryBadgeVariant(category: ActivityCategory): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (category === 'image-scanning') {
    return 'secondary'
  }
  return 'outline'
}

function parseProgress(activity: DockerRuntimeActivityEntity): number | null {
  return activity.progress
}

function resolveResourceName(activity: DockerRuntimeActivityEntity): string {
  const payload = isRecord(activity.payload) ? activity.payload : {}
  const candidates = [
    payload.containerName,
    payload.imageName,
    payload.repository,
    payload.networkName,
    payload.volumeName,
    payload.serviceName,
    payload.daemonName,
    payload.builderName,
    activity.actorId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }

  return `${activity.source}-event`
}

function resolveContainerId(activity: DockerRuntimeActivityEntity): string | undefined {
  const payload = isRecord(activity.payload) ? activity.payload : {}
  const candidate = typeof payload.containerId === 'string'
    ? payload.containerId
    : activity.source === 'container' && typeof activity.actorId === 'string'
      ? activity.actorId
      : undefined

  return candidate && candidate.trim().length > 0 ? candidate : undefined
}

const ACTIVITY_STREAM_INPUT = {}

export default function DashboardDockerActivityPage() {
  const [activitySearchTerm, setActivitySearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ActivityStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | ActivityCategory>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | ActivitySeverity>('all')
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null)
  const [liveActivitiesByKey, setLiveActivitiesByKey] = useState<Record<string, DockerRuntimeActivityEntity>>({})

  const activityListQuery = useDockerRuntimeActivityList({
    query: {
      limit: 300,
      offset: 0,
      sortBy: 'occurredAt',
      sortDirection: 'desc',
    },
  })

  // Live activity stream — server-side projects runtime events to
  // `DockerRuntimeActivityEntity` so the client doesn't have to redo the
  // status/severity/category inference. Each emission is a fully-formed
  // activity that we merge with the persisted list below.
  const liveStreamQuery = useQuery(
    dockerEndpoints.runtime.activity.stream.experimental_liveObservableOptions({
      input: { query: undefined },
    }),
  )
  const runtimeSseStatus = liveStreamQuery.isError
    ? 'error'
    : liveStreamQuery.fetchStatus === 'fetching'
      ? liveStreamQuery.data
        ? 'connected'
        : 'connecting'
      : liveStreamQuery.data
        ? 'connected'
        : 'disconnected'

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveBufferRef = useRef<DockerRuntimeActivityEntity[]>([])
  const flushLiveBuffer = () => {
    const items = liveBufferRef.current
    liveBufferRef.current = []
    if (items.length === 0) {
      return
    }
    setLiveActivitiesByKey((previous) => {
      const next = { ...previous }
      for (const activity of items) {
        const key = activity.eventId ?? activity.id
        next[key] = activity
      }
      const orderedKeys = Object.values(next)
        .sort(
          (left, right) =>
            new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
        )
        .map((item) => item.eventId ?? item.id)
      if (orderedKeys.length > 200) {
        for (const stale of orderedKeys.slice(200)) {
          delete next[stale]
        }
      }
      return next
    })
  }

  useEffect(() => {
    if (!liveStreamQuery.data) {
      return
    }
    liveBufferRef.current.push(liveStreamQuery.data as DockerRuntimeActivityEntity)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(flushLiveBuffer, 150)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [liveStreamQuery.data])

  const liveActivities = useMemo<DockerRuntimeActivityEntity[]>(
    () => Object.values(liveActivitiesByKey)
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
      ),
    [liveActivitiesByKey],
  )

  const persistedActivities = activityListQuery.data?.data ?? []

  const mergedActivities = useMemo<DockerRuntimeActivityEntity[]>(() => {
    const map = new Map<string, DockerRuntimeActivityEntity>()

    for (const activity of persistedActivities) {
      const key = activity.eventId ?? activity.id
      map.set(key, activity)
    }

    for (const activity of liveActivities) {
      const key = activity.eventId ?? activity.id
      if (!map.has(key)) {
        map.set(key, activity)
      }
    }

    return Array.from(map.values())
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
  }, [liveActivities, persistedActivities])

  const filteredActivities = useMemo(() => {
    const normalized = activitySearchTerm.trim().toLowerCase()

    return mergedActivities.filter((activity) => {
      if (statusFilter !== 'all' && activity.status !== statusFilter) {
        return false
      }

      if (categoryFilter !== 'all' && activity.category !== categoryFilter) {
        return false
      }

      if (severityFilter !== 'all' && activity.severity !== severityFilter) {
        return false
      }

      if (!normalized) {
        return true
      }

      const resourceName = resolveResourceName(activity)
      return (
        activity.source.toLowerCase().includes(normalized)
        || activity.action.toLowerCase().includes(normalized)
        || activity.status.toLowerCase().includes(normalized)
        || activity.category.toLowerCase().includes(normalized)
        || activity.severity.toLowerCase().includes(normalized)
        || resourceName.toLowerCase().includes(normalized)
        || (activity.stage?.toLowerCase().includes(normalized) ?? false)
        || (activity.scanner?.toLowerCase().includes(normalized) ?? false)
        || (activity.message?.toLowerCase().includes(normalized) ?? false)
      )
    })
  }, [activitySearchTerm, categoryFilter, mergedActivities, severityFilter, statusFilter])

  const queuedActivities = useMemo(
    () => filteredActivities.filter((activity) => activity.status === 'queued'),
    [filteredActivities],
  )

  const selectedPersistedActivityId = selectedActivityId && !selectedActivityId.startsWith('live:')
    ? selectedActivityId
    : null

  const selectedActivityDetailQuery = useDockerRuntimeActivityDetail(
    {
      query: {
        id: selectedPersistedActivityId ?? '00000000-0000-0000-0000-000000000000',
      },
    },
    {
      enabled: Boolean(selectedPersistedActivityId),
    },
  )

  const selectedActivity = useMemo<DockerRuntimeActivityEntity | null>(() => {
    const inList = mergedActivities.find((activity) => activity.id === selectedActivityId) ?? null
    if (!selectedPersistedActivityId) {
      return inList
    }

    const detailData = selectedActivityDetailQuery.data
    if (detailData && typeof detailData === 'object' && 'body' in detailData) {
      return (detailData as { body: DockerRuntimeActivityEntity | null }).body ?? inList
    }

    return (detailData as DockerRuntimeActivityEntity | undefined) ?? inList
  }, [mergedActivities, selectedActivityDetailQuery.data, selectedActivityId, selectedPersistedActivityId])

  const isLoading = activityListQuery.isLoading && mergedActivities.length === 0

  return (
    <div className="space-y-5">
      {activityListQuery.isLoading ? <DockerInlineLoadingState label="Loading runtime activity stream and persisted history…" /> : null}
      <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
        <div className="border-b border-border/60 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Activity</h2>
            <Badge className="" variant="outline">{filteredActivities.length}</Badge>
            <Badge className="" variant={runtimeSseStatus === 'error' ? 'destructive' : runtimeSseStatus === 'connected' ? 'default' : 'secondary'}>
              stream {runtimeSseStatus}
            </Badge>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7">
                  Queue
                  <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px]">
                    {queuedActivities.length}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-md p-0">
                <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Queued activity (click to open details)</div>
                <div className="max-h-80 overflow-auto">
                  {queuedActivities.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted-foreground">No queued events for current filters.</p>
                  ) : queuedActivities.map((activity) => (
                    <button
                      key={`queue-${activity.id}`}
                      type="button"
                      onClick={() => {
                        setSelectedActivityId(activity.id)
                      }}
                      className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{activity.source}.{activity.action}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{resolveResourceName(activity)}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{formatDate(activity.occurredAt)}</p>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">All events are replayable from persisted DB activity, with live runtime updates merged in.</p>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={activitySearchTerm}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setActivitySearchTerm(event.target.value)
                }}
                className="pl-9"
                placeholder="Search activity"
              />
            </div>
            <select aria-label="All categories"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value as 'all' | ActivityCategory)
              }}
            >
              <option value="all">All categories</option>
              <option value="image-scanning">Image scanning</option>
              <option value="runtime-event">Runtime events</option>
            </select>
            <select aria-label="All status"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | ActivityStatus)
              }}
            >
              <option value="all">All status</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="error">Error</option>
              <option value="info">Info</option>
            </select>
            <select aria-label="All severities"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={severityFilter}
              onChange={(event) => {
                setSeverityFilter(event.target.value as 'all' | ActivitySeverity)
              }}
            >
              <option value="all">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>

          <Table className="">
            <TableHeader className="">
              <TableRow className="">
                <TableHead className="">Name</TableHead>
                <TableHead className="">Status</TableHead>
                <TableHead className="">Category</TableHead>
                <TableHead className="">Message</TableHead>
                <TableHead className="">Occurred</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="">
              {isLoading ? (
                <DockerTableLoadingRows columns={5} rows={8} />
              ) : filteredActivities.map((activity) => {
                  const containerId = resolveContainerId(activity)
                  const actionLabel = `${activity.source}.${activity.action}`

                  return (
                    <TableRow
                      key={activity.id}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedActivityId(activity.id)
                      }}
                    >
                      <TableCell className="">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">
                              {containerId ? (
                                <DockerContainerDetailModalTrigger id={containerId}>
                                  {actionLabel}
                                </DockerContainerDetailModalTrigger>
                              ) : actionLabel}
                            </p>
                            {typeof activity.progress === 'number' ? (
                              <div className="flex min-w-30 items-center gap-2">
                                <div className="h-1.5 w-20 overflow-hidden rounded bg-muted">
                                  <div className="h-full bg-primary transition-all" style={{ width: `${String(activity.progress)}%` }} />
                                </div>
                                <span className="text-[11px] text-muted-foreground">{activity.progress}%</span>
                              </div>
                            ) : null}
                          </div>
                          <p className="text-[11px] text-muted-foreground">{resolveResourceName(activity)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className="" variant={toStatusBadgeVariant(activity.status)}>{activity.status}</Badge>
                          <Badge className="" variant={toSeverityBadgeVariant(activity.severity)}>{activity.severity}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="">
                        <Badge className="" variant={toCategoryBadgeVariant(activity.category)}>{activity.category}</Badge>
                      </TableCell>
                      <TableCell className="max-w-100">
                        <p className="truncate text-xs text-muted-foreground">
                          {activity.message ?? activity.stage ?? activity.scanner ?? '—'}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(activity.occurredAt)}</TableCell>
                    </TableRow>
                  )
                })}
              {!isLoading && filteredActivities.length === 0 ? (
                <TableRow className="">
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No activity events match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          {selectedActivity ? (
            <div className="rounded-lg border border-border/60 bg-background/40 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Activity details</h3>
                <div className="flex items-center gap-1.5">
                  <Badge className="" variant={toStatusBadgeVariant(selectedActivity.status)}>{selectedActivity.status}</Badge>
                  <Badge className="" variant={toSeverityBadgeVariant(selectedActivity.severity)}>{selectedActivity.severity}</Badge>
                </div>
              </div>
              <div className="grid gap-3 text-xs md:grid-cols-2">
                <p><span className="text-muted-foreground">Source:</span> {selectedActivity.source}</p>
                <p><span className="text-muted-foreground">Action:</span> {selectedActivity.action}</p>
                <p><span className="text-muted-foreground">Flow:</span> {selectedActivity.flowId}</p>
                <p><span className="text-muted-foreground">Occurred:</span> {formatDate(selectedActivity.occurredAt)}</p>
                <p><span className="text-muted-foreground">Resource:</span> {resolveResourceName(selectedActivity)}</p>
                <p><span className="text-muted-foreground">Progress:</span> {typeof selectedActivity.progress === 'number' ? `${String(selectedActivity.progress)}%` : '—'}</p>
                <p><span className="text-muted-foreground">Stage:</span> {selectedActivity.stage ?? '—'}</p>
                <p><span className="text-muted-foreground">Scanner:</span> {selectedActivity.scanner ?? '—'}</p>
              </div>
              {selectedActivity.message ? (
                <p className="mt-3 rounded border border-border/60 bg-background px-2 py-1.5 text-xs">
                  {selectedActivity.message}
                </p>
              ) : null}
              <details className="mt-3 rounded border border-border/60 bg-background/60 p-2">
                <summary className="cursor-pointer text-xs font-medium">Payload + attributes</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
{JSON.stringify({
  actorAttributes: selectedActivity.actorAttributes,
  payload: selectedActivity.payload,
  raw: selectedActivity.raw,
}, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}

          {selectedPersistedActivityId && selectedActivityDetailQuery.isFetching ? (
            <p className="text-xs text-muted-foreground">Loading selected activity details…</p>
          ) : null}
          {selectedPersistedActivityId && selectedActivityDetailQuery.isError ? (
            <p className="text-xs text-destructive">Failed to load detail for selected activity.</p>
          ) : null}
          {activityListQuery.isError ? (
            <p className="text-xs text-destructive">Failed to load persisted activity history.</p>
          ) : null}
          {!isLoading && filteredActivities.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tip: start a container/image operation or force a scan to produce new events.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
