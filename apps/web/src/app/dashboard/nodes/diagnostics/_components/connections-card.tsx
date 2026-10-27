'use client'

import { Network } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { EmptyState } from '@/components/dashboard'
import type { useMeshSseState } from '@/domains/mesh/hooks'

type MeshState = NonNullable<ReturnType<typeof useMeshSseState>['state']>

export function ConnectionsCard({ peers, loading }: { peers: MeshState['peers']; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Active connections</CardTitle>
        <CardDescription>Links between control-mesh peers, with live quality and routing weight.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : peers.length === 0 ? (
          <EmptyState compact icon={Network} title="No peer connections yet" description="Link another instance above to see its connection here." />
        ) : (
          <div className="space-y-2">
            {peers.map((peer) => (
              <div key={peer.connectionId} className="space-y-1 rounded border p-3">
                <p className="break-all font-mono text-xs text-muted-foreground">{peer.connectionId}</p>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{peer.sourceNodeId.slice(0, 8)} → {peer.targetNodeId.slice(0, 8)}</p>
                  <Badge variant={peer.state === 'up' ? 'default' : peer.state === 'degraded' ? 'secondary' : 'destructive'}>{peer.state}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  latency {peer.metrics.latencyMs}ms · jitter {peer.metrics.jitterMs}ms · loss {(peer.metrics.packetLossRatio * 100).toFixed(1)}% · weight {peer.metrics.weight.toFixed(4)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
