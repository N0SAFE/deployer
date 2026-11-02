'use client'

import { Network, Server, Waypoints } from 'lucide-react'
import { Suspense, useState } from 'react'

import { Badge } from '@deployer/ui/components/shadcn/badge'

import { PageErrorState, PageHeader, StatStrip, StatStripItem } from '@/components/dashboard'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { useHydrated } from '@/lib/use-hydrated'
import { AuthDashboardNetworkMesh, AuthDashboardNodes } from '@/routes'

import { DecisionsCard } from './_components/decisions-card'
import { HISTORY_LIMIT, type MeshLookupHistoryEntry } from './_components/diagnostics-types'
import { JoinTokenCard } from './_components/join-token-card'
import { NodesCard } from './_components/nodes-card'
import { OwnershipLookupCard } from './_components/ownership-lookup-card'
import { ReplicasCard } from './_components/replicas-card'

/**
 * Control-mesh diagnostics — engineering view of how the platform's instances
 * talk to each other: the nodes of the swarm, the replicas they run, and the
 * replica a call would reach.
 *
 * This is NOT the WireGuard network (Network → Mesh). The map of node positions
 * and link latency lives on the Nodes overview.
 */
export default function NodesDiagnosticsPage() {
  const hydrated = useHydrated()
  const { state: meshState, status: streamStatus, lastError } = useMeshSseState()
  const [lookups, setLookups] = useState<MeshLookupHistoryEntry[]>([])

  const nodes = meshState?.nodes ?? []
  const replicas = meshState?.replicas ?? []
  const services = new Set(replicas.map((replica) => replica.service))
  // Client-only data: both server and first client render take the loading path.
  const loading = !hydrated || (streamStatus === 'connecting' && !meshState)
  // The stream failed before delivering anything: say so instead of showing "0 peers".
  const unavailable = streamStatus === 'error' && !meshState
  const unread = loading || unavailable

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Nodes"
        title="Control-mesh diagnostics"
        description={
          <>
            Engineering view of the nodes, their replicas and where a call would go. This is not the WireGuard
            network between nodes — that is{' '}
            <AuthDashboardNetworkMesh.Link className="font-medium text-primary hover:underline">Network → Mesh</AuthDashboardNetworkMesh.Link>
            . For node positions and link latency, see the{' '}
            <AuthDashboardNodes.Link className="font-medium text-primary hover:underline">Nodes overview</AuthDashboardNodes.Link>.
          </>
        }
        badge={
          <Badge variant={streamStatus === 'connected' ? 'default' : streamStatus === 'error' ? 'destructive' : 'secondary'}>
            live stream: {streamStatus}
          </Badge>
        }
      />

      <StatStrip
        trailing={lastError ? <Badge variant="destructive">{lastError}</Badge> : undefined}
      >
        <StatStripItem icon={Network} label="Nodes" value={unread ? undefined : nodes.length} />
        <StatStripItem icon={Server} label="Services" value={unread ? undefined : services.size} />
        <StatStripItem icon={Waypoints} label="Replicas" value={unread ? undefined : replicas.length} />
        <StatStripItem
          label="This node"
          value={unread ? undefined : (nodes.find((node) => node.local)?.nodeId.slice(0, 13) ?? 'n/a')}
        />
      </StatStrip>

      <Suspense fallback={null}>
        <JoinTokenCard />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {unavailable ? (
          <div className="lg:col-span-2">
            <PageErrorState
              title="Live mesh stream unavailable"
              message="The nodes and replicas come from a live stream that failed to connect. Reload to reconnect."
              details={lastError ?? undefined}
              retryLabel="Reload"
              onRetry={() => { window.location.reload() }}
            />
          </div>
        ) : (
          <>
            <NodesCard nodes={nodes} loading={loading} />
            <ReplicasCard replicas={replicas} loading={loading} />
          </>
        )}
        <OwnershipLookupCard
          onLookedUp={(entry) => { setLookups((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT)) }}
        />
        <DecisionsCard lookups={lookups} />
      </div>
    </div>
  )
}
