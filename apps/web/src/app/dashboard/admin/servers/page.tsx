'use client'

import { useMemo, useState } from 'react'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { FleetLatencyMap, type FleetMapLink, type FleetMapNode } from './_components/fleet-latency-map'
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
import { isRecord, isObjectLike } from "@repo/type-guards"


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
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
	if (nodes.length === 0) {
		return MAP_ANCHOR
	}

	const totals = nodes.reduce(
		(accumulator, node) => {
			accumulator.latitude += node.coordinates[0]
			accumulator.longitude += node.coordinates[1]
			return accumulator
		},
		{ latitude: 0, longitude: 0 },
	)

	return [totals.latitude / nodes.length, totals.longitude / nodes.length]
}

export default function AdminServersPage() {
	const { state: meshEvent, status, lastError } = useMeshSseState()

	const localNode = meshEvent?.localNode
	const sessions = useMemo(() => meshEvent?.sessions ?? [], [meshEvent?.sessions])
	const snapshot = meshEvent?.snapshot
	const peers = useMemo(() => meshEvent?.peers ?? [], [meshEvent?.peers])

	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
	const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
	const [selectionMode, setSelectionMode] = useState<'node' | 'link'>('node')
	const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false)

	const nodes = useMemo<FleetMapNode[]>(() => {
		const nodeMap = new Map<string, FleetMapNode>()

		if (localNode) {
			nodeMap.set(localNode.nodeId, {
				nodeId: localNode.nodeId,
				label: `Local ${localNode.nodeId.slice(0, 8)}`,
				role: localNode.roles[0] ?? 'edge',
				lifecycleState: localNode.lifecycleState,
				sessionState: 'connected',
				isLocal: true,
				coordinates: deriveNodeCoordinates(localNode.nodeId),
			})
		}

		for (const node of snapshot?.nodes ?? []) {
			nodeMap.set(node.nodeId, {
				nodeId: node.nodeId,
				label: `Peer ${node.nodeId.slice(0, 8)}`,
				role: node.roles[0] ?? 'relay',
				lifecycleState: node.lifecycleState,
				sessionState: 'connected',
				isLocal: false,
				coordinates: deriveNodeCoordinates(node.nodeId),
			})
		}

		for (const session of sessions) {
			const peerNodeId = session.peerNodeId ?? `session:${session.sessionId}`
			if (nodeMap.has(peerNodeId)) {
				continue
			}

			nodeMap.set(peerNodeId, {
				nodeId: peerNodeId,
				label: session.peerNodeId ? `Peer ${session.peerNodeId.slice(0, 8)}` : `Session ${session.sessionId.slice(0, 8)}`,
				role: 'peer',
				lifecycleState: session.state === 'connected' ? 'healthy' : 'suspect',
				sessionState: session.state,
				isLocal: false,
				coordinates: deriveNodeCoordinates(peerNodeId),
			})
		}

		return Array.from(nodeMap.values())
	}, [localNode, sessions, snapshot?.nodes])

	const links = useMemo<FleetMapLink[]>(() => {
		const meshLinks: FleetMapLink[] = peers.map((peer) => ({
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
		}))

		return meshLinks
	}, [peers])

	const liveTelemetryLinks = useMemo(() => links.filter((link) => !link.inferred), [links])

	const mapCenter = useMemo(() => averageCenter(nodes), [nodes])

	const effectiveSelectedNodeId = selectedNodeId ?? nodes[0]?.nodeId ?? null
	const effectiveSelectedLinkId = selectedLinkId ?? liveTelemetryLinks[0]?.id ?? links[0]?.id ?? null

	const selectedNode = useMemo(
		() => nodes.find((node) => node.nodeId === effectiveSelectedNodeId) ?? null,
		[effectiveSelectedNodeId, nodes],
	)

	const selectedLink = useMemo(
		() => links.find((link) => link.id === effectiveSelectedLinkId) ?? null,
		[effectiveSelectedLinkId, links],
	)

	const selectedNodeLinks = useMemo(
		() =>
			selectedNode
				? links.filter(
						(link) => link.sourceNodeId === selectedNode.nodeId || link.targetNodeId === selectedNode.nodeId,
					)
				: [],
		[links, selectedNode],
	)

	const avgLatency = useMemo(() => {
		if (liveTelemetryLinks.length === 0) return 0
		return Math.round(liveTelemetryLinks.reduce((sum, item) => sum + item.latencyMs, 0) / liveTelemetryLinks.length)
	}, [liveTelemetryLinks])

	const healthStats = useMemo(() => {
		if (liveTelemetryLinks.length === 0) {
			return {
				avgJitter: 0,
				avgLossPct: 0,
				avgReliabilityPct: 0,
				p95Latency: 0,
				highLatencyCount: 0,
				highLossCount: 0,
			}
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

	const surfaceCardClass =
		'border-slate-200/80 bg-white/85 shadow-sm backdrop-blur supports-backdrop-filter:bg-white/70 dark:border-slate-800 dark:bg-slate-950/45'

	return (
		<div className="container mx-auto max-w-350 space-y-6 py-8">
			<div className="rounded-xl border border-slate-200/70 bg-linear-to-b from-white to-slate-50/70 p-5 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-slate-900/50">
				<h1 className="text-3xl font-bold tracking-tight">Servers & Fleet Map</h1>
				<p className="mt-1 text-muted-foreground">
					Real-time mesh topology with latency paths and live node/link telemetry.
				</p>
				<div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
					<Badge variant="secondary">{nodes.length} nodes</Badge>
					<Badge variant="secondary">{links.length} links</Badge>
					<Badge variant="outline">{liveTelemetryLinks.length} live telemetry</Badge>
					<Badge variant="outline">avg latency {avgLatency}ms</Badge>
					<Badge variant={status === 'connected' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>
						stream {status}
					</Badge>
				</div>
			</div>

			{lastError ? (
				<Card className={surfaceCardClass}>
					<CardHeader>
						<CardTitle className="text-destructive">Mesh stream error</CardTitle>
						<CardDescription>{lastError}</CardDescription>
					</CardHeader>
				</Card>
			) : null}

			<div className="grid gap-6 xl:grid-cols-[1fr_320px]">
				<Card className={`${surfaceCardClass} min-h-[70vh] xl:min-h-[74vh] flex flex-col`}>
					<CardHeader>
						<CardTitle className="flex items-center gap-2"><Network className="h-5 w-5" /> Fleet latency map</CardTitle>
						<CardDescription>Click a node or link to inspect live details.</CardDescription>
					</CardHeader>
					<CardContent className="min-h-0 flex-1">
						<FleetLatencyMap
							nodes={nodes}
							links={links}
							center={mapCenter}
							selectedNodeId={effectiveSelectedNodeId}
							selectedLinkId={effectiveSelectedLinkId}
							onNodeSelect={(nodeId) => {
								setSelectedNodeId(nodeId)
								setSelectionMode('node')
								setIsSelectionModalOpen(true)
							}}
							onLinkSelect={(linkId) => {
								setSelectedLinkId(linkId)
								setSelectionMode('link')
								setIsSelectionModalOpen(true)
							}}
						/>
					</CardContent>
				</Card>

				<div className="space-y-6">
					<Card className={surfaceCardClass}>
						<CardHeader>
							<CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Live status</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3 text-sm">
							<div className="flex items-center justify-between rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
								<span className="text-muted-foreground">Stream</span>
								<Badge variant={status === 'connected' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>{status}</Badge>
							</div>
							<div className="flex items-center justify-between rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
								<span className="text-muted-foreground">Membership version</span>
								<span className="font-semibold">v{meshEvent?.snapshot.version ?? 0}</span>
							</div>
							<div className="flex items-center justify-between rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
								<span className="text-muted-foreground">Sessions</span>
								<span className="font-semibold">{sessions.length}</span>
							</div>
						</CardContent>
					</Card>

					<Card className={surfaceCardClass}>
						<CardHeader>
							<CardTitle className="flex items-center gap-2"><Timer className="h-5 w-5" /> Global latency & reliability</CardTitle>
							<CardDescription>Aggregated health indicators across all active links.</CardDescription>
						</CardHeader>
						<CardContent className="text-sm">
							<div className="grid grid-cols-2 gap-3">
								<div className="rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
									<p className="text-xs text-muted-foreground">Avg jitter</p>
									<p className="text-lg font-semibold">{healthStats.avgJitter}ms</p>
								</div>
								<div className="rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
									<p className="text-xs text-muted-foreground">P95 latency</p>
									<p className="text-lg font-semibold">{healthStats.p95Latency}ms</p>
								</div>
								<div className="rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
									<p className="text-xs text-muted-foreground">Avg loss</p>
									<p className="text-lg font-semibold">{healthStats.avgLossPct}%</p>
								</div>
								<div className="rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
									<p className="text-xs text-muted-foreground">Avg reliability</p>
									<p className="text-lg font-semibold">{healthStats.avgReliabilityPct}%</p>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card className={surfaceCardClass}>
						<CardHeader>
							<CardTitle className="flex items-center gap-2"><TriangleAlert className="h-5 w-5" /> Hot links to inspect</CardTitle>
							<CardDescription>Highest-risk links ranked by latency, jitter and packet loss.</CardDescription>
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
												setSelectionMode('link')
												setIsSelectionModalOpen(true)
											}}
											className="flex w-full items-center justify-between rounded-md border border-slate-200/80 bg-white/70 px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:bg-slate-800"
										>
											<div className="space-y-0.5">
												<p className="font-mono text-[11px]">{link.sourceNodeId.slice(0, 8)} → {link.targetNodeId.slice(0, 8)}</p>
												<p className="text-[11px] text-muted-foreground">jitter {link.jitterMs}ms · loss {(link.packetLossRatio * 100).toFixed(2)}%</p>
											</div>
											<span className="text-xs font-semibold text-amber-600 dark:text-amber-300">{link.latencyMs}ms</span>
										</button>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>

			<Dialog open={isSelectionModalOpen} onOpenChange={setIsSelectionModalOpen}>
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{selectionMode === 'node' ? 'Server details' : 'Connection details'}
						</DialogTitle>
						<DialogDescription>
							{selectionMode === 'node'
								? 'Inspect node state and all connected links.'
								: 'Inspect latency, reliability, and transfer telemetry for this link.'}
						</DialogDescription>
					</DialogHeader>

					{selectionMode === 'node' ? (
						!selectedNode ? (
							<p className="text-sm text-muted-foreground">No node selected.</p>
						) : (
							<div className="space-y-4 text-sm">
								<div className="rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
									<p className="font-semibold">{selectedNode.label}</p>
									<p className="font-mono text-xs break-all text-muted-foreground">{selectedNode.nodeId}</p>
									<div className="mt-2 flex flex-wrap gap-2">
										<Badge variant={selectedNode.isLocal ? 'default' : 'secondary'}>
											{selectedNode.isLocal ? 'local' : 'peer'}
										</Badge>
										<Badge variant="outline">{selectedNode.role}</Badge>
										<Badge variant="outline">{selectedNode.lifecycleState}</Badge>
										<Badge variant="outline">{selectedNode.sessionState}</Badge>
									</div>
								</div>

								<div className="space-y-2">
									<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected links</p>
									{selectedNodeLinks.length === 0 ? (
										<p className="text-muted-foreground">No active links for this node.</p>
									) : (
										<div className="space-y-2">
											{selectedNodeLinks.map((link) => (
												<button
													key={link.id}
													type="button"
													onClick={() => {
														setSelectedLinkId(link.id)
														setSelectionMode('link')
													}}
													className="flex w-full items-center justify-between rounded-md border border-slate-200/80 bg-white/70 px-2.5 py-2 text-left transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:bg-slate-800"
												>
															<div className="space-y-0.5">
																<span className="font-mono text-[11px]">{link.sourceNodeId.slice(0, 8)} → {link.targetNodeId.slice(0, 8)}</span>
																{link.inferred ? (
																	<p className="text-[10px] text-amber-600 dark:text-amber-300">inferred topology link</p>
																) : null}
															</div>
															<span className="text-xs text-muted-foreground">{link.latencyMs}ms</span>
												</button>
											))}
										</div>
									)}
								</div>
							</div>
						)
					) : !selectedLink ? (
						<p className="text-sm text-muted-foreground">No link selected.</p>
					) : (
						<div className="space-y-4 text-sm">
							<div className="rounded-md border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
								<p className="font-semibold">{selectedLink.sourceNodeId.slice(0, 8)} → {selectedLink.targetNodeId.slice(0, 8)}</p>
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
								<div className="mt-2">
									<Badge variant={selectedLink.state === 'active' || selectedLink.state === 'up' ? 'default' : 'secondary'}>{selectedLink.state}</Badge>
									{selectedLink.inferred ? <Badge variant="outline" className="ml-2">inferred</Badge> : null}
								</div>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	)
}
