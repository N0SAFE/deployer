'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AuthDashboardNodesNodeId } from '@/routes'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Activity, ArrowRight, Cpu, Globe, HardDrive, Network, Server, ShieldCheck } from 'lucide-react'
import { PageHeader, PageLoadingState, PageErrorState, StatusBadge, ScopeLabel } from '@/components/dashboard'
import { useFleetServers, useFleetAllocations } from '@/domains/fleet/hooks'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { isRecord } from '@repo/type-guards'
import { FleetTopologyPanel } from './_components/fleet-topology-panel'

interface FleetServerRow {
  nodeId: string
  serverUrl?: string | null
  displayName?: string | null
  status?: string
  healthy?: boolean
  lastSeenAt?: string | null
  maxCpuMillicores?: number | null
  maxMemoryMb?: number | null
  metrics?: {
    cpuUsage?: number
    memoryUsage?: number
  } | null
}

function nodeLabel(row: FleetServerRow): string {
  return row.displayName || row.nodeId.slice(0, 8)
}

function formatBytes(mb: number | null | undefined): string {
  if (mb == null) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function pct(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

/**
 * Nodes — the fleet view of the mesh.
 *
 * Mesh-wide page that lists every registered cluster node with its live
 * status, capacity and allocation summary. Each row links to the per-node
 * workspace (`/dashboard/nodes/[nodeId]`) where deployments, docker and
 * node configuration are scoped.
 *
 * Concept: projects and services are mesh-wide; this page is the entry
 * point to everything that is per-node.
 */
export default function DashboardNodesPage() {
  const router = useRouter()
  const { data: serversData, isLoading, error, refetch } = useFleetServers()
  const { data: allocationsData } = useFleetAllocations()
  const { state: meshEvent, status: streamStatus } = useMeshSseState()

  const openNode = (nodeId: string) => {
    router.push(AuthDashboardNodesNodeId({ nodeId }))
  }

  const servers = useMemo<FleetServerRow[]>(() => {
    const raw = serversData as
      | { items?: Array<Record<string, unknown>> }
      | undefined
    return (raw?.items ?? []).map((item) => ({
      nodeId: String(item.nodeId ?? ''),
      serverUrl: item.serverUrl as string | null | undefined,
      displayName: item.displayName as string | null | undefined,
      status: item.status as string | undefined,
      healthy: item.healthy as boolean | undefined,
      lastSeenAt: item.lastSeenAt as string | null | undefined,
      maxCpuMillicores: item.maxCpuMillicores as number | null | undefined,
      maxMemoryMb: item.maxMemoryMb as number | null | undefined,
      metrics: isRecord(item.metrics)
        ? {
            cpuUsage: item.metrics.cpuUsage as number | undefined,
            memoryUsage: item.metrics.memoryUsage as number | undefined,
          }
        : null,
    }))
  }, [serversData])

  const allocations = useMemo(() => {
    const raw = allocationsData as { items?: Array<Record<string, unknown>> } | undefined
    return raw?.items ?? []
  }, [allocationsData])

  const totalAllocations = allocations.length
  const meshNodes = meshEvent?.snapshot?.nodes ?? []
  // Membership-snapshot lifecycle states are mesh-view states; "healthy"
  // is the live/connected equivalent of the cluster node status "active".
  const connectedNodes = meshNodes.filter((n) => n.lifecycleState === 'healthy').length

  if (isLoading) {
    return <PageLoadingState label="Loading nodes…" />
  }

  if (error) {
    return (
      <PageErrorState
        title="Failed to load nodes"
        message="The fleet server list could not be fetched. Check that the mesh control plane is reachable."
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Nodes"
        title="Node fleet"
        description="Every node in the mesh, with live capacity and allocation. Deployments, docker and node configuration are per-node — open a node to work in its scope."
        badge={
          <>
            <ScopeLabel scope="mesh" />
            <Badge variant="secondary">{servers.length} nodes</Badge>
            <Badge variant={streamStatus === 'connected' ? 'default' : 'secondary'}>
              stream {streamStatus}
            </Badge>
          </>
        }
        actions={
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Activity className="size-4" /> {connectedNodes} connected
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-4" /> {totalAllocations} allocations
            </span>
          </div>
        }
      />

      {/* Fleet health strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Server className="size-4 text-muted-foreground" /> Nodes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{servers.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Network className="size-4 text-muted-foreground" /> Live peers
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{connectedNodes}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="size-4 text-muted-foreground" /> Allocations
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{totalAllocations}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <HardDrive className="size-4 text-muted-foreground" /> Healthy
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {servers.filter((s) => s.healthy).length}
            <span className="text-sm font-normal text-muted-foreground"> / {servers.length}</span>
          </CardContent>
        </Card>
      </div>

      {/* Node table */}
      <Card>
        <CardHeader>
          <CardTitle>Registered nodes</CardTitle>
          <CardDescription>
            Capacity is set per node. Click a node to view its deployments, docker daemon and configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Node</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No nodes registered yet. Nodes appear here once they join the mesh.
                  </TableCell>
                </TableRow>
              ) : (
                servers.map((row) => (
                  <TableRow key={row.nodeId}>
                    <TableCell className="font-medium">
                      <AuthDashboardNodesNodeId.Link nodeId={row.nodeId} className="hover:underline">
                        {nodeLabel(row)}
                      </AuthDashboardNodesNodeId.Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status === 'active' ? 'active' : row.status === 'suspect' ? 'degraded' : row.status === 'draining' ? 'paused' : 'not-found'} />
                    </TableCell>
                    <TableCell>
                      {row.healthy ? (
                        <StatusBadge status="healthy" />
                      ) : (
                        <StatusBadge status="unhealthy" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {pct(row.metrics?.cpuUsage)}
                        <span className="text-xs text-muted-foreground">
                          / {row.maxCpuMillicores != null ? `${(row.maxCpuMillicores / 1000).toFixed(1)} vCPU` : '∞'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {pct(row.metrics?.memoryUsage)}
                        <span className="text-xs text-muted-foreground">/ {formatBytes(row.maxMemoryMb)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <AuthDashboardNodesNodeId.Link
                        nodeId={row.nodeId}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        Open <ArrowRight className="size-3.5" />
                      </AuthDashboardNodesNodeId.Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Live mesh topology */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Globe className="size-4" /> Live topology
        </h2>
        <FleetTopologyPanel onNodeOpen={openNode} />
      </section>
    </div>
  )
}