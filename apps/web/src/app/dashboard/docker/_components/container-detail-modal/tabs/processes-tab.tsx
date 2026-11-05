import { Fragment } from 'react'

import type {
    DockerContainerLogEntry,
    DockerContainerProcessEntry,
} from '@deployer/contracts-entities'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'

interface DockerContainerProcessesTabProps {
    liveProcesses: DockerContainerProcessEntry[]
    expandedProcessPid: number | null
    expandedProcessLogs: DockerContainerLogEntry[]
    processesAutoRefresh: boolean
    onToggleAutoRefresh: () => void
    onToggleProcess: (pid: number) => void
}

export function DockerContainerProcessesTab({
    liveProcesses,
    expandedProcessPid,
    expandedProcessLogs,
    processesAutoRefresh,
    onToggleAutoRefresh,
    onToggleProcess,
}: DockerContainerProcessesTabProps) {
    return (
        <div className="flex min-h-0 flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-xs">
                    Process list from inspect stream updates.
                </p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onToggleAutoRefresh}
                >
                    {processesAutoRefresh ? 'Pause updates' : 'Resume updates'}
                </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded border">
                <table className="w-full text-xs">
                    <thead className="bg-muted/70 sticky top-0">
                        <tr>
                            <th className="p-2 text-left">PID</th>
                            <th className="p-2 text-left">User</th>
                            <th className="p-2 text-left">State</th>
                            <th className="p-2 text-left">CPU %</th>
                            <th className="p-2 text-left">Mem %</th>
                            <th className="p-2 text-left">Command</th>
                        </tr>
                    </thead>
                    <tbody>
                        {liveProcesses.map((proc) => {
                            const isExpanded = expandedProcessPid === proc.pid
                            const processLogs = isExpanded
                                ? expandedProcessLogs
                                : []

                            return (
                                <Fragment
                                    key={`${String(proc.pid)}-${proc.command}`}
                                >
                                    <tr
                                        className="hover:bg-muted/40 cursor-pointer border-t"
                                        onClick={() => {
                                            onToggleProcess(proc.pid)
                                        }}
                                    >
                                        <td className="p-2 font-mono">
                                            {proc.pid}
                                        </td>
                                        <td className="p-2">{proc.user}</td>
                                        <td className="p-2">
                                            <Badge variant="outline">
                                                {proc.state}
                                            </Badge>
                                        </td>
                                        <td className="p-2">
                                            {proc.cpuPercent.toFixed(1)}
                                        </td>
                                        <td className="p-2">
                                            {proc.memoryPercent.toFixed(1)}
                                        </td>
                                        <td className="p-2 font-mono break-all">
                                            {proc.command}
                                        </td>
                                    </tr>
                                    {isExpanded ? (
                                        <tr className="bg-muted/20 border-t">
                                            <td colSpan={6} className="p-2">
                                                <div className="bg-background/80 divide-y rounded border">
                                                    {processLogs.length > 0 ? (
                                                        processLogs.map(
                                                            (log) => (
                                                                <div
                                                                    key={log.id}
                                                                    className="px-3 py-2 font-mono text-xs"
                                                                >
                                                                    <span className="text-muted-foreground">
                                                                        [
                                                                        {
                                                                            log.timestamp
                                                                        }
                                                                        ]
                                                                    </span>{' '}
                                                                    <span className="text-muted-foreground">
                                                                        {
                                                                            log.stream
                                                                        }
                                                                    </span>{' '}
                                                                    <span
                                                                        className={
                                                                            log.level ===
                                                                            'error'
                                                                                ? 'text-red-500'
                                                                                : log.level ===
                                                                                    'warn'
                                                                                  ? 'text-amber-500'
                                                                                  : ''
                                                                        }
                                                                    >
                                                                        {
                                                                            log.level
                                                                        }
                                                                    </span>{' '}
                                                                    <span>
                                                                        {
                                                                            log.message
                                                                        }
                                                                    </span>
                                                                </div>
                                                            )
                                                        )
                                                    ) : (
                                                        <div className="text-muted-foreground px-3 py-2 text-xs">
                                                            Waiting for
                                                            process-scoped
                                                            logs...
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <p className="text-muted-foreground text-xs">
                Tip: click a process row to expand/collapse its logs inline.
            </p>
        </div>
    )
}
