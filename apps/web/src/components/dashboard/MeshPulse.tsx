'use client'

import { Network, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'

import type { ClusterNodeInventoryRow } from '@deployer/fleet-contracts'
import { Button } from '@deployer/ui/components/shadcn/button'

import { useClusterNodes } from '@/domains/cluster/hooks'
import { cn } from '@/lib/utils'
import { AuthDashboardNodes, AuthDashboardNodesNodeId } from '@/routes'

import {
    deriveNodeHealth,
    formatAgo,
    summarizePulse,
    type NodeEvidence,
} from './mesh-pulse-model'
import { useNow } from './use-now'

/**
 * MeshPulse — the nodes-at-a-glance spine.
 *
 * Every registered node is one row. Status is derived from EVIDENCE (state +
 * last heartbeat), never from the registry flag alone: a node "active" in the
 * registry but silent for minutes reads as stale, not healthy. With no nodes
 * (or no data) it says so explicitly and points at the next action — it never
 * renders an empty bordered box or something that looks healthy.
 *
 * Props: `loading` forces the skeleton (e.g. while a parent query resolves);
 * the component also shows it on its own while its query is pending.
 */
const EVIDENCE_LABEL: Record<NodeEvidence, string> = {
    live: 'Live',
    stale: 'Stale',
    down: 'Down',
    unknown: 'No heartbeat',
}

const EVIDENCE_TEXT: Record<NodeEvidence, string> = {
    live: 'text-mesh',
    stale: 'text-status-pending',
    down: 'text-fail',
    unknown: 'text-muted-foreground',
}

function PulseShell({
    className,
    children,
    busy,
}: {
    className?: string
    children: React.ReactNode
    busy?: boolean
}) {
    return (
        <section
            aria-label="Nodes at a glance"
            aria-busy={busy ? 'true' : undefined}
            className={cn(
                'border-border/70 bg-card/40 overflow-hidden rounded-xl border',
                className
            )}
        >
            {children}
        </section>
    )
}

function PulseHeader({
    summary,
}: {
    summary: ReturnType<typeof summarizePulse> | null
}) {
    return (
        <div className="border-border/50 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
            <div className="flex items-center gap-2">
                <h2 className="font-display text-sm font-semibold">
                    Nodes at a glance
                </h2>
                <span className="text-muted-foreground text-xs">
                    last heartbeat per node
                </span>
            </div>
            {summary ? (
                <div className="text-muted-foreground flex items-center gap-3 font-mono text-xs">
                    <span>
                        {String(summary.live)} of {String(summary.total)} live
                    </span>
                    <span className="flex items-center gap-1">
                        <span
                            className="bg-leader inline-block size-1.5 rounded-full"
                            aria-hidden
                        />{' '}
                        {String(summary.managers)} managers
                    </span>
                </div>
            ) : null}
        </div>
    )
}

function PulseSkeleton({ className }: { className?: string }) {
    return (
        <PulseShell busy className={className}>
            <PulseHeader summary={null} />
            <div
                className="space-y-1 p-2"
                role="status"
                aria-label="Loading nodes"
            >
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className="bg-muted/40 h-9 animate-pulse rounded-lg motion-reduce:animate-none"
                    />
                ))}
            </div>
        </PulseShell>
    )
}

export function MeshPulse({
    className,
    loading = false,
}: {
    className?: string
    loading?: boolean
}) {
    const router = useRouter()
    const { data, isPending, isError, refetch } = useClusterNodes({
        includeDown: true,
    })
    const nodes = data ?? EMPTY_NODES
    const now = useNow()

    const summary = useMemo(() => summarizePulse(nodes, now), [nodes, now])
    const maxMemoryBytes = useMemo(
        () =>
            nodes.reduce(
                (max, node) => Math.max(max, node.capacity.memoryBytes ?? 0),
                0
            ),
        [nodes]
    )

    if (loading || (isPending && nodes.length === 0))
        return <PulseSkeleton className={className} />

    if (isError && nodes.length === 0) {
        return (
            <PulseShell
                className={cn('border-fail/40 border-dashed', className)}
            >
                <div
                    role="alert"
                    className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm"
                >
                    <TriangleAlert
                        className="text-fail size-4 shrink-0"
                        aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                        <p className="text-foreground font-medium">
                            Node status is unavailable
                        </p>
                        <p className="text-muted-foreground">
                            The platform API did not answer, so nothing is shown
                            here rather than a guess. Check that the API is
                            running.
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void refetch()}
                    >
                        Retry
                    </Button>
                </div>
            </PulseShell>
        )
    }

    if (nodes.length === 0) {
        return (
            <PulseShell className={cn('border-dashed', className)}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm">
                    <Network
                        className="text-muted-foreground size-5 shrink-0"
                        aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                        <p className="text-foreground font-medium">
                            No live nodes yet
                        </p>
                        <p className="text-muted-foreground">
                            No machine has registered with this platform, so
                            nothing can run. Add a node, then it appears here
                            with its last heartbeat.
                        </p>
                    </div>
                    <Button size="sm" asChild>
                        <AuthDashboardNodes.Link>
                            Go to Nodes
                        </AuthDashboardNodes.Link>
                    </Button>
                </div>
            </PulseShell>
        )
    }

    return (
        <PulseShell className={className}>
            <PulseHeader summary={summary} />
            <ul className="flex flex-col gap-1 p-2">
                {nodes.map((node) => (
                    <MeshPulseRow
                        key={node.nodeId}
                        node={node}
                        now={now}
                        maxMemoryBytes={maxMemoryBytes}
                        onOpen={() => {
                            router.push(
                                AuthDashboardNodesNodeId({
                                    nodeId: node.nodeId,
                                })
                            )
                        }}
                    />
                ))}
            </ul>
        </PulseShell>
    )
}

