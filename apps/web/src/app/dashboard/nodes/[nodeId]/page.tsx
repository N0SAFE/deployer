'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AuthDashboardDeployments, AuthDashboardNodesNodeId } from '@/routes'
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
import { ArrowRight, Cpu, HardDrive, Info, Network, Server, TerminalSquare } from 'lucide-react'
import { PageHeader, PageLoadingState, PageErrorState, StatusBadge, ScopeLabel, StatusDot } from '@/components/dashboard'
import { useFleetServers, useFleetAllocations } from '@/domains/fleet/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useMeshLocalNode, useMeshNodeConfig, useMeshSseState } from '@/domains/mesh/hooks'
import { useNodeResources } from '@/domains/cluster/hooks'
import { isRecord } from '@repo/type-guards'

type Tab = 'overview' | 'deployments' | 'configuration' | 'fleet'

function formatBytes(mb: number | null | undefined): string {
  if (mb == null) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

function pct(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function statusOf(value: string | null | undefined): string {
  return value ?? 'unknown'
}

interface DeploymentRow {
  id: string
  serviceId: string
  status: string
  environment?: string | null
  triggeredBy?: string | null
  deployStartedAt?: string | null
  createdAt?: string | null
}

/** Typed projection of a fleet server row (API returns raw records). */
interface NodeDetail {
  nodeId: string
  swarmNodeId?: string | null
  serverUrl?: string | null
  displayName?: string | null
  status?: string
  healthy?: boolean
  lastSeenAt?: string | null
  maxCpuMillicores?: number | null
  maxMemoryMb?: number | null
  metrics?: { cpuUsage?: number; memoryUsage?: number } | null
}

/** Typed projection of a fleet allocation row. */
interface AllocationRow {
  id: string
  allocationMode?: string
  cpuMillicores?: number
  memoryMb?: number
  maxServices?: number | null
  isEnabled?: boolean
}

/**
 * Node workspace — everything scoped to a single node.
 *
 * Tabs:
 *  - Overview: node identity, health, capacity, allocation.
 *  - Deployments: deployments that ran on this node.
 *  - Configuration: how this node is configured (roles, routing, db).
 *
 * Docker for this node lives under the Docker section (it always operates
 * on the node that hosts the API answering the dashboard).
 */
export default function DashboardNodeDetailPage() {
  const params = useParams<{ nodeId: string }>()
  const nodeId = params.nodeId ?? ''
  const [tab, setTab] = useState<Tab>('overview')

  const { data: serversData, isLoading, error, refetch } = useFleetServers()
  const { data: allocationsData } = useFleetAllocations({ serverNodeId: nodeId })
  const { data: localNode } = useMeshLocalNode()
  const isLocal = localNode?.nodeId === nodeId
  const { data: localNodeConfig } = useMeshNodeConfig({ enabled: isLocal })
  const { state: meshEvent } = useMeshSseState()

  const node = useMemo<NodeDetail | null>(() => {
    const raw = serversData as { items?: Array<Record<string, unknown>> } | undefined
    // Match by nodeId (UUID) or swarmNodeId (Docker Swarm short ID)
    const item = (raw?.items ?? []).find(
      (i) => i.nodeId === nodeId || i.swarmNodeId === nodeId
    )
    if (!item) return null
    return {
      nodeId: String(item.nodeId ?? ''),
      swarmNodeId: item.swarmNodeId as string | null | undefined,
      serverUrl: item.serverUrl as string | null | undefined,
      displayName: item.displayName as string | null | undefined,
      status: item.status as string | undefined,
      healthy: item.healthy as boolean | undefined,
      lastSeenAt: item.lastSeenAt as string | null | undefined,
      maxCpuMillicores: item.maxCpuMillicores as number | null | undefined,
      maxMemoryMb: item.maxMemoryMb as number | null | undefined,
      metrics: item.metrics as { cpuUsage?: number; memoryUsage?: number } | null | undefined,
    }
  }, [serversData, nodeId])

  const allocations = useMemo<AllocationRow[]>(() => {
    const raw = allocationsData as { items?: Array<Record<string, unknown>> } | undefined
    return (raw?.items ?? []).map((item) => ({
      id: String(item.id ?? ''),
      allocationMode: item.allocationMode as string | undefined,
      cpuMillicores: item.cpuMillicores as number | undefined,
      memoryMb: item.memoryMb as number | undefined,
      maxServices: item.maxServices as number | null | undefined,
      isEnabled: item.isEnabled as boolean | undefined,
    }))
  }, [allocationsData])

  const deploymentQuery = useMemo(
    () => ({
      query: {
        filter: { nodeId: { operator: 'eq' as const, value: nodeId } },
        limit: 10,
        offset: 0,
      },
    }),
    [nodeId],
  )
  const { data: deploymentsData } = useDeploymentList(deploymentQuery)
  const deployments = useMemo<DeploymentRow[]>(() => {
    const raw = deploymentsData as { data?: DeploymentRow[] } | undefined
    return raw?.data ?? []
  }, [deploymentsData])

  const liveNode = useMemo(() => {
    const snapshotNodes = meshEvent?.snapshot?.nodes ?? []
    return snapshotNodes.find((n) => n.nodeId === nodeId) ?? null
  }, [meshEvent?.snapshot?.nodes, nodeId])

  const nodeName = node?.displayName || nodeId.slice(0, 8)

  if (isLoading) {
    return <PageLoadingState label="Loading node…" />
  }

  if (error && !node) {
    return (
      <PageErrorState
        title="Failed to load node"
        message="The node could not be found in the fleet."
        onRetry={() => void refetch()}
      />
    )
  }

  if (!node) {
    return (
      <PageErrorState
        title="Node not found"
        message={`No node with id ${nodeId} is registered in this mesh.`}
      />
    )
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'deployments', label: 'Deployments' },
    { id: 'fleet', label: 'Fleet' },
    { id: 'configuration', label: 'Configuration' },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Node"
        title={nodeName}
        description={
          isLocal
            ? 'This is the node you are connected to. Deployments, docker and configuration below are live from this node.'
            : `Remote node in the mesh. Deployments listed here ran on this node; docker operations always target the node you are connected to.`
        }
        badge={
          <>
            <ScopeLabel scope="node" nodeName={nodeName} />
            {isLocal ? (
              <Badge className="gap-1 bg-primary/10 font-normal text-primary">
                <Network className="size-3" /> local
              </Badge>
            ) : null}
            <StatusBadge status={statusOf(node.status)} />
          </>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/70">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="space-y-5">
          {/* Health strip */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Server className="size-4 text-muted-foreground" /> Status
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2 text-sm">
                <StatusDot status={statusOf(node.status)} />
                {statusOf(node.status)}
                {node.healthy ? ' · healthy' : ' · unhealthy'}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Cpu className="size-4 text-muted-foreground" /> CPU
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {pct(node.metrics?.cpuUsage)}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  /{' '}
                  {node.maxCpuMillicores != null
                    ? `${(node.maxCpuMillicores / 1000).toFixed(1)} vCPU`
                    : 'unlimited'}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="size-4 text-muted-foreground" /> Memory
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {pct(node.metrics?.memoryUsage)}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  / {formatBytes(node.maxMemoryMb)}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Info className="size-4 text-muted-foreground" /> Endpoint
                </CardTitle>
              </CardHeader>
              <CardContent className="truncate font-mono text-xs text-muted-foreground">
                {node.serverUrl ?? '—'}
              </CardContent>
            </Card>
          </div>

          {/* Mesh presence */}
          <Card>
            <CardHeader>
              <CardTitle>Mesh presence</CardTitle>
              <CardDescription>How this node is seen by the mesh control plane.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Lifecycle state</span>
                <span className="font-medium">{liveNode?.lifecycleState ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Roles</span>
                <span className="font-medium">
                  {liveNode?.roles?.length ? liveNode.roles.join(', ') : node.displayName ? 'edge' : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last seen</span>
                <span className="font-medium">
                  {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : '—'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Allocations */}
          <Card>
            <CardHeader>
              <CardTitle>Allocation</CardTitle>
              <CardDescription>Per-node resource budget granted by the fleet.</CardDescription>
            </CardHeader>
            <CardContent>
              {allocations.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No allocation for this node yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mode</TableHead>
                      <TableHead>CPU</TableHead>
                      <TableHead>Memory</TableHead>
                      <TableHead>Max services</TableHead>
                      <TableHead>Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map((a) => (
                      <TableRow key={String(a.id)}>
                        <TableCell className="font-medium">{String(a.allocationMode)}</TableCell>
                        <TableCell>{(Number(a.cpuMillicores) / 1000).toFixed(1)} vCPU</TableCell>
                        <TableCell>{formatBytes(a.memoryMb)}</TableCell>
                        <TableCell>{String(a.maxServices ?? '—')}</TableCell>
                        <TableCell>
                          {a.isEnabled ? <StatusBadge status="active" /> : <StatusBadge status="inactive" />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'deployments' ? (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span>Deployments on this node</span>
                <AuthDashboardDeployments.Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  All deployments <ArrowRight className="size-3.5" />
                </AuthDashboardDeployments.Link>
              </CardTitle>
              <CardDescription>
                Node-scoped deployment history. Use the node picker in the header to scope the
                Deployments page to this node.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deployment</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deployments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No deployments on this node yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    deployments.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs">{d.id.slice(0, 8)}</TableCell>
                        <TableCell className="font-medium">{d.serviceId}</TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.environment ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {d.deployStartedAt ?? d.createdAt
                            ? new Date(d.deployStartedAt ?? d.createdAt ?? '').toLocaleString()
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'configuration' ? (
        <div className="space-y-5">
          {isLocal && localNodeConfig ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="size-4 text-muted-foreground" /> Local node configuration
                </CardTitle>
                <CardDescription>
                  Configuration stored on this node. Remote nodes keep their own copy — change it
                  from the Configuration section of the node that hosts it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Strategy</span>
                  <span className="font-medium">{localNodeConfig.strategy}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Region</span>
                  <span className="font-medium">{localNodeConfig.region ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Zone</span>
                  <span className="font-medium">{localNodeConfig.zone ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Roles</span>
                  <span className="font-medium">
                    {localNodeConfig.roles?.length ? localNodeConfig.roles.join(', ') : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Routing mode</span>
                  <span className="font-medium">{localNodeConfig.routingMode ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Consistency mode</span>
                  <span className="font-medium">{localNodeConfig.consistencyMode ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Database URL</span>
                  <span className="max-w-[60%] truncate font-mono text-xs">{localNodeConfig.databaseUrl ?? '—'}</span>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TerminalSquare className="size-4 text-muted-foreground" /> Per-node operational notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                Deployments are executed by the node that owns the service allocation. This page
                lists them filtered by this node.
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                The Docker section always operates the daemon of the node serving this dashboard. To
                manage another node's containers, connect to that node&apos;s dashboard.
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                Allocations and capacity are set per node in the Configuration section.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'fleet' ? <NodeFleetResources nodeId={nodeId} isLocal={isLocal} /> : null}
    </div>
  )
}

/** Fleet-resources tab: swarm services/tasks on this node + engine artifacts. */
function NodeFleetResources({ nodeId, isLocal }: { nodeId: string; isLocal: boolean }) {
  const { data: resources, isLoading, error, refetch } = useNodeResources(nodeId)

  if (isLoading) {
    return <PageLoadingState label="Loading node resources…" />
  }

  if (error) {
    return (
      <PageErrorState
        title="Unable to load node resources"
        message="The per-node fleet aggregation could not be fetched."
        onRetry={() => void refetch()}
      />
    )
  }

  const scope = resources?.dockerScope ?? 'remote'
  const serviceCount = resources?.services?.length ?? 0
  const taskCount = resources?.tasks?.length ?? 0
  const imageCount = resources?.images?.length ?? 0
  const networkCount = resources?.networks?.length ?? 0
  const volumeCount = resources?.volumes?.length ?? 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Badge
          variant={scope === 'local' ? 'default' : 'secondary'}
          className="gap-1 font-mono text-[10px] uppercase"
        >
          <Network className="size-3" /> {scope} engine
        </Badge>
        {!isLocal && (
          <span className="text-xs text-muted-foreground">
            Swarm-visible data only — docker artifacts are read from the node serving this dashboard.
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Services</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{serviceCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tasks</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{taskCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Images</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{imageCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Networks</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{networkCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Volumes</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{volumeCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Services scheduled on this node</CardTitle>
          <CardDescription>
            Global services run on every node; replicated services appear here when they own a task
            on this node.
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
              {(resources?.services ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No services scheduled on this node.
                  </TableCell>
                </TableRow>
              ) : (
                (resources?.services ?? []).map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-mono text-sm font-medium">{service.name}</TableCell>
                    <TableCell>
                      <Badge variant={service.mode === 'global' ? 'default' : 'secondary'}>
                        {service.mode}
                        {service.mode === 'replicated' && service.replicas != null
                          ? ` × ${service.replicas}`
                          : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono">{service.desiredTasks}</TableCell>
                    <TableCell className="text-center font-mono">{service.runningTasks}</TableCell>
                    <TableCell className="max-w-70 truncate font-mono text-xs text-muted-foreground">
                      {service.image || '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks on this node</CardTitle>
          <CardDescription>Live task placement with container state.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="text-center">Slot</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(resources?.tasks ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No tasks scheduled on this node.
                  </TableCell>
                </TableRow>
              ) : (
                (resources?.tasks ?? []).map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-mono text-xs">{task.id.slice(0, 12)}…</TableCell>
                    <TableCell className="font-medium">{task.serviceName || '—'}</TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {task.slot ?? '—'}
                    </TableCell>
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
                    <TableCell className="max-w-60 truncate text-xs text-fail">
                      {task.error ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}