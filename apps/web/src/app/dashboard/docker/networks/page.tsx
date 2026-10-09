'use client'

import { useEffect, useMemo } from 'react'
import { z } from 'zod'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'
import { useDockerNetworkEventsStream, useDockerNetworkList } from '@/domains/docker/hooks'
import { DockerEngineError } from '../_components/docker-engine-error'
import { DockerTablePagination } from '../_components/docker-table-pagination'
import { DockerActiveFilterChips, DockerExportActions } from '../_components/docker-page-utilities'
import { useDockerDataTable } from '../_components/use-docker-data-table'
import { NetworksTable } from './_components/networks-table'
import { filterNetworks } from './_utils/networks'

const NETWORK_LIST_INPUT = { query: { limit: 100, offset: 0 } } as const
const NETWORK_STREAM_INPUT = { query: {} } as const

const NETWORK_LIST_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  view: z.enum(['all', 'bridge', 'with-containers', 'unused']).default('all'),
  sortBy: z.enum(['name', 'containers', 'driver']).default('containers'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(20),
})

const VIEW_LABELS = {
  all: 'All networks',
  bridge: 'Bridge driver',
  'with-containers': 'With containers',
  unused: 'Unused',
} as const

const SELECT_CLASS = 'h-9 rounded-md border border-border/70 bg-background px-3 text-sm'

export default function DashboardDockerNetworksPage() {
  const [listQuery, setListQuery] = useSafeQueryParamStatesFromZod(NETWORK_LIST_QUERY_SCHEMA)
  const networkQuery = useDockerNetworkList(NETWORK_LIST_INPUT)
  useDockerNetworkEventsStream(NETWORK_STREAM_INPUT)

  const networks = useMemo(() => networkQuery.data?.data ?? [], [networkQuery.data?.data])
  const filtered = useMemo(
    () => filterNetworks(networks, { query: listQuery.q, view: listQuery.view }),
    [networks, listQuery.q, listQuery.view],
  )
  const sorters = useMemo(() => ({
    name: (network: (typeof networks)[number]) => network.name,
    containers: (network: (typeof networks)[number]) => network.containerIds.length,
    driver: (network: (typeof networks)[number]) => network.driver,
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

  const hasFilters = listQuery.q.trim() !== '' || listQuery.view !== 'all'
  const chips = [
    ...(listQuery.q ? [{ key: 'search', label: 'search', value: listQuery.q }] : []),
    ...(listQuery.view !== 'all' ? [{ key: 'view', label: 'view', value: VIEW_LABELS[listQuery.view] }] : []),
  ]

  if (networkQuery.isError) {
    return <DockerEngineError what="networks" error={networkQuery.error} onRetry={() => { void networkQuery.refetch() }} isRetrying={networkQuery.isFetching} />
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            value={listQuery.q}
            onChange={(event) => { setListQuery({ q: event.target.value, page: 1 }) }}
            placeholder="Search name, ID, subnet…"
            aria-label="Search networks"
            className="h-9 pl-9"
          />
        </div>
        <select
          aria-label="View"
          className={SELECT_CLASS}
          value={listQuery.view}
          onChange={(event) => { setListQuery({ view: NETWORK_LIST_QUERY_SCHEMA.shape.view.parse(event.target.value), page: 1 }) }}
        >
          {Object.entries(VIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          aria-label="Sort by"
          className={SELECT_CLASS}
          value={listQuery.sortBy}
          onChange={(event) => { setListQuery({ sortBy: NETWORK_LIST_QUERY_SCHEMA.shape.sortBy.parse(event.target.value), page: 1 }) }}
        >
          <option value="containers">Sort: containers</option>
          <option value="name">Sort: name</option>
          <option value="driver">Sort: driver</option>
        </select>
        <select
          aria-label="Sort direction"
          className={SELECT_CLASS}
          value={listQuery.sortDirection}
          onChange={(event) => { setListQuery({ sortDirection: NETWORK_LIST_QUERY_SCHEMA.shape.sortDirection.parse(event.target.value), page: 1 }) }}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" disabled={networkQuery.isFetching} onClick={() => { void networkQuery.refetch() }}>
          <RefreshCw className={networkQuery.isFetching ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'} aria-hidden />
          {networkQuery.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DockerActiveFilterChips chips={chips} />
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {networks.length} network{networks.length === 1 ? '' : 's'}. Creating and removing networks is not available here yet.
        </p>
        <div className="ml-auto">
          <DockerExportActions
            filenameBase="docker-networks"
            rows={filtered.map((network) => ({
              id: network.id,
              name: network.name,
              driver: network.driver,
              scope: network.scope,
              subnet: network.subnet,
              containers: network.containerIds.length,
            }))}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
        <NetworksTable
          rows={table.rows}
          isLoading={networkQuery.isLoading}
          hasFilters={hasFilters}
          totalCount={networks.length}
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
