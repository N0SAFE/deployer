import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { LogsViewer } from '@/components/atomics/organisms/logs'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import { Calendar } from 'lucide-react'
import { formatInputDateTimeToIso, formatIsoToInputDateTime } from './_lib/log-date-time'
import { sanitizeContainerLogMessage } from './_lib/log-message'
import type { DockerContainerLogsTabProps } from './_models/logs-tab.types'

export function DockerContainerLogsTab({
  liveLogs,
  streamingEnabled,
  onToggleStreaming,
  onReset,
  hasMoreHistory,
  isLoadingHistory,
  onLoadOlderLogs,
  timeRange,
  onApplyTimeRange,
  onClearTimeRange,
  streamingLogsSupported,
}: DockerContainerLogsTabProps) {
  const [isTimeRangePopoverOpen, setIsTimeRangePopoverOpen] = useState(false)
  const [draftStartAt, setDraftStartAt] = useState('')
  const [draftEndAt, setDraftEndAt] = useState('')

  useEffect(() => {
    setDraftStartAt(formatIsoToInputDateTime(timeRange.start))
    setDraftEndAt(formatIsoToInputDateTime(timeRange.end))
  }, [timeRange.end, timeRange.start])

  const rangedLogs = useMemo(() => {
    const timeRangeStartMillis = timeRange.start ? Date.parse(timeRange.start) : null
    const timeRangeEndMillis = timeRange.end ? Date.parse(timeRange.end) : null

    return liveLogs
      .map((log) => ({ ...log, message: sanitizeContainerLogMessage(log.message) }))
      .filter((log) => {
        const timestamp = Date.parse(log.timestamp)
        if (!Number.isFinite(timestamp)) {
          return true
        }

        if (timeRangeStartMillis !== null && Number.isFinite(timeRangeStartMillis) && timestamp < timeRangeStartMillis) {
          return false
        }

        if (timeRangeEndMillis !== null && Number.isFinite(timeRangeEndMillis) && timestamp > timeRangeEndMillis) {
          return false
        }

        return true
      })
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
  }, [liveLogs, timeRange.end, timeRange.start])

  const lines = useMemo(() => {
    return rangedLogs.map((log, index) => ({
      id: `${log.id}:${String(index)}`,
      searchText: `${log.timestamp} ${log.stream} ${log.level} ${log.message}`,
      content: (
        <>
          <span className="text-emerald-400">[{log.timestamp}]</span>{' '}
          <span className="text-blue-300">[{log.stream}]</span>{' '}
          <span className={log.level === 'error' ? 'text-red-300' : log.level === 'warn' ? 'text-amber-300' : 'text-slate-200'}>
            [{log.level}]
          </span>{' '}
          <span>{log.message}</span>
        </>
      ),
    }))
  }, [rangedLogs])

  return (
    <LogsViewer
      lines={lines}
      hasMoreHistory={hasMoreHistory}
      isLoadingHistory={isLoadingHistory}
      onLoadOlderLogs={onLoadOlderLogs}
      onReset={onReset}
      streamingEnabled={streamingEnabled}
      onToggleStreaming={onToggleStreaming}
      badges={(
        <>
          <Badge variant="outline">tail -f</Badge>
          <Badge variant="outline">stdout/stderr</Badge>
          <Badge variant="outline">SSE live</Badge>
          <Badge variant="outline">+{hasMoreHistory ? '∞' : 'end'} history</Badge>
        </>
      )}
      extraToolbarContent={(
        <Popover open={isTimeRangePopoverOpen} onOpenChange={setIsTimeRangePopoverOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Time range
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(92vw,24rem)] space-y-3 p-3">
            <p className="text-xs font-medium text-muted-foreground">Filter logs by start and end time</p>

            <div className="space-y-1.5">
              <label htmlFor="docker-logs-start-at" className="text-xs text-muted-foreground">Start</label>
              <Input
                id="docker-logs-start-at"
                type="datetime-local"
                value={draftStartAt}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setDraftStartAt(event.target.value)
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="docker-logs-end-at" className="text-xs text-muted-foreground">End</label>
              <Input
                id="docker-logs-end-at"
                type="datetime-local"
                value={draftEndAt}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setDraftEndAt(event.target.value)
                }}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftStartAt('')
                  setDraftEndAt('')
                  onClearTimeRange()
                  setIsTimeRangePopoverOpen(false)
                }}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApplyTimeRange({
                    start: formatInputDateTimeToIso(draftStartAt),
                    end: formatInputDateTimeToIso(draftEndAt),
                  })
                  setIsTimeRangePopoverOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      notice={!streamingLogsSupported ? (
        <p className="text-xs text-muted-foreground">Inspect stream is connected, but this runtime does not expose container log streaming capability.</p>
      ) : null}
    />
  )
}
