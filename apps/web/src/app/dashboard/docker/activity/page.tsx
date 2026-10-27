'use client'

import { useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { useSafeQueryParamStatesFromZod } from '@deployer/use-safe-query-param-states-from-zod'
import { EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { DockerEngineError } from '../_components/docker-engine-error'
import { DockerPageSkeleton } from '../_components/docker-loading-states'
import { useDockerNode } from '../_components/docker-node-context'
import { ActivityDetail } from './_components/activity-detail'
import { ActivityFilters, ActivityLiveIndicator } from './_components/activity-toolbar'
import { ActivityTable } from './_components/activity-table'
import { useActivityFeed, useSelectedActivity } from './_hooks/use-activity-feed'
import { ACTIVITY_QUERY_SCHEMA, filterActivities, hasActiveFilters } from './_utils/activity-filters'

export default function DashboardDockerActivityPage() {
  const { nodeName } = useDockerNode()
  const [filters, setFilters] = useSafeQueryParamStatesFromZod(ACTIVITY_QUERY_SCHEMA)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const feed = useActivityFeed()

  const filtered = useMemo(() => filterActivities(feed.activities, filters), [feed.activities, filters])
  const selection = useSelectedActivity(selectedId, feed.activities)

  if (feed.isLoading) return <DockerPageSkeleton label={`Loading engine activity from ${nodeName}…`} columns={4} />

  const filtering = hasActiveFilters(filters)

  return (
    <div className="space-y-4">
      {feed.historyError ? (
        <DockerEngineError what="activity history" error={feed.historyError} onRetry={feed.refetchHistory} isRetrying={feed.isRefetchingHistory} />
      ) : null}

      <ActivityLiveIndicator
        connection={feed.connection}
        paused={feed.paused}
        bufferedCount={feed.bufferedCount}
        onTogglePause={feed.paused ? feed.resume : feed.pause}
        onReconnect={feed.reconnect}
      />
      <ActivityFilters filters={filters} onChange={(patch) => { setFilters(patch) }} />
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {feed.activities.length} events from {nodeName}. History is stored; live events are merged in and capped in memory.
      </p>

      {selection.selected ? (
        <ActivityDetail
          activity={selection.selected}
          isFetching={selection.isFetching}
          isError={selection.isError}
          onClose={() => { setSelectedId(null) }}
        />
      ) : null}

      {feed.activities.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No engine activity recorded on this node yet"
          description="Events appear as containers start and stop, images are pulled or scanned, and networks or volumes change."
        />
      ) : filtered.length === 0 && filtering ? (
        <FilteredEmptyState label="No events match these filters." onClear={() => { setFilters({ q: '', kind: 'all', severity: 'all', status: 'all' }) }} />
      ) : (
        <ActivityTable activities={filtered} selectedId={selectedId} onSelect={setSelectedId} />
      )}
    </div>
  )
}
