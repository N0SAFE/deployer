'use client'

import { Suspense, useState } from 'react'
import { Network, Unplug, Waypoints } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { PageErrorState, PageHeader, StatStrip, StatStripItem } from '@/components/dashboard'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { useHydrated } from '@/lib/use-hydrated'
import { AuthDashboardNetworkMesh, AuthDashboardNodes } from '@/routes'
import { ConnectPeerPanel } from './_components/connect-peer-panel'
import { ConnectionsCard } from './_components/connections-card'
import { DecisionsCard } from './_components/decisions-card'
import {
  HISTORY_LIMIT,
  type MeshLookupHistoryEntry,
  type MeshRoutePlanHistoryEntry,
} from './_components/diagnostics-types'
import { OwnershipLookupCard } from './_components/ownership-lookup-card'
import { RoutePlannerCard } from './_components/route-planner-card'
import { SessionsCard } from './_components/sessions-card'

/**
 * Control-mesh diagnostics — engineering view of how the platform's instances
 * talk to each other: peer connections, transport sessions, and the routing and
 * ownership decisions made on top of them.
 *
 * This is NOT the WireGuard network (Network → Mesh). The map of node positions
 * and link latency lives on the Nodes overview.
 */
export default function NodesDiagnosticsPage() {
  const hydrated = useHydrated()
  const { state: meshState, status: streamStatus, lastError } = useMeshSseState()
  const [routePlans, setRoutePlans] = useState<MeshRoutePlanHistoryEntry[]>([])
  const [lookups, setLookups] = useState<MeshLookupHistoryEntry[]>([])

  const peers = meshState?.peers ?? []
  const sessions = meshState?.sessions ?? []
  const snapshot = meshState?.snapshot
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
            Engineering view of the platform&apos;s peer sessions and routing decisions. This is not the WireGuard
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
        <StatStripItem icon={Network} label="Peers" value={unread ? undefined : peers.length} hint={unread ? undefined : `${String(peers.filter((p) => p.state === 'up').length)} up`} />
        <StatStripItem icon={Unplug} label="Sessions" value={unread ? undefined : sessions.length} />
        <StatStripItem icon={Waypoints} label="Membership version" value={unread ? undefined : `v${String(snapshot?.version ?? 0)}`} />
        <StatStripItem
          label="This node"
          value={unread ? undefined : (meshState?.localNode.nodeId.slice(0, 8) ?? 'n/a')}
        />
      </StatStrip>

      <Suspense fallback={null}>
        <ConnectPeerPanel />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {unavailable ? (
          <div className="lg:col-span-2">
            <PageErrorState
              title="Live mesh stream unavailable"
              message="Peer connections and sessions come from a live stream that failed to connect. Reload to reconnect."
              details={lastError ?? undefined}
              retryLabel="Reload"
              onRetry={() => { window.location.reload() }}
            />
          </div>
        ) : (
          <>
            <ConnectionsCard peers={peers} loading={loading} />
            <SessionsCard sessions={sessions} loading={loading} />
          </>
        )}
        <RoutePlannerCard
          onPlanned={(entry) => { setRoutePlans((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT)) }}
        />
        <OwnershipLookupCard
          onLookedUp={(entry) => { setLookups((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT)) }}
        />
        <DecisionsCard routePlans={routePlans} lookups={lookups} />
      </div>
    </div>
  )
}
