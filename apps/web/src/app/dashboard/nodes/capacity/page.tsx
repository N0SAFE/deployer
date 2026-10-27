'use client'

import { Cpu, Inbox, Server } from 'lucide-react'
import { PageErrorState, PageHeader, ScopeLabel, StatStrip, StatStripItem } from '@/components/dashboard'
import { useFleetAdmissionRequests, useFleetAllocations, useFleetServers } from '@/domains/fleet/hooks'
import { useMeshLocalNode, useMeshSseState } from '@/domains/mesh/hooks'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { comparePresence, isPresent, liveNodeIds, nodePresence, type NodePresence } from '../_utils/node-presence'
import { useNow } from '../_utils/use-now'
import { useHydrated } from '@/lib/use-hydrated'
import { AdmissionsPanel } from './_components/admissions-panel'
import { AllocationsSection } from './_components/allocations-section'
import { NodeCapacityCards } from './_components/node-capacity-cards'

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

/**
 * Capacity & admissions — how much each node may host, what has been promised,
 * and which nodes are waiting to be let in. Pending admission requests lead
 * when there are any: they are the only thing here waiting on a human.
 */
export default function NodesCapacityPage() {
  const hydrated = useHydrated()
  const { data: serversData, isLoading, error, refetch } = useFleetServers()
  const { data: allocationsData } = useFleetAllocations()
  const { data: pendingData } = useFleetAdmissionRequests({ status: 'pending' })
  const { data: localNode } = useMeshLocalNode()
  const { state: meshEvent } = useMeshSseState()
  const now = useNow()

  if (!hydrated || isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading capacity">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    )
  }
  if (error) {
    return <PageErrorState title="Could not load nodes" message="The fleet list is unavailable right now." onRetry={() => { void refetch() }} />
  }

  const live = liveNodeIds(meshEvent?.snapshot.nodes ?? [])
  const presenceOf = (nodeId: string, lastSeenAt: string | null, status: string): NodePresence =>
    nodePresence({ nodeId, lastSeenAt, status }, now, live, localNode?.nodeId)
  // Online nodes first: an offline row in the registry is rarely what the operator came to size.
  const servers = [...(serversData?.items ?? [])]
    .map((node) => ({ node, presence: presenceOf(node.nodeId, node.lastSeenAt, node.status) }))
    .sort(comparePresence)
    .map(({ node }) => node)
  const onlineCount = servers.filter((s) => isPresent(presenceOf(s.nodeId, s.lastSeenAt, s.status))).length
  const allocations = allocationsData?.items ?? []
  const pendingCount = pendingData?.items.length ?? 0

  const admissions = (
    <section className="space-y-3">
      <SectionIntro
        title="Pending admission requests"
        description="Nodes asking to join this cluster's capacity pool."
      />
      <AdmissionsPanel servers={servers} />
    </section>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Nodes"
        title="Capacity & admissions"
        description="Set how much CPU and memory each node may host, review what has been allocated, and approve nodes that ask to join."
        badge={<ScopeLabel scope="mesh" />}
      />
      <StatStrip>
        <StatStripItem
          icon={Inbox}
          label="Awaiting approval"
          value={pendingCount}
          hint={pendingCount === 0 ? 'nothing queued' : 'needs a decision'}
          tone={pendingCount > 0 ? 'pending' : undefined}
        />
        <StatStripItem icon={Server} label="Nodes" value={servers.length} hint={`${String(onlineCount)} online`} />
        <StatStripItem icon={Cpu} label="Allocations" value={allocations.length} />
      </StatStrip>

      {pendingCount > 0 ? admissions : null}

      <section className="space-y-3">
        <SectionIntro
          title="Nodes & capacity"
          description="The ceiling of each node and how much of it is already reserved. Every service keeps its own database."
        />
        <NodeCapacityCards servers={servers} allocations={allocations} presenceOf={presenceOf} />
      </section>

      <section className="space-y-3">
        <SectionIntro
          title="Allocations"
          description="Reserve capacity on a node, and review or release what is reserved."
        />
        <AllocationsSection servers={servers} />
      </section>

      {pendingCount === 0 ? admissions : null}
    </div>
  )
}
