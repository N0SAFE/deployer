'use client'

import { Cpu, HardDrive, Layers, Network, Server } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { EmptyState, PageErrorState, StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import { useNodeResources } from '@/domains/cluster/hooks'

function taskStatus(state: string): string {
  if (state === 'running') return 'healthy'
  if (state === 'failed' || state === 'rejected') return 'unhealthy'
  if (state === 'shutdown') return 'inactive'
  return 'degraded'
}

/** Swarm services/tasks on this node plus engine artifacts. */
export function NodeFleetTab({ nodeId, isLocal }: { nodeId: string; isLocal: boolean }) {
  const { data: resources, isLoading, error, refetch } = useNodeResources(nodeId)

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading node resources">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }
  if (error) {
    return (
      <PageErrorState
        title="Unable to load node resources"
        message="The per-node swarm aggregation could not be fetched. The node may be offline."
        onRetry={() => void refetch()}
      />
    )
  }

  const scope = resources?.dockerScope ?? 'remote'
  const services = resources?.services ?? []
  const tasks = resources?.tasks ?? []
  const artifactHint = isLocal ? 'this node' : 'dashboard node'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={scope === 'local' ? 'default' : 'secondary'} className="gap-1">
          <Network className="size-3" /> {scope} engine
        </Badge>
        {isLocal ? null : (
          <span className="text-sm text-muted-foreground">
            Only swarm-visible data is exact for a remote node; images, networks and volumes are read from the node serving this dashboard.
          </span>
        )}
      </div>

      <StatStrip>
        <StatStripItem icon={Server} label="Services" value={services.length} hint="swarm-wide" />
        <StatStripItem icon={Cpu} label="Tasks" value={tasks.length} hint="swarm-wide" />
        <StatStripItem icon={Layers} label="Images" value={resources?.images.length ?? 0} hint={artifactHint} />
        <StatStripItem icon={Network} label="Networks" value={resources?.networks.length ?? 0} hint={artifactHint} />
        <StatStripItem icon={HardDrive} label="Volumes" value={resources?.volumes.length ?? 0} hint={artifactHint} />
      </StatStrip>

      <Card>
        <CardHeader>
          <CardTitle>Services scheduled on this node</CardTitle>
          <CardDescription>Global services run on every node; replicated ones appear when they own a task here.</CardDescription>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <EmptyState compact icon={Server} title="No services scheduled on this node" description="Deploy a service, or check that this node is allocated capacity." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Desired</TableHead>
                  <TableHead className="text-right">Running</TableHead>
                  <TableHead>Image</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-mono text-sm font-medium">{service.name}</TableCell>
                    <TableCell>
                      <Badge variant={service.mode === 'global' ? 'default' : 'secondary'}>
                        {service.mode}
                        {service.mode === 'replicated' && service.replicas != null ? ` × ${String(service.replicas)}` : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{service.desiredTasks}</TableCell>
                    <TableCell className="text-right tabular-nums">{service.runningTasks}</TableCell>
                    <TableCell className="max-w-72 truncate font-mono text-xs text-muted-foreground" title={service.image}>
                      {service.image || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks on this node</CardTitle>
          <CardDescription>Live task placement with container state.</CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <EmptyState compact icon={Cpu} title="No tasks on this node" description="Tasks appear when a swarm service places a container here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Slot</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-xs" title={task.id}>{task.id.slice(0, 12)}</TableCell>
                    <TableCell className="font-medium">{task.serviceName || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{task.slot ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={taskStatus(task.state)}>{task.state}</StatusBadge></TableCell>
                    <TableCell className="max-w-72 truncate text-sm text-destructive" title={task.error ?? undefined}>
                      {task.error ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
