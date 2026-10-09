'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthDashboardNodesNodeId } from '@/routes'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Cpu, Globe, Info, Network, Server, WifiOff } from 'lucide-react'
import { PageHeader, PageErrorState, ScopeLabel, StatStrip, StatStripItem } from '@/components/dashboard'
import { useFleetServers, useFleetAllocations } from '@/domains/fleet/hooks'
import { useMeshLocalNode, useMeshSseState } from '@/domains/mesh/hooks'
import { FleetTopologyPanel } from './_components/fleet-topology-panel'
import { NodesTable, type NodeRow } from './_components/nodes-table'
import { comparePresence, isPresent, liveNodeIds, nodePresence } from './_utils/node-presence'
import { useNow } from './_utils/use-now'

type PresenceFilter = 'all' | 'online' | 'offline'

const FILTERS: readonly { id: PresenceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
]

function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading nodes">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  )
}

/**
 * Nodes — the fleet view of the mesh.
 *
 * Presence (online / stale / offline) is derived from live mesh membership and
 * `lastSeenAt` by `nodePresence`, never from the registry's `status`/`healthy`,
 * which only describe the registry row and stay "active" for dead nodes.
 */
export default function DashboardNodesPage() {
  const router = useRouter()
  const { data: serversData, isLoading, error, refetch } = useFleetServers()
  const { data: allocationsData } = useFleetAllocations()
  const { data: localNode } = useMeshLocalNode()
  const { state: meshEvent, status: streamStatus } = useMeshSseState()
  const now = useNow()
  const [filter, setFilter] = useState<PresenceFilter>('all')

  const rows = useMemo<NodeRow[]>(() => {
    const live = liveNodeIds(meshEvent?.snapshot.nodes ?? [])
    const localId = localNode?.nodeId ?? meshEvent?.localNode.nodeId ?? null
    return (serversData?.items ?? [])
      .map((item) => ({
        node: item,
        presence: nodePresence(item, now, live, localId),
      }))
      .sort(comparePresence)
      .map(({ node, presence }) => ({
        nodeId: node.nodeId,
        displayName: node.displayName,
        serverUrl: node.serverUrl,
        status: node.status,
        lastSeenAt: node.lastSeenAt,
        maxCpuMillicores: node.maxCpuMillicores,
        maxMemoryMb: node.maxMemoryMb,
        cpuUsage: node.metrics?.cpuUsage ?? null,
        memoryUsage: node.metrics?.memoryUsage ?? null,
        presence,
      }))
  }, [serversData, meshEvent, localNode, now])

  if (isLoading) return <PageSkeleton />

  if (error) {
    return (
      <PageErrorState
        title="Failed to load nodes"
        message="The node registry could not be fetched. Check that the API is reachable, then retry."
        onRetry={() => void refetch()}
      />
    )
  }

  const onlineCount = rows.filter((r) => isPresent(r.presence)).length
  const offlineCount = rows.length - onlineCount
  const visible = rows.filter((r) =>
    filter === 'all' ? true : filter === 'online' ? isPresent(r.presence) : !isPresent(r.presence),
  )
  const allocationCount = allocationsData?.items.length ?? 0

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Nodes"
        title="Node fleet"
        description="Every node registered in the mesh and whether it is actually connected right now. Open a node to see its deployments, network identity and configuration."
        badge={<ScopeLabel scope="mesh" />}
      />

      <StatStrip>
        <StatStripItem icon={Server} label="Registered" value={rows.length} />
        <StatStripItem
          icon={Network}
          label="Online"
          value={
            <>
              {onlineCount}
              <span className="font-normal text-muted-foreground"> / {rows.length}</span>
            </>
          }
          tone={rows.length > 0 && onlineCount === 0 ? 'danger' : onlineCount < rows.length ? 'pending' : 'live'}
          hint={streamStatus === 'connected' ? 'live mesh stream' : `mesh stream ${streamStatus}`}
        />
        <StatStripItem icon={WifiOff} label="Offline" value={offlineCount} />
        <StatStripItem icon={Cpu} label="Allocations" value={allocationCount} />
      </StatStrip>

      {offlineCount > 0 ? (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {offlineCount} offline {offlineCount === 1 ? 'node' : 'nodes'} in the registry.
            </span>{' '}
            They are not connected and have not reported for over 24 hours (or were revoked). The registry keeps
            every node that ever joined, so they stay listed until removed — they are dimmed below and take no
            part in scheduling. Removing them needs an API that does not exist yet.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>Registered nodes</CardTitle>
              <CardDescription>
                Online first. “Registry” is the node’s record, not its health: it stays “registered” for a dead node.
              </CardDescription>
            </div>
            <div role="group" aria-label="Filter nodes by presence" className="flex gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  variant={filter === f.id ? 'secondary' : 'ghost'}
                  aria-pressed={filter === f.id}
                  onClick={() => { setFilter(f.id) }}
                >
                  {f.label}
                  <Badge variant="outline" className="ml-1.5 px-1.5 font-normal tabular-nums">
                    {f.id === 'all' ? rows.length : f.id === 'online' ? onlineCount : offlineCount}
                  </Badge>
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <NodesTable rows={visible} totalCount={rows.length} onClearFilter={() => { setFilter('all') }} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Globe className="size-4" /> Live topology
        </h2>
        <FleetTopologyPanel onNodeOpen={(nodeId) => { router.push(AuthDashboardNodesNodeId({ nodeId })) }} />
      </section>
    </div>
  )
}
