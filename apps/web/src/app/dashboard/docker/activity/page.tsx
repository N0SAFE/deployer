'use client'

import { useMemo, useState } from 'react'
import { DockerContainerDetailModalTrigger } from '../_components/docker-container-detail-modal'
import {
  useDockerContainerList,
  useDockerDeploymentList,
  useDockerMeshEventStreams,
  useDockerMeshSseState,
} from '@/domains/docker/mock-hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Activity, Search } from 'lucide-react'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const MESH_STREAM_LIST_INPUT = {
  query: {
    limit: 50,
    offset: 0,
  },
} as const

interface EventProjection {
  id: string
  label: string
  detail: string
  severity: 'info' | 'warning' | 'error'
  timestamp: string
  containerId?: string
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'down') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'deploying') {
    return 'secondary'
  }
  return 'outline'
}

export default function DashboardDockerActivityPage() {
  const [activitySearchTerm, setActivitySearchTerm] = useState('')
  const [activitySeverityFilter, setActivitySeverityFilter] = useState<'all' | EventProjection['severity']>('all')

  const { data: deploymentData } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: containerEntityData } = useDockerContainerList(DEPLOYMENT_LIST_INPUT)
  const {
    data: meshEventStreamsData,
    isLoading: meshEventStreamsLoading,
  } = useDockerMeshEventStreams(MESH_STREAM_LIST_INPUT)
  const { state: meshState, status: meshSseStatus } = useDockerMeshSseState()

  const deployments = deploymentData?.data ?? []
  const containerEntities = containerEntityData?.data ?? []
  const meshEventStreams = meshEventStreamsData?.data ?? []

  const recentEvents = useMemo<EventProjection[]>(() => {
    const projected: EventProjection[] = []
    const containerIdByName = new Map(containerEntities.map((container) => [container.name, container.id]))

    for (const deployment of deployments.slice(0, 20)) {
      const containerName = deployment.containerName ?? `deployment-${shortId(deployment.id)}`
      const containerId = containerIdByName.get(containerName)
      projected.push({
        id: deployment.id,
        label: `Deployment ${shortId(deployment.id)} ${deployment.status}`,
        detail: `service ${shortId(deployment.serviceId)} · ${deployment.environment} · ${deployment.sourceType}`,
        containerId,
        severity:
          deployment.status === 'failed'
            ? 'error'
            : deployment.status === 'cancelled'
              ? 'warning'
              : 'info',
        timestamp: deployment.updatedAt,
      })
    }

    if (meshState) {
      projected.push({
        id: `mesh-${String(meshState.revision)}`,
        label: `Mesh ${meshState.reason.replaceAll('_', ' ')}`,
        detail: `${String(meshState.peers.length)} peer links · ${String(meshState.sessions.length)} sessions · revision ${String(meshState.revision)}`,
        severity: 'info',
        timestamp: meshState.emittedAt,
      })
    }

    return projected.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [containerEntities, deployments, meshSseStatus, meshState])

  const filteredActivityEvents = useMemo(() => {
    const normalized = activitySearchTerm.trim().toLowerCase()

    return recentEvents.filter((event) => {
      if (activitySeverityFilter !== 'all' && event.severity !== activitySeverityFilter) {
        return false
      }

      if (!normalized) {
        return true
      }

      return event.label.toLowerCase().includes(normalized) || event.detail.toLowerCase().includes(normalized)
    })
  }, [activitySearchTerm, activitySeverityFilter, recentEvents])

  const activeMeshStreams = meshEventStreams.filter((stream) => stream.isActive).length

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
        <div className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold">Activity timeline</h2>
          <p className="text-xs text-muted-foreground">
            Deployments + mesh runtime stream stitched into a Dockhand-style activity feed.
          </p>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={activitySearchTerm}
                onChange={(event) => {
                  setActivitySearchTerm(event.target.value)
                }}
                className="pl-9"
                placeholder="Search timeline"
              />
            </div>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={activitySeverityFilter}
              onChange={(event) => {
                setActivitySeverityFilter(event.target.value as 'all' | EventProjection['severity'])
              }}
            >
              <option value="all">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>

          {filteredActivityEvents.map((event) => (
            <div key={event.id} className="rounded border p-3 text-sm space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {event.containerId ? (
                    <DockerContainerDetailModalTrigger id={event.containerId}>
                      {event.label}
                    </DockerContainerDetailModalTrigger>
                  ) : (
                    event.label
                  )}
                </p>
                <Badge variant={toBadgeVariant(event.severity)}>{event.severity}</Badge>
              </div>
              <p className="text-muted-foreground text-xs">{event.detail}</p>
              <p className="text-xs text-muted-foreground">{formatDate(event.timestamp)}</p>
            </div>
          ))}
          {filteredActivityEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity events match the current filters.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
        <div className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold">Mesh stream registry</h2>
          <p className="text-xs text-muted-foreground">Subscription-capable streams available in the control plane.</p>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">SSE status</p>
              <p className="text-lg font-semibold flex items-center gap-1.5">
                <Activity className="h-4 w-4" />
                {meshSseStatus}
              </p>
            </div>
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">Active streams</p>
              <p className="text-lg font-semibold">{activeMeshStreams}</p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {meshEventStreams.map((stream) => (
                <TableRow key={stream.id}>
                  <TableCell className="font-medium">{stream.name}</TableCell>
                  <TableCell>{stream.scope}</TableCell>
                  <TableCell>
                    <Badge variant={stream.isActive ? 'default' : 'outline'}>
                      {stream.isActive ? 'active' : 'inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(stream.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {meshEventStreams.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {meshEventStreamsLoading ? 'Loading stream definitions…' : 'No stream definitions found.'}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
      </div>
    </div>
  )
}