const EMPTY_NODES: ClusterNodeInventoryRow[] = []

function MeshPulseRow({
    node,
    now,
    maxMemoryBytes,
    onOpen,
}: {
    node: ClusterNodeInventoryRow
    now: number
    maxMemoryBytes: number
    onOpen: () => void
}) {
    const health = deriveNodeHealth(node, now)
    const isLeader = node.isMaster
    const shortId = node.nodeId.slice(0, 8)
    const memoryBytes = node.capacity.memoryBytes
    const memoryGb =
        memoryBytes != null && memoryBytes > 0
            ? `${(memoryBytes / 1e9).toFixed(1)} GB`
            : null
    const seen =
        health.lastSeenMs === null ? null : formatAgo(now - health.lastSeenMs)

    return (
        <li>
            <button
                type="button"
                onClick={onOpen}
                title={health.reason}
                className="group hover:bg-accent/40 focus-visible:outline-ring flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2"
            >
                <span
                    aria-hidden
                    className={cn(
                        'relative inline-flex size-2.5 shrink-0 items-center justify-center',
                        EVIDENCE_TEXT[health.evidence]
                    )}
                >
                    <span
                        className={cn(
                            'inline-block size-2 rounded-full bg-current',
                            health.evidence === 'live' &&
                                'animation-duration-[2.4s] animate-pulse motion-reduce:animate-none'
                        )}
                    />
                    {isLeader ? (
                        <span className="absolute -inset-1 rounded-full border border-current opacity-60" />
                    ) : null}
                </span>

                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="text-foreground font-mono text-xs font-medium">
                        {shortId}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                        {node.hostname}
                    </span>
                </span>

                {/* Text status next to the dot — never colour alone. */}
                <span
                    className={cn(
                        'shrink-0 text-xs font-medium',
                        EVIDENCE_TEXT[health.evidence]
                    )}
                >
                    {EVIDENCE_LABEL[health.evidence]}
                    {seen && health.evidence !== 'live' ? (
                        <span className="text-muted-foreground ml-1 hidden font-normal sm:inline">
                            · {seen}
                        </span>
                    ) : null}
                </span>

                <span className="hidden items-center gap-2 sm:flex">
                    <span
                        className={cn(
                            'rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wider uppercase',
                            node.swarmRole === 'manager'
                                ? 'bg-leader/15 text-leader'
                                : 'bg-muted text-muted-foreground'
                        )}
                    >
                        {node.swarmRole}
                    </span>
                    {node.isIngress ? (
                        <span className="bg-mesh/15 text-mesh rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wider uppercase">
                            ingress
                        </span>
                    ) : null}
                </span>

                {memoryGb && memoryBytes != null ? (
                    <span
                        className="hidden w-16 shrink-0 items-center md:flex"
                        title={`${memoryGb} memory`}
                    >
                        <span className="sr-only">{memoryGb} memory</span>
                        <span
                            aria-hidden
                            className="bg-muted h-1 w-full overflow-hidden rounded-full"
                        >
                            <span
                                className="bg-mesh/60 block h-full rounded-full"
                                style={{
                                    width:
                                        maxMemoryBytes > 0
                                            ? `${String(Math.max(4, (memoryBytes / maxMemoryBytes) * 100))}%`
                                            : '0%',
                                }}
                            />
                        </span>
                    </span>
                ) : (
                    <span
                        className="text-muted-foreground hidden w-16 shrink-0 text-center font-mono text-xs md:block"
                        title="Memory not reported"
                    >
                        —
                    </span>
                )}
            </button>
        </li>
    )
}
