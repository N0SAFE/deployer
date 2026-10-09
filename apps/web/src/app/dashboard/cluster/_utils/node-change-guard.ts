/**
 * Which node edits need a confirmation, and what to tell the operator.
 * Pure so the quorum arithmetic is tested.
 */

export interface GuardNode {
	nodeId: string
	hostname: string
	swarmRole: string
	platformRole: string
	isMaster: boolean
	isIngress: boolean
}

export type NodeChange =
	| { kind: 'platformRole'; role: 'both' | 'control' | 'worker' }
	| { kind: 'ingress'; ingress: boolean }

/** Swarm (Raft) needs a majority of managers reachable to accept any change. */
export function quorumInfo(managers: number): { majority: number; tolerated: number } {
	if (managers <= 0) return { majority: 0, tolerated: 0 }
	const majority = Math.floor(managers / 2) + 1
	return { majority, tolerated: managers - majority }
}

export interface Confirmation {
	title: string
	consequence: string
	confirmLabel: string
}

export function confirmationFor(node: GuardNode, change: NodeChange, all: GuardNode[]): Confirmation | null {
	const name = node.hostname || node.nodeId.slice(0, 12)
	if (change.kind === 'platformRole') {
		if (change.role === 'worker' && node.swarmRole === 'manager' && node.platformRole !== 'worker') {
			const managers = all.filter((n) => n.swarmRole === 'manager').length
			const after = managers - 1
			const before = quorumInfo(managers)
			const next = quorumInfo(after)
			const lines = [
				`${name} stops taking part in the control plane.`,
				`Managers go from ${String(managers)} to ${String(after)}. A majority of managers must stay reachable to change the cluster: ${String(managers)} managers tolerate ${String(before.tolerated)} failure${before.tolerated === 1 ? '' : 's'}, ${String(after)} tolerate ${String(next.tolerated)}.`,
			]
			if (after === 0) lines.push('This is the last manager: nothing could change the cluster afterwards.')
			if (node.isMaster) lines.push('It is the controlling master, so a new master will be elected.')
			return { title: `Make ${name} a worker only?`, consequence: lines.join(' '), confirmLabel: 'Make worker only' }
		}
		return null
	}
	if (!change.ingress && node.isIngress && all.filter((n) => n.isIngress).length === 1) {
		return {
			title: `Remove the only ingress node?`,
			consequence: `${name} is the only node labelled for ingress. Without one, workloads that ask to avoid ingress nodes have no restriction, and nothing is marked to receive public traffic.`,
			confirmLabel: 'Remove ingress label',
		}
	}
	return null
}
