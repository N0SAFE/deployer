'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, Server } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, StatusBadge } from '@/components/dashboard'
import { AuthDashboardNodesNodeId } from '@/routes'
import { useUpdateClusterNode } from '@/domains/cluster/hooks'
import type { ClusterNodeInventoryRow } from "@deployer/fleet-contracts";
import { CopyId } from '../../_components/copy-id-button'
import { Hint } from '../../_components/hint'
import { RelativeTime } from '../../_components/relative-time'
import { confirmationFor, type Confirmation, type GuardNode, type NodeChange } from '../_utils/node-change-guard'
import { ConfirmNodeChangeDialog } from './confirm-node-change-dialog'

const ROLE_HELP = {
	both: 'both — control plane and user workloads',
	control: 'control — control plane only, no user workloads',
	worker: 'worker — user workloads only, no control plane',
} as const

function formatMemory(bytes: number | null): string {
	if (bytes === null || bytes <= 0) return '—'
	const gib = bytes / 1024 ** 3
	return gib >= 1 ? `${gib.toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(0)} MiB`
}

function HeadWithHint({ children, hint, className }: { children: string; hint: string; className?: string }) {
	return (
		<TableHead className={className}>
			<Hint content={hint}><span className="underline decoration-dotted underline-offset-4">{children}</span></Hint>
		</TableHead>
	)
}

/** The fleet inventory with role and ingress controls; risky edits go through a confirmation that states the consequence. */
export function ClusterNodesTable({ nodes }: { nodes: ClusterNodeInventoryRow[] }) {
	const router = useRouter()
	const update = useUpdateClusterNode()
	const [pending, setPending] = useState<{ node: GuardNode; change: NodeChange; confirmation: Confirmation } | null>(null)

	const guardNodes: GuardNode[] = nodes.map((n) => ({
		nodeId: n.nodeId, hostname: n.hostname, swarmRole: n.swarmRole, platformRole: n.platformRole, isMaster: n.isMaster, isIngress: n.isIngress,
	}))

	const apply = (nodeId: string, change: NodeChange) => {
		const body = change.kind === 'platformRole' ? { platformRole: change.role } : { ingress: change.ingress }
		update.mutate(
			{ params: { nodeId }, body },
			{
				onSuccess: () => { toast.success('Node updated'); setPending(null) },
				onError: (err) => { toast.error(err instanceof Error ? err.message : 'Could not update the node') },
			},
		)
	}

	const request = (node: GuardNode, change: NodeChange) => {
		const confirmation = confirmationFor(node, change, guardNodes)
		if (confirmation === null) apply(node.nodeId, change)
		else setPending({ node, change, confirmation })
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Nodes</CardTitle>
				<CardDescription>
					Every node runs user workloads (shared-node model); managers also hold the cluster state. Changes to roles that could lose the majority of managers ask for confirmation first.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{nodes.length === 0 ? (
					<EmptyState compact icon={Server} title="No nodes in the Swarm inventory"
						description="Nodes appear here once they join the Swarm. If this stays empty, the Docker engine on this machine may not be in Swarm mode — see Swarm participation below." />
				) : (
					<Table stickyHeader>
						<TableHeader>
							<TableRow>
								<TableHead>Node</TableHead>
								<HeadWithHint hint="Swarm role. Managers keep the cluster state and need a majority (quorum) to stay writable; workers only run tasks.">Swarm role</HeadWithHint>
								<HeadWithHint className="text-center" hint="The manager currently coordinating the platform (elected among managers).">Master</HeadWithHint>
								<HeadWithHint className="text-center" hint="Labels the node as ingress. Workloads with the placement rule exclude-ingress are kept off it. Traefik itself runs on every node.">Ingress node</HeadWithHint>
								<HeadWithHint hint="Whether the node is up. Last seen is the latest heartbeat the platform received from it.">Status</HeadWithHint>
								<HeadWithHint hint="What the platform lets this node do: both, control only, or worker only.">Platform role</HeadWithHint>
								<TableHead className="text-right">Memory</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{nodes.map((node, index) => {
								const guard = guardNodes[index]
								if (guard === undefined) return null
								const label = node.hostname || node.nodeId.slice(0, 12)
								return (
									<TableRow key={node.nodeId} className="hover:bg-accent/30">
										<TableCell>
											<button
												type="button"
												onClick={() => { router.push(AuthDashboardNodesNodeId({ nodeId: node.nodeId })) }}
												className="block rounded text-left font-mono text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
												aria-label={`Open node ${label}`}
											>
												{label}
											</button>
											<CopyId value={node.nodeId} label="node id" />
										</TableCell>
										<TableCell><Badge variant={node.swarmRole === 'manager' ? 'default' : 'secondary'}>{node.swarmRole}</Badge></TableCell>
										<TableCell className="text-center">
											{node.isMaster ? <span className="inline-flex items-center gap-1 text-xs"><Crown className="size-4 text-leader" aria-hidden />Master</span> : <span className="text-muted-foreground">—</span>}
										</TableCell>
										<TableCell className="text-center">
											<Switch
												checked={node.isIngress}
												disabled={update.isPending}
												onCheckedChange={(checked) => { request(guard, { kind: 'ingress', ingress: checked }) }}
												aria-label={`Ingress node: ${label}`}
											/>
										</TableCell>
										<TableCell>
											<div className="flex flex-col items-start gap-0.5">
												<StatusBadge status={node.state} />
												<span className="text-xs text-muted-foreground">seen <RelativeTime value={node.lastSeenAt ?? node.lastHeartbeatAt} fallback="never" /></span>
												{node.availability !== 'active' ? <span className="text-xs text-muted-foreground">availability: {node.availability}</span> : null}
											</div>
										</TableCell>
										<TableCell>
											<Select value={node.platformRole} disabled={update.isPending} onValueChange={(value) => { request(guard, { kind: 'platformRole', role: value as 'both' | 'control' | 'worker' }) }}>
												<SelectTrigger className="w-32" aria-label={`Platform role: ${label}`}><SelectValue /></SelectTrigger>
												<SelectContent>
													{(Object.keys(ROLE_HELP) as (keyof typeof ROLE_HELP)[]).map((role) => (
														<SelectItem key={role} value={role}>{ROLE_HELP[role]}</SelectItem>
													))}
												</SelectContent>
											</Select>
										</TableCell>
										<TableCell className="text-right tabular-nums text-muted-foreground">{formatMemory(node.capacity.memoryBytes)}</TableCell>
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				)}
				<ConfirmNodeChangeDialog
					confirmation={pending?.confirmation ?? null}
					pending={update.isPending}
					onCancel={() => { setPending(null) }}
					onConfirm={() => { if (pending) apply(pending.node.nodeId, pending.change) }}
				/>
			</CardContent>
		</Card>
	)
}
