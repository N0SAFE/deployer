'use client'

import { useEffect, useMemo } from 'react'
import { z } from 'zod'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'
import { useDockerVolumeEventsStream, useDockerVolumeList } from '@/domains/docker/hooks'
import { DockerEngineError } from '../_components/docker-engine-error'
import { DockerTablePagination } from '../_components/docker-table-pagination'
import { DockerActiveFilterChips, DockerExportActions } from '../_components/docker-page-utilities'
import { useDockerDataTable } from '../_components/use-docker-data-table'
import { formatBytes } from '../_utils/format'
import { VolumesTable } from './_components/volumes-table'
import { filterVolumes, isVolumeInUse, totalReportedBytes } from './_utils/volumes'

const VOLUME_LIST_INPUT = { query: { limit: 100, offset: 0 } } as const
const VOLUME_STREAM_INPUT = { query: {} } as const

const VOLUME_LIST_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  view: z.enum(['all', 'active', 'inactive']).default('all'),
  sortBy: z.enum(['name', 'updated', 'state', 'size']).default('updated'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(20),
})

const VIEW_LABELS = { all: 'All volumes', active: 'In use', inactive: 'Unused' } as const
const SELECT_CLASS = 'h-9 rounded-md border border-border/70 bg-background px-3 text-sm'

export default function DashboardDockerVolumesPage() {
  const [listQuery, setListQuery] = useSafeQueryParamStatesFromZod(VOLUME_LIST_QUERY_SCHEMA)
  const volumeQuery = useDockerVolumeList(VOLUME_LIST_INPUT)
  useDockerVolumeEventsStream(VOLUME_STREAM_INPUT)

  const volumes = useMemo(() => volumeQuery.data?.data ?? [], [volumeQuery.data?.data])
  const filtered = useMemo(
    () => filterVolumes(volumes, { query: listQuery.q, view: listQuery.view }),
    [volumes, listQuery.q, listQuery.view],
  )
  const sorters = useMemo(() => ({
    name: (volume: (typeof volumes)[number]) => volume.name,
    updated: (volume: (typeof volumes)[number]) => new Date(volume.updatedAt).getTime(),
    state: (volume: (typeof volumes)[number]) => volume.usedByContainerIds.length,
    size: (volume: (typeof volumes)[number]) => volume.sizeBytes ?? -1,
  }), [])
  const table = useDockerDataTable({
    data: filtered,
    sortBy: listQuery.sortBy,
    sortDirection: listQuery.sortDirection,
    page: listQuery.page,
    pageSize: listQuery.pageSize,
    sorters,
  })

  useEffect(() => {
    if (table.page !== listQuery.page) setListQuery({ page: table.page })
  }, [listQuery.page, table.page, setListQuery])

  const inUseCount = filtered.filter(isVolumeInUse).length
  const totalBytes = totalReportedBytes(filtered)
  const hasFilters = listQuery.q.trim() !== '' || listQuery.view !== 'all'
  const chips = [
    ...(listQuery.q ? [{ key: 'search', label: 'search', value: listQuery.q }] : []),
    ...(listQuery.view !== 'all' ? [{ key: 'view', label: 'view', value: VIEW_LABELS[listQuery.view] }] : []),
  ]

  if (volumeQuery.isError) {
    return <DockerEngineError what="volumes" error={volumeQuery.error} onRetry={() => { void volumeQuery.refetch() }} isRetrying={volumeQuery.isFetching} />
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={listQuery.q}
            onChange={(event) => { setListQuery({ q: event.target.value, page: 1 }) }}
            placeholder="Search name, mountpoint, driver…"
            aria-label="Search volumes"
            className="h-9 pl-9"
          />
        </div>
        <select
          aria-label="View"
          className={SELECT_CLASS}
          value={listQuery.view}
          onChange={(event) => { setListQuery({ view: VOLUME_LIST_QUERY_SCHEMA.shape.view.parse(event.target.value), page: 1 }) }}
        >
          {Object.entries(VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          aria-label="Sort by"
          className={SELECT_CLASS}
          value={listQuery.sortBy}
          onChange={(event) => { setListQuery({ sortBy: VOLUME_LIST_QUERY_SCHEMA.shape.sortBy.parse(event.target.value), page: 1 }) }}
        >
          <option value="updated">Sort: updated</option>
          <option value="name">Sort: name</option>
          <option value="size">Sort: size</option>
          <option value="state">Sort: usage</option>
        </select>
        <select
          aria-label="Sort direction"
          className={SELECT_CLASS}
          value={listQuery.sortDirection}
          onChange={(event) => { setListQuery({ sortDirection: VOLUME_LIST_QUERY_SCHEMA.shape.sortDirection.parse(event.target.value), page: 1 }) }}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" disabled={volumeQuery.isFetching} onClick={() => { void volumeQuery.refetch() }}>
          <RefreshCw className={volumeQuery.isFetching ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'} aria-hidden />
          {volumeQuery.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DockerActiveFilterChips chips={chips} />
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {volumes.length} volume{volumes.length === 1 ? '' : 's'}: {inUseCount} in use, {filtered.length - inUseCount} unused
          {totalBytes === null ? '' : `, ${formatBytes(totalBytes)} reported`}.
          Creating, removing and pruning volumes is not available here yet.
        </p>
        <div className="ml-auto">
          <DockerExportActions
            filenameBase="docker-volumes"
            rows={filtered.map((volume) => ({
              id: volume.id,
              name: volume.name,
              driver: volume.driver,
              mountpoint: volume.mountpoint,
              sizeBytes: volume.sizeBytes,
              usedByContainers: volume.usedByContainerIds.length,
              updatedAt: volume.updatedAt,
            }))}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
        <VolumesTable
          rows={table.rows}
          isLoading={volumeQuery.isLoading}
          hasFilters={hasFilters}
          totalCount={volumes.length}
          onClearFilters={() => { setListQuery({ q: '', view: 'all', page: 1 }) }}
        />
      </div>

      <DockerTablePagination
        page={table.page}
        pageSize={table.pageSize}
        totalRows={table.totalRows}
        totalPages={table.totalPages}
        from={table.from}
        to={table.to}
        onPageChange={(nextPage) => { setListQuery({ page: nextPage }) }}
        onPageSizeChange={(nextPageSize) => { setListQuery({ pageSize: nextPageSize, page: 1 }) }}
      />
    </section>
  )
}
