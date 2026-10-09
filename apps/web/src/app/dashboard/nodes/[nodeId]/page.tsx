'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AuthDashboardNodes } from '@/routes'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { PageHeader, PageErrorState, ScopeLabel } from '@/components/dashboard'
import { useFleetServers, useFleetAllocations } from '@/domains/fleet/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useMeshLocalNode, useMeshNodeConfig, useMeshSseState } from '@/domains/mesh/hooks'
import { CopyableMono } from '../../network/_components/copy-button'
import { PresenceBadge } from '../_components/presence-badge'
import { liveNodeIds, nodePresence } from '../_utils/node-presence'
import { useNow } from '../_utils/use-now'
import { NodeConfigTab } from './_components/node-config-tab'
import { NodeDeploymentsTab, type DeploymentRow } from './_components/node-deployments-tab'
import { NodeFleetTab } from './_components/node-fleet-tab'
import { NodeOverviewTab, type NodeDetail } from './_components/node-overview-tab'

type Tab = 'overview' | 'deployments' | 'fleet' | 'configuration'

/**
 * Node workspace — everything scoped to a single node. Presence comes from
 * `nodePresence` (live mesh + last seen), not from the registry's status.
 */
export default function DashboardNodeDetailPage() {
  const params = useParams<{ nodeId: string }>()
  const nodeId = params.nodeId
  const [tab, setTab] = useState<Tab>('overview')
  const now = useNow()

  const { data: serversData, isLoading, error, refetch } = useFleetServers()
  const { data: allocationsData } = useFleetAllocations({ serverNodeId: nodeId })
  const { data: localNode } = useMeshLocalNode()
  const isLocal = localNode?.nodeId === nodeId
  const { data: localNodeConfig } = useMeshNodeConfig({ enabled: isLocal })
  const { state: meshEvent } = useMeshSseState()

  const node = useMemo<NodeDetail | null>(() => {
    // Match by nodeId (UUID) or swarmNodeId (Docker Swarm short id).
    const item = (serversData?.items ?? []).find((i) => i.nodeId === nodeId || i.swarmNodeId === nodeId)
    if (!item) return null
    return {
      nodeId: item.nodeId,
      serverUrl: item.serverUrl,
      displayName: item.displayName,
      status: item.status,
      lastSeenAt: item.lastSeenAt,
      maxCpuMillicores: item.maxCpuMillicores,
      maxMemoryMb: item.maxMemoryMb,
      cpuUsage: item.metrics?.cpuUsage ?? null,
      memoryUsage: item.metrics?.memoryUsage ?? null,
    }
  }, [serversData, nodeId])

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

  const liveMember = (meshEvent?.snapshot.nodes ?? []).find((n) => n.nodeId === nodeId) ?? null

  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading node">
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }
  if (error && !node) {
    return (
      <PageErrorState
        title="Failed to load node"
        message="The node registry could not be fetched. Check that the API is reachable, then retry."
        onRetry={() => void refetch()}
      />
    )
  }
  if (!node) {
    return (
      <PageErrorState
        title="Node not found"
        message={`No node with id ${nodeId} is registered in this mesh. It may have been revoked, or the link is stale.`}
      />
    )
  }

  const nodeName = node.displayName ?? node.nodeId.slice(0, 8)
  const presence = nodePresence(node, now, liveNodeIds(meshEvent?.snapshot.nodes ?? []), localNode?.nodeId)

  return (
    <div className="space-y-5">
      <AuthDashboardNodes.Link className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All nodes
      </AuthDashboardNodes.Link>
      <PageHeader
        eyebrow="Node"
        title={nodeName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {isLocal
                ? 'The node you are connected to.'
                : 'A remote node in the mesh. Docker operations always target the node you are connected to.'}
            </span>
            <CopyableMono value={node.nodeId} label="Copy node id" />
          </span>
        }
        badge={
          <>
            <ScopeLabel scope="node" nodeName={nodeName} />
            <PresenceBadge presence={presence} />
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => { setTab(value as Tab) }}>
        <div className="overflow-x-auto">
          <TabsList variant="line" aria-label="Node sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deployments">Deployments</TabsTrigger>
            <TabsTrigger value="fleet">Swarm resources</TabsTrigger>
            <TabsTrigger value="configuration">Configuration</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <NodeOverviewTab
            node={node}
            presence={presence}
            lifecycleState={liveMember?.lifecycleState ?? null}
            roles={liveMember?.roles ?? []}
            allocations={allocationsData?.items ?? []}
          />
        </TabsContent>
        <TabsContent value="deployments">
          <NodeDeploymentsTab deployments={deployments} />
        </TabsContent>
        <TabsContent value="fleet">
          <NodeFleetTab nodeId={node.nodeId} isLocal={isLocal} />
        </TabsContent>
        <TabsContent value="configuration">
          <NodeConfigTab isLocal={isLocal} config={localNodeConfig} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
