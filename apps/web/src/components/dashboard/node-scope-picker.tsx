'use client'

import { useNodeScope } from '@/domains/node/node-context'
import { useFleetServers } from '@/domains/fleet/hooks'
import { useMeshLocalNode } from '@/domains/mesh/hooks'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Network, Server } from 'lucide-react'

/**
 * NodeScopePicker — header control for switching between mesh-wide and per-node views.
 *
 * Renders a dropdown showing:
 * - "All Nodes (Mesh)" — global scope
 * - One entry per registered node — with "local" badge for this node
 *
 * When a node is selected, dashboard pages render node-scoped content.
 */
export function NodeScopePicker() {
  const { nodeId, setNodeId, localNodeId } = useNodeScope()
  const { data: serversData } = useFleetServers()
  const { data: localNode } = useMeshLocalNode()

  const servers = serversData?.items ?? []

  // Build the effective node list: include local node even if not in fleet yet
  const allNodes = (() => {
    const map = new Map<string, { nodeId: string; displayName?: string; status?: string }>()

    // Local node is always available
    if (localNode?.nodeId) {
      map.set(localNode.nodeId, {
        nodeId: localNode.nodeId,
        displayName: 'This Node',
        status: localNode.lifecycleState,
      })
    }

    for (const s of servers) {
      const id = (s as Record<string, unknown>).nodeId as string | undefined
      if (!id) continue
      map.set(id, {
        nodeId: id,
        displayName: (s as Record<string, unknown>).displayName as string | undefined,
        status: (s as Record<string, unknown>).status as string | undefined,
      })
    }

    return Array.from(map.values())
  })()

  if (allNodes.length <= 1) {
    // Single-node mesh — no picker needed, just show the mesh icon
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Network className="size-3.5" />
        <span>Mesh</span>
      </div>
    )
  }

  return (
    <Select
      value={nodeId ?? '__mesh__'}
      onValueChange={(v) => setNodeId(v === '__mesh__' ? null : v)}
    >
      <SelectTrigger className="h-7 w-auto min-w-[140px] gap-1.5 border-dashed text-xs">
        <Network className="size-3 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__mesh__">
          <div className="flex items-center gap-1.5">
            <Network className="size-3" />
            <span>All Nodes (Mesh)</span>
          </div>
        </SelectItem>
        {allNodes.map((n) => (
          <SelectItem key={n.nodeId} value={n.nodeId}>
            <div className="flex items-center gap-1.5">
              <Server className="size-3" />
              <span>{n.displayName ?? n.nodeId.slice(0, 8)}</span>
              {n.nodeId === localNodeId && (
                <span className="rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">local</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
