'use client'

import { Pause, Play, RefreshCw, Search } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { cn } from '@/lib/utils'
import { StatusDot } from '@/components/dashboard'
import type { FeedConnection } from '../_hooks/use-activity-feed'
import { ACTIVITY_KIND_LABELS } from '../_utils/describe-activity'
import { ACTIVITY_QUERY_SCHEMA, KIND_FILTERS, SEVERITY_FILTERS, STATUS_FILTERS, type ActivityFilters as ActivityFilterState } from '../_utils/activity-filters'

const SELECT_CLASS = 'h-9 rounded-md border border-border/70 bg-background px-3 text-sm'

function liveMessage(connection: FeedConnection, paused: boolean, bufferedCount: number): { text: string; status: string } {
  if (paused) {
    return {
      text: bufferedCount > 0
        ? `Paused: ${String(bufferedCount)} new event${bufferedCount === 1 ? '' : 's'} held back until you resume`
        : 'Paused: new events are held back until you resume',
      status: 'paused',
    }
  }
  switch (connection) {
    case 'live': return { text: 'Live: new events appear as they happen', status: 'connected' }
    case 'connecting': return { text: 'Connecting to the live event stream…', status: 'connecting' }
    case 'error': return { text: 'Live stream failed: events after the last one shown may be missing', status: 'error' }
    case 'disconnected': return { text: 'Live stream is not connected: showing history only', status: 'disconnected' }
  }
}

export function ActivityLiveIndicator({ connection, paused, bufferedCount, onTogglePause, onReconnect }: {
  connection: FeedConnection
  paused: boolean
  bufferedCount: number
  onTogglePause: () => void
  onReconnect: () => void
}) {
  const { text, status } = liveMessage(connection, paused, bufferedCount)
  const needsReconnect = !paused && (connection === 'error' || connection === 'disconnected')
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="inline-flex items-center gap-2 text-sm">
        <StatusDot status={status} pulse={!paused && connection === 'live'} />
        <span className={cn(connection === 'error' && !paused && 'text-destructive')}>{text}</span>
      </p>
      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={onTogglePause} aria-pressed={paused}>
        {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      {needsReconnect ? (
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={onReconnect}>
          <RefreshCw className="size-3.5" aria-hidden />
          Reconnect
        </Button>
      ) : null}
    </div>
  )
}

export function ActivityFilters({ filters, onChange }: {
  filters: ActivityFilterState
  onChange: (patch: Partial<ActivityFilterState>) => void
}) {
  const shape = ACTIVITY_QUERY_SCHEMA.shape
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-56">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={filters.q}
          onChange={(event) => { onChange({ q: event.target.value }) }}
          className="h-9 pl-9"
          placeholder="Search events, resources, errors…"
          aria-label="Search activity"
        />
      </div>
      <select aria-label="Filter by resource kind" className={SELECT_CLASS} value={filters.kind} onChange={(event) => { onChange({ kind: shape.kind.parse(event.target.value) }) }}>
        {KIND_FILTERS.map((option) => (
          <option key={option} value={option}>{option === 'all' ? 'All resources' : ACTIVITY_KIND_LABELS[option]}</option>
        ))}
      </select>
      <select aria-label="Filter by severity" className={SELECT_CLASS} value={filters.severity} onChange={(event) => { onChange({ severity: shape.severity.parse(event.target.value) }) }}>
        {SEVERITY_FILTERS.map((option) => <option key={option} value={option}>{option === 'all' ? 'All severities' : option}</option>)}
      </select>
      <select aria-label="Filter by status" className={SELECT_CLASS} value={filters.status} onChange={(event) => { onChange({ status: shape.status.parse(event.target.value) }) }}>
        {STATUS_FILTERS.map((option) => <option key={option} value={option}>{option === 'all' ? 'All statuses' : option}</option>)}
      </select>
    </div>
  )
}
