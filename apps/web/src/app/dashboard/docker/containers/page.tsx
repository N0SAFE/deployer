'use client'

import { useCallback, useMemo, useState } from 'react'
import { Box } from 'lucide-react'
import { toast } from 'sonner'
import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'
import { EmptyState, StatStrip, StatStripItem, StatusDot } from '@/components/dashboard'
import { useDockerRuntimeSseState } from '@/domains/docker/hooks'
import { AuthDashboardDockerContainers } from '@/routes/index'
import { DockerCreateContainerModal } from '../_components/docker-create-container-modal'
import { DockerEngineError } from '../_components/docker-engine-error'
import { DockerTableSkeleton } from '../_components/docker-loading-states'
import { DockerBatchOperationsBar, type DockerBatchAction } from '../_components/docker-operations-controls'
import { DockerTablePagination } from '../_components/docker-table-pagination'
import { useDockerDataTable } from '../_components/use-docker-data-table'
import { ContainersActionConfirm } from './_components/containers-action-confirm'
import { ContainersTable } from './_components/containers-table'
import { ContainersToolbar } from './_components/containers-toolbar'
import { SharedDaemonNotice } from './_components/shared-daemon-notice'
import { useContainerActions } from './_hooks/use-container-actions'
import { useContainersData } from './_hooks/use-containers-data'
import {
  CONTAINER_LIST_QUERY_SCHEMA,
  type ContainerAction,
  type ContainerListQuery,
  type ContainerSortKey,
} from './_models/container-list.model'
import {
  CONTAINER_SORTERS,
  actionTargets,
  filterContainerRows,
  hasActiveFilters,
  summarizeContainers,
} from './_utils/container-rows'

const BULK_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const satisfies readonly DockerBatchAction[]

const CLEARED_FILTERS = { q: '', view: 'all', status: 'all', environment: 'all', ownership: 'all', page: 1 } as const

function resolveQuery(raw: Partial<ContainerListQuery>): ContainerListQuery {
  return {
    q: raw.q ?? '',
    view: raw.view ?? 'all',
    status: raw.status ?? 'all',
    environment: raw.environment ?? 'all',
    ownership: raw.ownership ?? 'all',
    sortBy: raw.sortBy ?? 'updated',
    sortDirection: raw.sortDirection ?? 'desc',
    page: raw.page ?? 1,
    pageSize: raw.pageSize ?? 20,
  }
}

function isBulkAction(action: DockerBatchAction): action is ContainerAction {
  return action !== 'update'
}

