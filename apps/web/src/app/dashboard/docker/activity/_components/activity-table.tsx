'use client'

import type { DockerRuntimeActivityEntity } from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@deployer/ui/components/shadcn/table'

import { StatusBadge } from '@/components/dashboard'
import { cn } from '@/lib/utils'

import { DockerRelativeTime } from '../../_components/docker-relative-time'
import {
    resolveResourceName,
    resolveSwarmSummary,
    resolveSwarmTaskErrors,
} from '../_utils/activity-fields'
import { describeActivity } from '../_utils/describe-activity'

import { severityVariant } from './activity-severity'

/**
 * Event table. Each row is keyboard-selectable (a real button in the first cell),
 * the sentence leads, and the raw `source.action` stays available as a secondary line.
 */
export function ActivityTable({
    activities,
    selectedId,
    onSelect,
}: {
    activities: readonly DockerRuntimeActivityEntity[]
    selectedId: string | null
    onSelect: (id: string) => void
}) {
    return (
        <div className="border-border/60 max-h-[70vh] overflow-auto rounded-xl border">
            <Table>
                <TableHeader className="bg-card sticky top-0 z-10">
                    <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Detail</TableHead>
                        <TableHead>When</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {activities.map((activity) => {
                        const resourceName = resolveResourceName(activity)
                        const taskErrors = resolveSwarmTaskErrors(activity)
                        const swarmSummary = resolveSwarmSummary(activity)
                        const selected = activity.id === selectedId
                        return (
                            <TableRow
                                key={activity.id}
                                data-state={selected ? 'selected' : undefined}
                                className="hover:bg-muted/40"
                            >
                                <TableCell className="min-w-64">
                                    <button
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() => {
                                            onSelect(activity.id)
                                        }}
                                        className="focus-visible:outline-ring block text-left text-sm font-medium hover:underline focus-visible:outline-2"
                                    >
                                        {describeActivity({
                                            source: activity.source,
                                            action: activity.action,
                                            resourceName,
                                        })}
                                    </button>
                                    <p className="text-muted-foreground font-mono text-xs">
                                        {activity.source}.{activity.action}
                                    </p>
                                    {swarmSummary ? (
                                        <p className="text-muted-foreground text-xs">
                                            {swarmSummary}
                                        </p>
                                    ) : null}
                                    {typeof activity.progress === 'number' ? (
                                        <div
                                            className="mt-1 flex items-center gap-2"
                                            role="progressbar"
                                            aria-valuenow={activity.progress}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-label="Progress"
                                        >
                                            <div className="bg-muted h-1.5 w-24 overflow-hidden rounded">
                                                <div
                                                    className="bg-primary h-full"
                                                    style={{
                                                        width: `${String(activity.progress)}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className="text-muted-foreground text-xs">
                                                {activity.progress}%
                                            </span>
                                        </div>
                                    ) : null}
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <StatusBadge status={activity.status} />
                                        {activity.severity !== 'info' ? (
                                            <Badge
                                                variant={severityVariant(
                                                    activity.severity
                                                )}
                                            >
                                                {activity.severity}
                                            </Badge>
                                        ) : null}
                                    </div>
                                </TableCell>
                                <TableCell className="max-w-96">
                                    {taskErrors.length > 0 ? (
                                        <p
                                            className="text-destructive truncate text-sm font-medium"
                                            title={taskErrors[0]}
                                        >
                                            {taskErrors[0]}
                                        </p>
                                    ) : (
                                        <p
                                            className={cn(
                                                'text-muted-foreground truncate text-sm'
                                            )}
                                            title={
                                                activity.message ?? undefined
                                            }
                                        >
                                            {activity.message ??
                                                activity.stage ??
                                                activity.scanner ??
                                                '—'}
                                        </p>
                                    )}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                    <DockerRelativeTime
                                        value={activity.occurredAt}
                                    />
                                </TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </div>
    )
}
