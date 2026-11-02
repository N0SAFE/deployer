'use client'

import { Network } from 'lucide-react'

import type { NodeAgentNode } from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'

import { EmptyState } from '@/components/dashboard'

/** The nodes of the swarm, as the agent of this node knows them. */
export function NodesCard({ nodes, loading }: { nodes: readonly NodeAgentNode[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nodes</CardTitle>
        <CardDescription>Every node whose agent this node's agent knows of, and where it answers.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : nodes.length === 0 ? (
          <EmptyState compact icon={Network} title="No nodes yet" description="Issue a join token and redeem it on another node to see it here." />
        ) : (
          <div className="space-y-2">
            {nodes.map((node) => (
              <div key={node.nodeId} className="space-y-1 rounded border p-3">
                <div className="flex items-center justify-between">
                  <p className="break-all font-mono text-sm font-semibold">{node.nodeId}</p>
                  {node.local ? <Badge>this node</Badge> : null}
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">{node.address || 'no agent: standalone node'}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
