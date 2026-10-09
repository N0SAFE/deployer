'use client'

import type { DockerContainer } from '@repo/contracts-entities'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Toggle } from '@repo/ui/components/shadcn/toggle'
import { Clock, Download, Eraser, Pause, Play, Search, WrapText } from 'lucide-react'
import { DockerCopyButton } from '../../_components/docker-copy-button'
import type { LogsSource } from '../_hooks/use-logs-lines'

export interface ContainerOption {
  id: string
  name: string
  status: DockerContainer['status']
}

const SELECT_CLASS = 'h-8 min-w-0 rounded-md border border-border/70 bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring'

export interface LogsToolbarProps {
  containers: ContainerOption[]
  selectedId: string | null
  onSelectContainer: (id: string) => void
  source: LogsSource
  onSourceChange: (source: LogsSource) => void
  query: string
  onQueryChange: (query: string) => void
  matchCount: number
  matchedLines: number
  following: boolean
  onToggleFollow: () => void
  wrap: boolean
  onWrapChange: (wrap: boolean) => void
  showTimestamps: boolean
  onTimestampsChange: (show: boolean) => void
  visibleText: string
  hasLines: boolean
  onDownload: () => void
  onClear: () => void
}

export function LogsToolbar(props: LogsToolbarProps) {
  const searching = props.query.trim() !== ''
  return (
    <div className="space-y-2" role="toolbar" aria-label="Log viewer controls">
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Container</span>
          <select
            className={`${SELECT_CLASS} min-w-0 flex-1`}
            value={props.selectedId ?? ''}
            onChange={(event) => { props.onSelectContainer(event.target.value) }}
          >
            {props.containers.map((container) => (
              <option key={container.id} value={container.id}>{container.name} ({container.status})</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">Show</span>
          <select
            className={SELECT_CLASS}
            value={props.source}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'container' || value === 'events' || value === 'all') props.onSourceChange(value)
            }}
          >
            <option value="container">Container output</option>
            <option value="events">Docker events</option>
            <option value="all">Output + events</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search log lines"
            placeholder="Search lines…"
            value={props.query}
            onChange={(event) => { props.onQueryChange(event.target.value) }}
            className="h-8 pl-8"
          />
        </div>
        {searching ? (
          <span role="status" className="text-sm tabular-nums text-muted-foreground">
            {props.matchCount === 0 ? 'No matches' : `${props.matchCount.toLocaleString('en-US')} ${props.matchCount === 1 ? 'match' : 'matches'} in ${props.matchedLines.toLocaleString('en-US')} ${props.matchedLines === 1 ? 'line' : 'lines'}`}
          </span>
        ) : null}

        <Toggle
          variant="outline"
          size="sm"
          pressed={props.following}
          onPressedChange={props.onToggleFollow}
          aria-label={props.following ? 'Pause following new lines' : 'Resume following new lines'}
          className="gap-1.5"
        >
          {props.following ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {props.following ? 'Following' : 'Paused'}
        </Toggle>
        <Toggle variant="outline" size="sm" pressed={props.wrap} onPressedChange={props.onWrapChange} aria-label="Wrap long lines" className="gap-1.5">
          <WrapText className="size-3.5" aria-hidden />
          Wrap
        </Toggle>
        <Toggle variant="outline" size="sm" pressed={props.showTimestamps} onPressedChange={props.onTimestampsChange} aria-label="Show timestamps (UTC)" className="gap-1.5">
          <Clock className="size-3.5" aria-hidden />
          Time
        </Toggle>
        <span className="inline-flex items-center">
          <DockerCopyButton value={props.visibleText} label={props.hasLines ? 'visible log lines' : 'visible log lines (none yet)'} className="size-8" />
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Download visible lines as a text file" title="Download visible lines" disabled={!props.hasLines} onClick={props.onDownload}>
          <Download aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear the view (the stream keeps running)" title="Clear view" disabled={!props.hasLines} onClick={props.onClear}>
          <Eraser aria-hidden />
        </Button>
      </div>
    </div>
  )
}
