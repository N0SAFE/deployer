'use client'

import { useMemo } from 'react'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { useFleetServers } from '@/domains/fleet/hooks'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@deployer/ui/components/shadcn/card'
import { Activity, Network } from 'lucide-react'
import {
  FleetLatencyMap,
  type FleetMapNode,
} from './fleet-latency-map'

const MAP_ANCHOR: [number, number] = [48.8566, 2.3522]

function hashNodeId(nodeId: string): number {
  let hash = 0
  for (let index = 0; index < nodeId.length; index += 1) {
    hash = ((hash << 5) - hash + nodeId.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function deriveNodeCoordinates(nodeId: string): [number, number] {
  const hash = hashNodeId(nodeId)
  const radius = 1 + (hash % 2400) / 1000
  const angle = ((hash % 360) * Math.PI) / 180
  return [MAP_ANCHOR[0] + Math.sin(angle) * radius, MAP_ANCHOR[1] + Math.cos(angle) * radius]
}

function averageCenter(nodes: FleetMapNode[]): [number, number] {
  if (nodes.length === 0) return MAP_ANCHOR
  const totals = nodes.reduce(
    (acc, node) => {
      acc.latitude += node.coordinates[0]
      acc.longitude += node.coordinates[1]
      return acc
    },
    { latitude: 0, longitude: 0 },
  )
  return [totals.latitude / nodes.length, totals.longitude / nodes.length]
}

/**
 * FleetTopologyPanel — the nodes of the swarm, as the agents report them, for the
 * Nodes fleet view. Clicking a node opens its workspace. The agents measure no link
 * quality, so the map draws nodes only.
 */
export function FleetTopologyPanel({
  onNodeOpen,
}: {
  onNodeOpen: (nodeId: string) => void
}) {
  const { state: meshEvent, status } = useMeshSseState()
  const { data: serversData } = useFleetServers()

  const displayNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of serversData?.items ?? []) {
      if (s.nodeId !== '') {
        map.set(s.nodeId, s.displayName ?? s.nodeId.slice(0, 8))
      }
    }
    return map
  }, [serversData])

  const replicas = meshEvent?.replicas ?? []

  const nodes = useMemo<FleetMapNode[]>(
    () =>
      (meshEvent?.nodes ?? []).map((node) => ({
        nodeId: node.nodeId,
        label: displayNames.get(node.nodeId) ?? `${node.local ? 'Local' : 'Peer'} ${node.nodeId.slice(0, 13)}`,
        role: 'node',
        lifecycleState: 'healthy',
        sessionState: 'connected',
        isLocal: node.local,
        coordinates: deriveNodeCoordinates(node.nodeId),
      })),
    [displayNames, meshEvent?.nodes],
  )

  const mapCenter = useMemo(() => averageCenter(nodes), [nodes])

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card className="min-h-[52vh] flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-4" /> Fleet map
          </CardTitle>
          <CardDescription>Click a node to open its workspace.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <FleetLatencyMap
            nodes={nodes}
            links={[]}
            center={mapCenter}
            selectedNodeId={null}
            selectedLinkId={null}
            onNodeSelect={onNodeOpen}
            onLinkSelect={() => undefined}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="size-4" /> Live status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">Stream</span>
              <Badge variant={status === 'connected' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>
                {status}
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">Nodes</span>
              <span className="font-semibold">{nodes.length}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground" title="Service replicas announced to the agents.">Replicas</span>
              <span className="font-semibold">{replicas.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
