'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Boxes, Globe, Layers, ListTree } from 'lucide-react'
import { PageErrorState, PageLoadingState, StatusBadge } from '@/components/dashboard'
import { useClusterServices, useClusterTasks } from '@/domains/cluster/hooks'

interface ServiceRow {
  id: string
  name: string
  mode: 'global' | 'replicated'
  replicas: number | null
  image: string
  desiredTasks: number
  runningTasks: number
  labels?: Record<string, string>
}

interface TaskRow {
  id: string
  serviceId: string
  serviceName: string
  nodeId: string | null
  slot: number | null
  state: string
  desiredState: string
  error?: string | null
  image?: string
}

/**
 * FleetWorkloadsPanel — the mesh-wide workload surface of the cluster page.
 *
 * Two tables fed by the real fleet API:
 *  - Services: every swarm service (global runs everywhere, replicated has
 *    a target replica count) with desired vs running task counts.
 *  - Tasks: live swarm tasks, filterable by service.
 *
 * This is the "cluster is not a node" spine: workloads live here at the
 * fleet level; per-node resources live on the node workspace.
 */
export function FleetWorkloadsPanel() {
  const [serviceFilter, setServiceFilter] = useState<string>('all')

  const { data: servicesData, isLoading, error, refetch } = useClusterServices()
  const { data: tasksData, isLoading: tasksLoading } = useClusterTasks(
    serviceFilter === 'all' ? {} : { serviceId: serviceFilter },
  )

  const services = useMemo<ServiceRow[]>(() => (servicesData ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    mode: s.mode,
    replicas: s.replicas,
    image: s.image,
    desiredTasks: s.desiredTasks,
    runningTasks: s.runningTasks,
    labels: s.labels ?? {},
  })), [servicesData])

  const tasks = useMemo<TaskRow[]>(() => (tasksData ?? []).map((t) => ({
    id: t.id,
    serviceId: t.serviceId,
    serviceName: t.serviceName,
    nodeId: t.nodeId,
    slot: t.slot,
    state: t.state || t.desiredState,
    desiredState: t.desiredState,
    error: t.error ?? null,
    image: t.image ?? '',
  })), [tasksData])

  if (isLoading) return <PageLoadingState label="Loading swarm workloads…" />

  if (error) {
    return (
      <PageErrorState
        title="Unable to load swarm workloads"
        message="The fleet service/task surface could not be fetched. Check that the engine is in Swarm mode."
        onRetry={() => void refetch()}
      />
    )
  }

  const runningTasks = tasks.filter((t) => t.state === 'running').length
  const globalCount = services.filter((s) => s.mode === 'global').length

  return (
    <div className="space-y-5">
      {/* Fleet health strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Boxes className="size-4 text-muted-foreground" /> Services
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{services.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Globe className="size-4 text-muted-foreground" /> Global
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{globalCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ListTree className="size-4 text-muted-foreground" /> Tasks
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{tasks.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Layers className="size-4 text-muted-foreground" /> Running
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {runningTasks}
            <span className="text-sm font-normal text-muted-foreground"> / {tasks.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* Services */}
      <Card>
        <CardHeader>
          <CardTitle>Swarm services</CardTitle>
          <CardDescription>
            Services are mesh-wide objects. Global services run on every node; replicated services
            have a target replica count. Tasks are per-node — drill into a node to see its share.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-center">Desired</TableHead>
                <TableHead className="text-center">Running</TableHead>
                <TableHead>Image</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No swarm services yet. Deployments and supervised services appear here once scheduled.
                  </TableCell>
                </TableRow>
              ) : (
                services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{service.name}</span>
                        {service.labels?.['deployer.managed'] === 'true' && (
                          <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                            managed
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={service.mode === 'global' ? 'default' : 'secondary'}>
                        {service.mode}
                        {service.mode === 'replicated' && service.replicas != null
                          ? ` × ${service.replicas}`
                          : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono">{service.desiredTasks}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {service.runningTasks > 0 && service.runningTasks >= service.desiredTasks ? (
                          <StatusBadge status="healthy" />
                        ) : service.runningTasks > 0 ? (
                          <StatusBadge status="degraded" />
                        ) : (
                          <StatusBadge status="inactive" />
                        )}
                        <span className="font-mono">{service.runningTasks}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">
                      {service.image || '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Tasks */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Swarm tasks</CardTitle>
            <CardDescription>
              Live task placement across the fleet. Tasks carry the node they are scheduled on.
            </CardDescription>
          </div>
          <Select value={serviceFilter} onValueChange={setServiceFilter} aria-label="Filter by service">
            <SelectTrigger className="w-56" aria-label="Filter tasks by service">
              <SelectValue placeholder="All services" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {tasksLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading tasks…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead className="text-center">Slot</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Desired</TableHead>
                  <TableHead>Image</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      No tasks match the current filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono text-xs">{task.id.slice(0, 12)}…</TableCell>
                      <TableCell className="font-medium">{task.serviceName || task.serviceId.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs">{task.nodeId ? task.nodeId.slice(0, 12) + '…' : '—'}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{task.slot ?? '—'}</TableCell>
                      <TableCell>
                        <StatusBadge
                          status={
                            task.state === 'running'
                              ? 'healthy'
                              : task.state === 'failed' || task.state === 'rejected'
                                ? 'unhealthy'
                                : task.state === 'shutdown'
                                  ? 'inactive'
                                  : 'degraded'
                          }
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{task.desiredState}</TableCell>
                      <TableCell className="max-w-70 truncate font-mono text-xs text-muted-foreground">
                        {task.image || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}