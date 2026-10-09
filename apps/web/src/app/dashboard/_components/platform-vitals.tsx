'use client'

import { Cpu, Globe, HardDrive, Server, ShieldCheck, Waypoints, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { StatStrip, StatStripItem, type StatusTone } from '@/components/dashboard'
import { Hint } from './hint'

function Vital({ icon, label, value, hint, tone, help }: { icon: LucideIcon; label: string; value: ReactNode; hint?: ReactNode; tone?: StatusTone; help: string }) {
	return (
		<Hint content={help}>
			<StatStripItem icon={icon} label={label} value={value} hint={hint} tone={tone} />
		</Hint>
	)
}

export interface Vitals {
	nodes?: { live: number; total: number }
	managers?: number
	exposure?: { label: string; hint: string }
	mesh?: { members: number; up: boolean }
	/** Only set when the metrics source is real (`dataSource !== 'unavailable'`). */
	system?: { cpu: number; memory: number }
}

/** What the platform is made of, each figure explained on hover/focus; vitals with no source are omitted. */
export function PlatformVitals({ vitals }: { vitals: Vitals }) {
	return (
		<StatStrip>
			{vitals.nodes ? (
				<Vital icon={Server} label="Nodes live" value={`${String(vitals.nodes.live)} / ${String(vitals.nodes.total)}`}
					tone={vitals.nodes.live === vitals.nodes.total && vitals.nodes.total > 0 ? 'live' : 'pending'}
					help="Nodes seen recently out of all nodes registered in the Swarm inventory." />
			) : null}
			{vitals.managers !== undefined ? (
				<Vital icon={ShieldCheck} label="Managers" value={vitals.managers}
					help="Swarm managers hold the cluster state. Keep an odd number (3 or 5) so a majority (quorum) survives a failure." />
			) : null}
			{vitals.exposure ? (
				<Vital icon={Globe} label="Reachable from" value={vitals.exposure.label} hint={vitals.exposure.hint}
					help="Which ingress lanes are on: local (this machine), private (mesh members) and public (the internet, through the edge)." />
			) : null}
			{vitals.mesh ? (
				<Vital icon={Waypoints} label="Mesh" value={vitals.mesh.up ? `${String(vitals.mesh.members)} members` : 'not running'}
					tone={vitals.mesh.up ? undefined : 'pending'}
					help="The WireGuard network nodes use to talk to each other. Members are nodes and operators that joined it." />
			) : null}
			{vitals.system ? (
				<>
					<Vital icon={Cpu} label="Container CPU" value={`${vitals.system.cpu.toFixed(0)}%`} tone={vitals.system.cpu > 80 ? 'pending' : undefined}
						help="Average CPU of containers on the node serving this console. Not fleet-wide." />
					<Vital icon={HardDrive} label="Container memory" value={`${vitals.system.memory.toFixed(0)}%`} tone={vitals.system.memory > 80 ? 'pending' : undefined}
						help="Container memory in use versus their limits, on the node serving this console. Not fleet-wide." />
				</>
			) : null}
		</StatStrip>
	)
}