export default AuthDashboardDockerContainers.Route(function DashboardDockerContainersPage() {
  const [rawQuery, setQuery] = useSafeQueryParamStatesFromZod(CONTAINER_LIST_QUERY_SCHEMA)
  const query = resolveQuery(rawQuery)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const sse = useDockerRuntimeSseState()

  const data = useContainersData()
  const { rows: allRows, refetch } = data

  const statuses = useMemo(() => [...new Set(allRows.map((row) => row.status))].sort(), [allRows])
  const environments = useMemo(
    () => [...new Set(allRows.flatMap((row) => (row.environment ? [row.environment] : [])))].sort(),
    [allRows],
  )

  const { q, view, status, environment, ownership } = query
  const filtered = useMemo(
    () => filterContainerRows(allRows, { q, view, status, environment, ownership }),
    [allRows, q, view, status, environment, ownership],
  )
  const filtersActive = hasActiveFilters(query)
  const summary = useMemo(() => summarizeContainers(filtered), [filtered])

  const table = useDockerDataTable({
    data: filtered,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    page: query.page,
    pageSize: query.pageSize,
    sorters: CONTAINER_SORTERS,
  })

  // Selection only counts rows still visible: a filter change must not leave
  // invisible containers inside a bulk action.
  const selectedRows = useMemo(() => filtered.filter((row) => selectedIds.has(row.id)), [filtered, selectedIds])

  const removeFromSelection = useCallback((ids: string[]) => {
    setSelectedIds((previous) => new Set([...previous].filter((id) => !ids.includes(id))))
  }, [])
  const refresh = useCallback(async () => {
    try {
      await refetch()
    } catch {
      toast.error('Could not refresh containers', { description: 'The Docker engine did not answer.' })
    }
  }, [refetch])

  const actions = useContainerActions({ onSettled: refresh, onRemoved: removeFromSelection })

  const applicableCounts = useMemo(
    () => Object.fromEntries(BULK_ACTIONS.map((action) => [action, actionTargets(action, selectedRows).length])),
    [selectedRows],
  )

  const exportRows = useMemo(
    () => filtered.map((row) => ({ ...row, ports: row.ports.join(' ') })),
    [filtered],
  )

  const handleSort = (key: ContainerSortKey) => {
    if (query.sortBy === key) setQuery({ sortDirection: query.sortDirection === 'asc' ? 'desc' : 'asc', page: 1 })
    else setQuery({ sortBy: key, sortDirection: key === 'updated' ? 'desc' : 'asc', page: 1 })
  }

  const toggleRow = (id: string, selected: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const toggleAllOnPage = (selected: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      for (const row of table.rows) {
        if (selected) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }

  const isEmptyNode = !data.isLoading && !data.hasError && allRows.length === 0

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
        <ContainersToolbar
          query={query}
          statuses={statuses}
          environments={environments}
          exportRows={exportRows}
          filtersActive={filtersActive}
          isRefreshing={data.isRefreshing}
          onQueryChange={(patch) => { setQuery(patch) }}
          onClearFilters={() => { setQuery(CLEARED_FILTERS) }}
          onCreate={() => { setIsCreateOpen(true) }}
          onRefresh={() => { void refresh() }}
        />

        <SharedDaemonNotice ownership={ownership} />

        {data.hasError ? (
          <div className="p-3">
            <DockerEngineError what="containers" error={null} onRetry={() => { void refresh() }} isRetrying={data.isRefreshing} />
          </div>
        ) : null}

        <DockerBatchOperationsBar
          selectedCount={selectedRows.length}
          resourceLabel="containers"
          actions={BULK_ACTIONS}
          applicableCounts={applicableCounts}
          busy={actions.isBusy}
          onAction={(action) => { if (isBulkAction(action)) actions.request(action, selectedRows) }}
          onClearSelection={() => { setSelectedIds(new Set()) }}
        />

        {data.isLoading ? (
          <div className="p-3">
            <DockerTableSkeleton columns={6} rows={6} label="Loading containers…" />
          </div>
        ) : isEmptyNode ? (
          <div className="p-3">
            <EmptyState
              icon={Box}
              title="No containers on this node"
              description="Containers started by Docker or by a deployment show up here as soon as they exist."
              action={{ label: 'Create container', onClick: () => { setIsCreateOpen(true) } }}
            />
          </div>
        ) : (
          <>
            <ContainersTable
              rows={table.rows}
              entityById={data.entityById}
              selectedIds={selectedIds}
              sortBy={query.sortBy}
              sortDirection={query.sortDirection}
              actionsDisabled={actions.isBusy}
              onSort={handleSort}
              onToggleRow={toggleRow}
              onToggleAll={toggleAllOnPage}
              onStateChange={() => { void refresh() }}
              onAction={actions.request}
              onClearFilters={() => { setQuery(CLEARED_FILTERS) }}
            />
            <div className="space-y-2 border-t border-border/60 p-3">
              <DockerTablePagination
                page={table.page}
                pageSize={table.pageSize}
                totalRows={table.totalRows}
                totalPages={table.totalPages}
                from={table.from}
                to={table.to}
                onPageChange={(page) => { setQuery({ page }) }}
                onPageSizeChange={(pageSize) => { setQuery({ pageSize, page: 1 }) }}
              />
              <StatStrip
                bare
                trailing={
                  <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot tone={sse.status === 'connected' ? 'live' : sse.status === 'error' ? 'danger' : 'pending'} />
                    {sse.status === 'connected' ? 'Live updates on' : sse.status === 'connecting' ? 'Connecting to live updates…' : 'Live updates paused; use Refresh'}
                  </span>
                }
              >
                <StatStripItem label={filtersActive ? 'Matching' : 'Containers'} value={summary.total} />
                <StatStripItem label="Running" value={summary.running} tone="live" />
                <StatStripItem label="Stopped" value={summary.stopped} />
                <StatStripItem label="Unhealthy" value={summary.unhealthy} tone={summary.unhealthy > 0 ? 'danger' : undefined} />
              </StatStrip>
            </div>
          </>
        )}
      </section>

      <ContainersActionConfirm
        request={actions.confirmation}
        pending={actions.isBusy}
        onConfirm={actions.confirm}
        onCancel={actions.cancel}
      />
      <DockerCreateContainerModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreated={(payload) => {
          void refresh()
          toast.success(`Container ${payload.name} created`, {
            description: `${payload.image}. Image pull: ${payload.pullScanSummary.pullStatus}, security scan: ${payload.pullScanSummary.scanStatus}.`,
          })
        }}
      />
    </>
  )
})
