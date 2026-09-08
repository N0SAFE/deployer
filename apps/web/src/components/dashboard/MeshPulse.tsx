'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AuthDashboardNodesNodeId } from '@/routes'
import { useClusterNodes } from '@/domains/cluster/hooks'
import { cn } from '@/lib/utils'
import type { ClusterNodeInventoryRow } from '@repo/api-contracts'

/**
 * MeshPulse — the fleet console's signature element.
 *
 * A single live "spine" of node dots encoding, at a glance, the mesh state:
 *   - every registered node is one dot (mono short-id + hostname),
 *   - the elected leader carries an amber ring (leader),
 *   - an active/healthy node is a teal pulse (mesh),
 *   - a down/leaving node is red (fail),
 *   - capacity is encoded as a thin under-bar (relative to the fleet max).
 *
 * Data comes from the single `cluster.listNodes` query (the fleet inventory
 * contract). Counts are derived from the returned rows — never from a second,
 * desynced snapshot query. Clicking a node opens its node workspace.
 */
function PulseHeader({ nodeCount, managerCount }: { nodeCount: number; managerCount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="font-display text-xs font-semibold uppercase tracking-[0.18em]">Mesh pulse</span>
        <span className="text-muted-foreground text-xs">live fleet state</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
        <span>{String(nodeCount)} nodes</span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-1.5 rounded-full bg-leader" /> {String(managerCount)} managers
        </span>
      </div>
    </div>
  )
}

export function MeshPulse({ className }: { className?: string }) {
  const router = useRouter()
  const { data, isPending, isError } = useClusterNodes({ includeDown: true })
  const nodes = data ?? EMPTY_NODES

  const managerCount = useMemo(
    () => nodes.reduce((count, node) => (node.swarmRole === 'manager' ? count + 1 : count), 0),
    [nodes],
  )

  const maxMemoryBytes = useMemo(
    () => nodes.reduce((max, node) => Math.max(max, node.capacity.memoryBytes ?? 0), 0),
    [nodes],
  )

  // First paint / refetch — keep the chrome so the layout doesn't jump.
  if (isPending && nodes.length === 0) {
    return (
      <div aria-busy="true" className={cn('overflow-hidden rounded-xl border border-border/70 bg-card/40', className)}>
        <PulseHeader nodeCount={0} managerCount={0} />
        <div className="space-y-1 p-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      </div>
    )
  }

  // The inventory query failed and we have nothing to show.
  if (isError && nodes.length === 0) {
    return (
      <div className={cn('flex items-center gap-3 rounded-xl border border-dashed border-fail/40 px-4 py-3 text-sm text-muted-foreground', className)}>
        <span className="inline-block size-2 rounded-full bg-fail" aria-hidden />
        <span>Fleet state is unavailable right now. It will pulse here as soon as the control plane answers.</span>
      </div>
    )
  }

  if (nodes.length === 0) {
    // Empty state — invitation, not a bare card.
    return (
      <div className={cn('flex items-center gap-3 rounded-xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground', className)}>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground/70">mesh</span>
        <span>No nodes have joined the swarm yet. Converge a node and it will pulse here.</span>
      </div>
    )
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border/70 bg-card/40', className)}>
      <PulseHeader nodeCount={nodes.length} managerCount={managerCount} />

      <ul className="flex flex-col gap-1 p-2">
        {nodes.map((node) => (
          <MeshPulseRow
            key={node.nodeId}
            node={node}
            maxMemoryBytes={maxMemoryBytes}
                onOpen={() => router.push(AuthDashboardNodesNodeId({ nodeId: (node as any).swarmNodeId ?? node.nodeId }))}
          />
        ))}
      </ul>
    </div>
  )
}

const EMPTY_NODES: ClusterNodeInventoryRow[] = []

function MeshPulseRow({
  node,
  maxMemoryBytes,
  onOpen,
}: {
  node: ClusterNodeInventoryRow
  maxMemoryBytes: number
  onOpen: () => void
}) {
  const isLeader = node.isMaster
  const isDown = node.state === 'down' || node.availability === 'drain'
  const shortId = node.nodeId.slice(0, 8)
  const memoryBytes = node.capacity.memoryBytes
  const memoryGb = memoryBytes != null && memoryBytes > 0 ? `${(memoryBytes / 1e9).toFixed(1)} GB` : null

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {/* status dot */}
        <span
          aria-hidden
          className={cn(
            'relative inline-flex size-2.5 shrink-0 items-center justify-center',
            isDown
              ? 'text-fail'
              : isLeader
                ? 'text-leader'
                : 'text-mesh',
          )}
        >
          <span
            className={cn(
              'inline-block size-2 rounded-full bg-current',
              !isDown && 'animate-pulse animation-duration-[2.4s]',
            )}
          />
          {isLeader && (
            <span className="absolute -inset-1 rounded-full border border-current opacity-60" />
          )}
        </span>

        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="font-mono text-xs font-medium text-foreground">{shortId}</span>
          <span className="truncate text-xs text-muted-foreground">{node.hostname}</span>
        </span>

        <span className="hidden items-center gap-2 sm:flex">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
              node.swarmRole === 'manager'
                ? 'bg-leader/15 text-leader'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {node.swarmRole}
          </span>
          {node.isIngress && (
            <span className="rounded bg-mesh/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mesh">
              ingress
            </span>
          )}
        </span>

        {/* capacity under-bar — width is relative to the fleet's largest node */}
        {memoryGb && memoryBytes != null ? (
          <span className="hidden w-16 shrink-0 items-center md:flex" aria-hidden title={`${memoryGb} memory`}>
            <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-mesh/60"
                style={{
                  width:
                    maxMemoryBytes > 0
                      ? `${Math.max(4, (memoryBytes / maxMemoryBytes) * 100)}%`
                      : '0%',
                }}
              />
            </span>
          </span>
        ) : (
          <span className="hidden w-16 shrink-0 text-center font-mono text-[10px] text-muted-foreground/50 md:block" aria-hidden>
            —
          </span>
        )}
      </button>
    </li>
  )
}
