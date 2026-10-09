'use client'

import { Crown, Network, Server, ShieldCheck } from 'lucide-react'
import { StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import type { ClusterMasterView, ClusterNodeInventoryRow } from '@repo/api-contracts'
import type { ClusterSnapshot } from '@repo/contracts-entities'
import { CopyId } from '../../_components/copy-id-button'
import { Hint } from '../../_components/hint'
import { quorumInfo } from '../_utils/node-change-guard'

/** Swarm state, node and manager counts with quorum, and the controlling master — every term explained. */
export function ClusterSummary({ snapshot, nodes, master }: { snapshot: ClusterSnapshot | undefined; nodes: ClusterNodeInventoryRow[]; master: ClusterMasterView | undefined }) {
	const managers = nodes.filter((n) => n.swarmRole === 'manager').length
	const reachableManagers = nodes.filter((n) => n.swarmRole === 'manager' && n.state === 'active').length
	const q = quorumInfo(managers)
	const quorumOk = managers > 0 && reachableManagers >= q.majority
	return (
		<StatStrip>
			<Hint content="The Swarm engine state of the node serving this console. Anything other than active means workloads cannot be scheduled from here.">
				<StatStripItem icon={Network} label="Swarm state" value={snapshot ? <StatusBadge status={snapshot.localNodeState} /> : undefined}
					hint={snapshot?.clusterId ? <CopyId value={snapshot.clusterId} label="cluster id" /> : undefined} />
			</Hint>
			<Hint content="Nodes registered in the Swarm inventory, including down ones.">
				<StatStripItem icon={Server} label="Nodes" value={nodes.length} hint={`${String(nodes.filter((n) => n.state === 'active').length)} up`} />
			</Hint>
			<Hint content={`Managers hold the cluster state. A majority (${String(q.majority)} of ${String(managers)}) must be reachable to change the cluster; this tolerates ${String(q.tolerated)} manager failure${q.tolerated === 1 ? '' : 's'}. Use an odd number (3 or 5).`}>
				<StatStripItem icon={ShieldCheck} label="Managers reachable" value={`${String(reachableManagers)} / ${String(managers)}`}
					tone={managers === 0 ? undefined : quorumOk ? 'live' : 'danger'} hint={managers === 0 ? 'none' : quorumOk ? 'quorum held' : 'QUORUM LOST'} />
			</Hint>
			<Hint content="The manager currently coordinating the platform. The term counts elections: a rising term means the master changed.">
				<StatStripItem icon={Crown} label="Master" value={master ? <StatusBadge status={master.state} /> : undefined}
					hint={master ? <><CopyId value={master.nodeId} label="master node id" /> · term {String(master.term)}</> : 'none elected'} />
			</Hint>
		</StatStrip>
	)
}
