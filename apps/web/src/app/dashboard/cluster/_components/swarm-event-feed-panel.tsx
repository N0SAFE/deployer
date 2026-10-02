'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Radio } from 'lucide-react'
import { StatusBadge } from '@/components/dashboard'
import type { DockerRuntimeActivityEntity } from '@repo/contracts-entities'
import { formatDateTime as formatDate } from '@/lib/format/date'
import { dockerEndpoints } from '@/domains/docker/endpoints'

/**
 * SwarmEventFeedPanel — the live orchestrator event feed.
 *
 * ── WHY THIS IS NOT JUST ANOTHER TABLE OF SERVICES ──────────────────────────
 * The fleet tables beside this panel show STATE, polled/re-read on events. What
 * they cannot show is the SEQUENCE — and on swarm the sequence is the diagnosis.
 * The ingress incident is the worked example: `service.update` events piled up
 * while the service sat at 0/1, and only the ORDER (create → update → task
 * rejected → task rejected → …) made it obvious that the port was held by
 * another container rather than that the image was bad.
 *
 * ── WHY EVERY ROW CARRIES A TASK ERROR ──────────────────────────────────────
 * The daemon emits swarm events with NO state and emits NO task events at all
 * (verified on engine 29.8.1: zero `task` events with a crash-looping and a
 * Pending service present). So the reason a workload will not start — the text
 * an operator can act on — is attached server-side from live task state:
 *
 *   "no suitable node (host-mode port already in use on 1 node)"
 *   "network sandbox join failed: … error creating vxlan interface: file exists"
 *
 * Without that enrichment this panel would render `service.update` repeatedly
 * and explain nothing, which is exactly the failure mode it exists to prevent.
 */
const SWARM_SOURCES = ['service', 'node', 'task'] as const

export function SwarmEventFeedPanel() {
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [liveActivitiesByKey, setLiveActivitiesByKey] = useState<Record<string, DockerRuntimeActivityEntity>>({})
  const liveBufferRef = useRef<DockerRuntimeActivityEntity[]>([])
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // One stream per source keeps the server-side filter cheap, and switching the
  // filter does not tear down a subscription that is still useful.
  const streamQuery = useQuery(
    dockerEndpoints.runtime.activity.stream.experimental_liveObservableOptions({
      input: { query: sourceFilter === 'all' ? undefined : { source: sourceFilter } },
    }),
  )

  const streamStatus = streamQuery.isError
    ? 'error'
    : streamQuery.fetchStatus === 'fetching'
      ? streamQuery.data
        ? 'connected'
        : 'connecting'
      : streamQuery.data
        ? 'connected'
        : 'disconnected'

  const flushLiveBuffer = () => {
    const items = liveBufferRef.current
    liveBufferRef.current = []
    if (items.length === 0) return
    setLiveActivitiesByKey((previous) => {
      const next = { ...previous }
      for (const activity of items) {
        next[activity.eventId ?? activity.id] = activity
      }
      // Keep the feed bounded — this stream is unbounded by nature.
      const ordered = Object.values(next)
        .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
        .map((item) => item.eventId ?? item.id)
      if (ordered.length > 300) {
        for (const stale of ordered.slice(300)) delete next[stale]
      }
      return next
    })
  }

  useEffect(() => {
    if (!streamQuery.data) return
    liveBufferRef.current.push(streamQuery.data as DockerRuntimeActivityEntity)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    // Debounced like the activity page: swarm events arrive in bursts (create +
    // several updates per replica), and re-rendering per event is wasted work.
    debounceTimerRef.current = setTimeout(flushLiveBuffer, 150)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [streamQuery.data])

  const activities = useMemo<DockerRuntimeActivityEntity[]>(
    () =>
      Object.values(liveActivitiesByKey).sort(
        (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
      ),
    [liveActivitiesByKey],
  )

  const failingTasks = activities.flatMap((activity) =>
    activity.swarmTasks
      .filter((task) => task.error !== null)
      .map((task) => task.error as string),
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4" />
              Swarm event feed
            </CardTitle>
            <CardDescription>
              Live orchestrator events. Task failure reasons are read from live task state — the engine
              emits swarm events with no state and no task events at all.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={streamStatus === 'connected' ? 'default' : 'outline'}>{streamStatus}</Badge>
            {failingTasks.length > 0 ? (
              <Badge variant="destructive">{failingTasks.length} task errors</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...SWARM_SOURCES] as const).map((source) => (
            <Button
              key={source}
              size="sm"
              variant={sourceFilter === source ? 'default' : 'outline'}
              onClick={() => setSourceFilter(source)}
              aria-pressed={sourceFilter === source}
            >
              {source === 'all' ? 'All swarm' : source}
            </Button>
          ))}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Occurred</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No swarm events yet. Services, tasks and nodes emit here as the orchestrator acts.
                </TableCell>
              </TableRow>
            ) : (
              activities.map((activity) => {
                const taskErrors = activity.swarmTasks
                  .map((task) => task.error)
                  .filter((error): error is string => error !== null && error.trim().length > 0)
                const service = activity.swarmService
                const resource = service?.serviceName
                  ?? activity.actorAttributes['name']
                  ?? activity.actorId?.slice(0, 12)
                  ?? '—'

                return (
                  <TableRow key={activity.id}>
                    <TableCell className="font-medium">
                      {activity.source}.{activity.action}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="space-y-0.5">
                        <p className="font-mono">{resource}</p>
                        {service ? (
                          <p className="text-muted-foreground">
                            {String(service.runningTasks)}/{String(service.desiredTasks)} tasks · {service.mode}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={activity.status} />
                    </TableCell>
                    <TableCell className="max-w-100">
                      {/* Task error first: on a failure this is the ONLY text
                          that tells the operator what to change. */}
                      {taskErrors.length > 0 ? (
                        <p className="truncate text-xs font-medium text-destructive" title={taskErrors[0]}>
                          {taskErrors[0]}
                        </p>
                      ) : (
                        <p className="truncate text-xs text-muted-foreground">
                          {activity.message ?? service?.updateMessage ?? '—'}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(activity.occurredAt)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
