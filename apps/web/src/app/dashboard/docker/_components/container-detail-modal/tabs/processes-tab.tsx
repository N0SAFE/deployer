import { Fragment } from 'react'
import type { DockerContainerLogEntry, DockerContainerProcessEntry } from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'

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
        <p className="text-xs text-muted-foreground">Process list from inspect stream updates.</p>
        <Button type="button" variant="outline" size="sm" onClick={onToggleAutoRefresh}>
          {processesAutoRefresh ? 'Pause updates' : 'Resume updates'}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/70">
            <tr>
              <th className="text-left p-2">PID</th>
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">State</th>
              <th className="text-left p-2">CPU %</th>
              <th className="text-left p-2">Mem %</th>
              <th className="text-left p-2">Command</th>
            </tr>
          </thead>
          <tbody>
            {liveProcesses.map((proc) => {
              const isExpanded = expandedProcessPid === proc.pid
              const processLogs = isExpanded ? expandedProcessLogs : []

              return (
                <Fragment key={`${proc.pid}-${proc.command}`}>
                  <tr
                    className="border-t cursor-pointer hover:bg-muted/40"
                    onClick={() => onToggleProcess(proc.pid)}
                  >
                    <td className="p-2 font-mono">{proc.pid}</td>
                    <td className="p-2">{proc.user}</td>
                    <td className="p-2"><Badge variant="outline">{proc.state}</Badge></td>
                    <td className="p-2">{proc.cpuPercent.toFixed(1)}</td>
                    <td className="p-2">{proc.memoryPercent.toFixed(1)}</td>
                    <td className="p-2 font-mono break-all">{proc.command}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="border-t bg-muted/20">
                      <td colSpan={6} className="p-2">
                        <div className="rounded border bg-background/80 divide-y">
                          {processLogs.length > 0 ? processLogs.map((log) => (
                            <div key={log.id} className="px-3 py-2 text-xs font-mono">
                              <span className="text-muted-foreground">[{log.timestamp}]</span>{' '}
                              <span className="text-muted-foreground">{log.stream}</span>{' '}
                              <span className={log.level === 'error' ? 'text-red-500' : log.level === 'warn' ? 'text-amber-500' : ''}>{log.level}</span>{' '}
                              <span>{log.message}</span>
                            </div>
                          )) : (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              Waiting for process-scoped logs...
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
      <p className="text-xs text-muted-foreground">Tip: click a process row to expand/collapse its logs inline.</p>
    </div>
  )
}
