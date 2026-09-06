'use client'

import { useMemo, useState } from 'react'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { useFleetServers } from '@/domains/fleet/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { isRecord } from '@repo/type-guards'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { Activity, Network, Timer, TriangleAlert } from 'lucide-react'
import {
  FleetLatencyMap,
  type FleetMapLink,
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
 * FleetTopologyPanel — live mesh latency map + link telemetry for the
 * Nodes fleet view. Clicking a node opens its workspace; clicking a link
 * inspects the connection in a dialog.
 */
export function FleetTopologyPanel({
  onNodeOpen,
}: {
  onNodeOpen: (nodeId: string) => void
}) {
  const { state: meshEvent, status, lastError } = useMeshSseState()
  const { data: serversData } = useFleetServers()

  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const servers = useMemo(() => {
    const raw = serversData as { items?: Array<Record<string, unknown>> } | undefined
    return raw?.items ?? []
  }, [serversData])

  const displayNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of servers) {
      const id = String(s.nodeId ?? '')
      if (id) {
        map.set(id, (s.displayName as string | null | undefined) || id.slice(0, 8))
      }
    }
    return map
  }, [servers])

  const localNode = meshEvent?.localNode
  const sessions = useMemo(() => meshEvent?.sessions ?? [], [meshEvent?.sessions])
  const snapshot = meshEvent?.snapshot
  const peers = useMemo(() => meshEvent?.peers ?? [], [meshEvent?.peers])

  const nodes = useMemo<FleetMapNode[]>(() => {
    const nodeMap = new Map<string, FleetMapNode>()
    const addNode = (node: FleetMapNode) => {
      const existing = nodeMap.get(node.nodeId)
      if (existing && !node.isLocal) return
      nodeMap.set(node.nodeId, node)
    }

    if (localNode) {
      addNode({
        nodeId: localNode.nodeId,
        label: displayNames.get(localNode.nodeId) ?? `Local ${localNode.nodeId.slice(0, 8)}`,
        role: localNode.roles[0] ?? 'edge',
        lifecycleState: localNode.lifecycleState,
        sessionState: 'connected',
        isLocal: true,
        coordinates: deriveNodeCoordinates(localNode.nodeId),
      })
    }

    for (const node of snapshot?.nodes ?? []) {
      addNode({
        nodeId: node.nodeId,
        label: displayNames.get(node.nodeId) ?? `Peer ${node.nodeId.slice(0, 8)}`,
        role: node.roles[0] ?? 'relay',
        lifecycleState: node.lifecycleState,
        sessionState: 'connected',
        isLocal: false,
        coordinates: deriveNodeCoordinates(node.nodeId),
      })
    }

    for (const session of sessions) {
      const peerNodeId = session.peerNodeId ?? `session:${session.sessionId}`
      if (nodeMap.has(peerNodeId)) continue
      addNode({
        nodeId: peerNodeId,
        label: session.peerNodeId
          ? displayNames.get(session.peerNodeId) ?? `Peer ${session.peerNodeId.slice(0, 8)}`
          : `Session ${session.sessionId.slice(0, 8)}`,
        role: 'peer',
        lifecycleState: session.state === 'connected' ? 'healthy' : 'suspect',
        sessionState: session.state,
        isLocal: false,
        coordinates: deriveNodeCoordinates(peerNodeId),
      })
    }

    return Array.from(nodeMap.values())
  }, [displayNames, localNode, sessions, snapshot?.nodes])

  const links = useMemo<FleetMapLink[]>(
    () =>
      peers.map((peer) => ({
        id: peer.connectionId,
        sourceNodeId: peer.sourceNodeId,
        targetNodeId: peer.targetNodeId,
        latencyMs: peer.metrics.latencyMs,
        jitterMs: peer.metrics.jitterMs,
        packetLossRatio: peer.metrics.packetLossRatio,
        reliabilityScore: peer.metrics.reliabilityScore,
        throughputMbps: peer.metrics.throughputMbps,
        state: peer.state,
        inferred:
          Boolean(peer.metadata) &&
          isRecord(peer.metadata) &&
          peer.metadata.inferredFromClusterSync === true,
        measuredAt: peer.metrics.measuredAt,
      })),
    [peers],
  )

  const liveTelemetryLinks = useMemo(() => links.filter((link) => !link.inferred), [links])
  const mapCenter = useMemo(() => averageCenter(nodes), [nodes])

  const avgLatency = useMemo(() => {
    if (liveTelemetryLinks.length === 0) return 0
    return Math.round(
      liveTelemetryLinks.reduce((sum, item) => sum + item.latencyMs, 0) /
        liveTelemetryLinks.length,
    )
  }, [liveTelemetryLinks])

  const healthStats = useMemo(() => {
    if (liveTelemetryLinks.length === 0) {
      return { avgJitter: 0, avgLossPct: 0, avgReliabilityPct: 0, p95Latency: 0, highLatencyCount: 0, highLossCount: 0 }
    }
    const latencyValues = liveTelemetryLinks.map((link) => link.latencyMs).sort((a, b) => a - b)
    const p95Index = Math.min(latencyValues.length - 1, Math.floor(latencyValues.length * 0.95))
    const avgJitter = liveTelemetryLinks.reduce((sum, link) => sum + link.jitterMs, 0) / liveTelemetryLinks.length
    const avgLossRatio = liveTelemetryLinks.reduce((sum, link) => sum + link.packetLossRatio, 0) / liveTelemetryLinks.length
    const avgReliabilityRatio = liveTelemetryLinks.reduce((sum, link) => sum + link.reliabilityScore, 0) / liveTelemetryLinks.length
    return {
      avgJitter: Math.round(avgJitter),
      avgLossPct: Number((avgLossRatio * 100).toFixed(2)),
      avgReliabilityPct: Number((avgReliabilityRatio * 100).toFixed(1)),
      p95Latency: latencyValues[p95Index] ?? 0,
      highLatencyCount: liveTelemetryLinks.filter((link) => link.latencyMs >= 90).length,
      highLossCount: liveTelemetryLinks.filter((link) => link.packetLossRatio >= 0.02).length,
    }
  }, [liveTelemetryLinks])

  const hotLinks = useMemo(
    () =>
      [...liveTelemetryLinks]
        .sort((a, b) => {
          const scoreA = a.latencyMs + a.jitterMs + a.packetLossRatio * 1000
          const scoreB = b.latencyMs + b.jitterMs + b.packetLossRatio * 1000
          return scoreB - scoreA
        })
        .slice(0, 4),
    [liveTelemetryLinks],
  )

  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card className="min-h-[52vh] flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="size-4" /> Fleet latency map
          </CardTitle>
          <CardDescription>Click a node to open its workspace, or a link to inspect it.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <FleetLatencyMap
            nodes={nodes}
            links={links}
            center={mapCenter}
            selectedNodeId={null}
            selectedLinkId={selectedLinkId}
            onNodeSelect={onNodeOpen}
            onLinkSelect={(linkId) => {
              setSelectedLinkId(linkId)
              setIsDialogOpen(true)
            }}
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
              <span className="text-muted-foreground">Membership version</span>
              <span className="font-semibold">v{snapshot?.version ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-muted-foreground">Sessions</span>
              <span className="font-semibold">{sessions.length}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Timer className="size-4" /> Latency & reliability
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">Avg jitter</p>
                <p className="text-lg font-semibold">{healthStats.avgJitter}ms</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">P95 latency</p>
                <p className="text-lg font-semibold">{healthStats.p95Latency}ms</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">Avg loss</p>
                <p className="text-lg font-semibold">{healthStats.avgLossPct}%</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-xs text-muted-foreground">Avg reliability</p>
                <p className="text-lg font-semibold">{healthStats.avgReliabilityPct}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TriangleAlert className="size-4" /> Hot links
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {hotLinks.length === 0 ? (
              <p className="text-muted-foreground">No active links yet.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 text-xs">
                  <Badge variant={healthStats.highLatencyCount > 0 ? 'destructive' : 'outline'}>
                    {healthStats.highLatencyCount} high-latency
                  </Badge>
                  <Badge variant={healthStats.highLossCount > 0 ? 'destructive' : 'outline'}>
                    {healthStats.highLossCount} high-loss
                  </Badge>
                </div>
                {hotLinks.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => {
                      setSelectedLinkId(link.id)
                      setIsDialogOpen(true)
                    }}
                    className="flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <div className="space-y-0.5">
                      <p className="font-mono text-[11px]">
                        {link.sourceNodeId.slice(0, 8)} → {link.targetNodeId.slice(0, 8)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        jitter {link.jitterMs}ms · loss {(link.packetLossRatio * 100).toFixed(2)}%
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-300">
                      {link.latencyMs}ms
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Connection details</DialogTitle>
            <DialogDescription>Latency, reliability and transfer telemetry for this link.</DialogDescription>
          </DialogHeader>
          {!selectedLink ? (
            <p className="text-sm text-muted-foreground">No link selected.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="rounded-md border px-3 py-3">
                <p className="font-semibold">
                  {selectedLink.sourceNodeId.slice(0, 8)} → {selectedLink.targetNodeId.slice(0, 8)}
                </p>
                {selectedLink.inferred ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                    Inferred topology link. Live heartbeat telemetry is not available for this edge yet.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Live streamed telemetry · measured at {new Date(selectedLink.measuredAt).toLocaleTimeString()}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-blue-500/10 px-2 py-1.5 text-blue-700 dark:text-blue-300">
                    <p>Latency</p>
                    <p className="font-semibold">{selectedLink.latencyMs}ms</p>
                  </div>
                  <div className="rounded bg-purple-500/10 px-2 py-1.5 text-purple-700 dark:text-purple-300">
                    <p>Reliability</p>
                    <p className="font-semibold">{(selectedLink.reliabilityScore * 100).toFixed(1)}%</p>
                  </div>
                  <div className="rounded bg-emerald-500/10 px-2 py-1.5 text-emerald-700 dark:text-emerald-300">
                    <p>Throughput</p>
                    <p className="font-semibold">{Math.round(selectedLink.throughputMbps ?? 0)} Mbps</p>
                  </div>
                  <div className="rounded bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                    <p>Packet loss</p>
                    <p className="font-semibold">{(selectedLink.packetLossRatio * 100).toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {lastError ? (
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-destructive">Mesh stream error</CardTitle>
            <CardDescription>{lastError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  )
}