'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { RelativeTime } from '../../_components/relative-time'
import { CardBody, DataSourceBadge } from './card-states'
import { Button } from '@deployer/ui/components/shadcn/button'

export interface ResourceReading {
	cpu: number
	memory: number
	disk: number
	inbound: number
	outbound: number
	dataSource: string
	timestamp: string | Date
}

export function formatBytes(bytes: number): string {
	if (bytes <= 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
	return `${(bytes / 1024 ** i).toFixed(1)} ${units[i] ?? 'B'}`
}

function Meter({ label, value, help }: { label: string; value: number; help: string }) {
	const clamped = Math.max(0, Math.min(100, value))
	return (
		<div className="space-y-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-sm font-medium">{label}</span>
				<span className="text-sm tabular-nums">{value.toFixed(1)}%{clamped > 80 ? ' · high' : ''}</span>
			</div>
			<div
				role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}
				className="h-2 overflow-hidden rounded-full bg-muted"
			>
				<div className={clamped > 80 ? 'h-full bg-status-pending' : 'h-full bg-primary'} style={{ width: `${String(clamped)}%` }} />
			</div>
			<p className="text-xs text-muted-foreground">{help}</p>
		</div>
	)
}

/**
 * The resource card is a READING, not a history. The API samples the Docker
 * engine once per request; the earlier time-series chart repeated that single
 * sample across every bucket and so drew a flat "trend" that never existed.
 */
export function ResourceSnapshotCard({ reading, loading, error, onRetry }: { reading: ResourceReading | undefined; loading: boolean; error: boolean; onRetry: () => void }) {
	const unavailable = reading?.dataSource === 'unavailable'
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
				<div>
					<CardTitle className="text-base">Resource usage — right now</CardTitle>
					<CardDescription>
						A live reading from the node serving this console, refreshed every 10 s
						{reading ? <> · updated <RelativeTime value={reading.timestamp} /></> : null}. History is not recorded yet.
					</CardDescription>
				</div>
				<DataSourceBadge source={reading?.dataSource} />
			</CardHeader>
			<CardContent>
				<CardBody loading={loading} error={error} onRetry={onRetry} empty={reading === undefined || unavailable} height="h-40"
					emptyText="The Docker engine could not be read on this node, so there is nothing to show. Check that the API can reach the Docker socket."
					emptyAction={<Button size="sm" variant="outline" onClick={onRetry}>Check again</Button>}>
					{reading ? (
						<div className="grid gap-6 md:grid-cols-3">
							<Meter label="CPU" value={reading.cpu} help="Average across running containers." />
							<Meter label="Memory" value={reading.memory} help="Containers' memory use versus their limits." />
							<Meter label="Disk" value={reading.disk} help="Filesystems visible to the API, used / total." />
							<p className="text-sm text-muted-foreground md:col-span-3">
								Network since containers started: <span className="tabular-nums text-foreground">{formatBytes(reading.inbound)}</span> received,{' '}
								<span className="tabular-nums text-foreground">{formatBytes(reading.outbound)}</span> sent (summed over containers).
							</p>
						</div>
					) : null}
				</CardBody>
			</CardContent>
		</Card>
	)
}
