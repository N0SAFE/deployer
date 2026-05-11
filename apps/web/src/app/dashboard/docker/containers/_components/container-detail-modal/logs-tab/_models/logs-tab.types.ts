import type { DockerContainerLogEntry } from '@repo/contracts-entities'

export interface LogsTimeRange {
  start: string | null
  end: string | null
}

export interface DockerContainerLogsTabProps {
  liveLogs: DockerContainerLogEntry[]
  streamingEnabled: boolean
  onToggleStreaming: () => void
  onReset: () => void
  hasMoreHistory: boolean
  isLoadingHistory: boolean
  onLoadOlderLogs: () => void
  timeRange: LogsTimeRange
  onApplyTimeRange: (range: LogsTimeRange) => void
  onClearTimeRange: () => void
  streamingLogsSupported: boolean
}
