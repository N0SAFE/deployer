'use client'

import { useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Crown, Globe, HardDrive, Info, Network, Server, ShieldCheck } from 'lucide-react'
import { PageHeader, PageLoadingState, PageErrorState, StatusBadge } from '@/components/dashboard'
import { useClusterMaster, useClusterNodes, useClusterSnapshot, useUpdateClusterNode } from '@/domains/cluster/hooks'

interface ClusterNodeRow {
  nodeId: string
  hostname?: string
  swarmRole?: string
  platformRole?: string
  isMaster?: boolean
  isIngress?: boolean
  availability?: string
  state?: string
  labels?: Record<string, string>
}

function formatBytes(nano?: number | null, bytes?: number | null): string {
  // capacity is { nanoCpus, memoryBytes }
  if (bytes == null) return '—'
  const gib = bytes / 1024 ** 3
  if (gib >= 1) return `${gib.toFixed(1)} GiB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MiB`
}

/**
 * Cluster — the Swarm cluster view.
 *
 * Shows the local cluster snapshot (node/manager counts, roles, ingress),
 * the elected controlling master, and the fleet node inventory with
 * role + ingress controls.
 */
export default function DashboardClusterPage() {
  const router = useRouter()
  const { data: snapshot, isLoading: snapshotLoading, error: snapshotError, refetch } = useClusterSnapshot()
  const { data: nodesData, isLoading: nodesLoading, error: nodesError } = useClusterNodes({ includeDown: true })
  const { data: master } = useClusterMaster()
  const updateNode = useUpdateClusterNode()
  const [includeDown] = useState(true)

  const nodes = useMemo<ClusterNodeRow[]>(() => (nodesData ?? []).map((item) => ({
    nodeId: item.nodeId,
    hostname: item.hostname,
    swarmRole: item.swarmRole,
    platformRole: item.platformRole,
    isMaster: item.isMaster,
    isIngress: item.isIngress,
    availability: item.availability,
    state: item.state,
    labels: item.labels,
  })), [nodesData])

  const isLoading = snapshotLoading || nodesLoading
  const error = snapshotError ?? nodesError

  const applyRole = (nodeId: string, platformRole: 'both' | 'control' | 'worker') => {
    updateNode.mutate({ params: { nodeId }, body: { platformRole } })
  }
  const toggleIngress = (nodeId: string, current: boolean) => {
    updateNode.mutate({ params: { nodeId }, body: { ingress: !current } })
  }

  if (isLoading) return <PageLoadingState label="Loading cluster state…" />
  if (error) {
    return (
      <PageErrorState
        title="Unable to load cluster state"
        message={String(error)}
        onRetry={() => {
          void refetch()
        }}
      />
    )
  }

  const localState = snapshot?.localNodeState ?? 'inactive'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cluster"
        description="Swarm cluster state, controlling master, and fleet node inventory."
      />

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Network className="size-4 text-muted-foreground" /> Cluster State
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={localState} />
            {snapshot?.clusterId ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">{snapshot.clusterId.slice(0, 12)}…</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="size-4 text-muted-foreground" /> Nodes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {String(snapshot?.nodeCount ?? 0)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">managers {String(snapshot?.managerCount ?? 0)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Crown className="size-4 text-muted-foreground" /> Controlling Master
            </CardTitle>
          </CardHeader>
          <CardContent>
            {master?.nodeId ? (
              <>
                <StatusBadge status={master.state} />
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {master.nodeId.slice(0, 12)}… · term {String(master.term)}
                </p>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No master elected</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-muted-foreground" /> Control Plane
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {String(nodes.filter((node) => node.swarmRole === 'manager').length)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">reachable managers</span>
          </CardContent>
        </Card>
      </div>

      {/* Node inventory */}
      <Card>
        <CardHeader>
          <CardTitle>Fleet nodes</CardTitle>
          <CardDescription>
            All nodes schedule user workloads (shared-node model) — managers host control plane AND services.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Node</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-center">Master</TableHead>
                <TableHead className="text-center">Ingress</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Platform role</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No nodes discovered — is the engine in Swarm mode?
                  </TableCell>
                </TableRow>
              ) : (
                nodes.map((node) => {
                  const rowData = (nodesData ?? []).find((item) => item.nodeId === node.nodeId)
                  const memBytes = rowData?.capacity
                    ? rowData.capacity.memoryBytes
                    : undefined
                  return (
                    <TableRow
                      key={node.nodeId}
                      className="cursor-pointer"
                      onClick={() => {
                          router.push(AuthDashboardNodesNodeId({ nodeId: node.nodeId }))
                        }}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Server className="size-4 text-muted-foreground" />
                          <div>
                            <p className="font-mono text-sm">{node.hostname ?? node.nodeId.slice(0, 12)}</p>
                            <p className="font-mono text-xs text-muted-foreground">{node.nodeId.slice(0, 12)}…</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={node.swarmRole === 'manager' ? 'default' : 'secondary'}>
                          {node.swarmRole ?? 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {node.isMaster ? (
                          <Crown className="inline size-4 text-amber-500" aria-label="master" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={!!node.isIngress}
                          onCheckedChange={(checked) => {
                            toggleIngress(node.nodeId, checked)
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          aria-label={`Toggle ingress for ${node.hostname ?? node.nodeId}`}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={node.state ?? node.availability ?? 'unknown'} />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={node.platformRole ?? 'both'}
                          onValueChange={(value) => {
                            applyRole(node.nodeId, value as 'both' | 'control' | 'worker')
                          }}
                        >
                          <SelectTrigger className="w-32" aria-label="Platform role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">both</SelectItem>
                            <SelectItem value="control">control</SelectItem>
                            <SelectItem value="worker">worker</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <HardDrive className="size-3.5" /> {formatBytes(undefined, memBytes)}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          {!includeDown && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Info className="size-3" /> Down nodes are hidden — enable “include down” to show them.
            </p>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Globe className="size-3" /> Ingress-tagged nodes receive public traffic via the Traefik swarm provider.
      </p>
    </div>
  )
}