'use client'

import type { ReactNode } from 'react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { statusLabel } from '@/components/dashboard'
import { cn } from '@/lib/utils'
import { DockerExportActions } from '../../_components/docker-page-utilities'
import type { ContainerListQuery, ContainerView } from '../_models/container-list.model'

const VIEWS: readonly { value: ContainerView; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Running' },
  { value: 'failed', label: 'Stopped or unhealthy' },
]

function FilterSelect({ label, value, onChange, children }: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <select
      aria-label={label}
      className="h-8 rounded-md border border-border/70 bg-background/70 px-2 text-[0.8125rem]"
      value={value}
      onChange={(event) => { onChange(event.target.value) }}
    >
      {children}
    </select>
  )
}

/** Search, filters, view switch and the primary actions. Filters live in the URL via `onQueryChange`. */
export function ContainersToolbar({
  query,
  statuses,
  environments,
  exportRows,
  filtersActive,
  isRefreshing,
  onQueryChange,
  onClearFilters,
  onCreate,
  onRefresh,
}: {
  query: ContainerListQuery
  statuses: readonly string[]
  environments: readonly string[]
  exportRows: Record<string, unknown>[]
  filtersActive: boolean
  isRefreshing: boolean
  onQueryChange: (patch: Partial<ContainerListQuery>) => void
  onClearFilters: () => void
  onCreate: () => void
  onRefresh: () => void
}) {
  return (
    <div className="space-y-2 border-b border-border/60 bg-background/70 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Search containers"
            value={query.q}
            onChange={(event) => { onQueryChange({ q: event.target.value, page: 1 }) }}
            className="h-8 pl-8"
            placeholder="Search name, image, ID…"
          />
        </div>
        <FilterSelect label="Filter by status" value={query.status} onChange={(status) => { onQueryChange({ status, page: 1 }) }}>
          <option value="all">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </FilterSelect>
        <FilterSelect label="Filter by environment" value={query.environment} onChange={(environment) => { onQueryChange({ environment, page: 1 }) }}>
          <option value="all">All environments</option>
          {environments.map((environment) => <option key={environment} value={environment}>{statusLabel(environment)}</option>)}
        </FilterSelect>
        <FilterSelect
          label="Filter by who manages the container"
          value={query.ownership}
          onChange={(ownership) => {
            onQueryChange({ ownership: ownership === 'deployment_service' || ownership === 'orphan' ? ownership : 'all', page: 1 })
          }}
        >
          <option value="all">Managed and unmanaged</option>
          <option value="deployment_service">Managed by a deployment</option>
          <option value="orphan">Unmanaged</option>
        </FilterSelect>
        {filtersActive ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>Clear filters</Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DockerExportActions compact filenameBase="docker-containers" rows={exportRows} />
          <Button type="button" variant="outline" size="sm" disabled={isRefreshing} onClick={onRefresh}>
            <RefreshCw className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')} />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={onCreate}>
            <Plus />
            Create container
          </Button>
        </div>
      </div>

      <div role="group" aria-label="Quick view" className="flex flex-wrap items-center gap-1.5">
        {VIEWS.map((view) => (
          <Button
            key={view.value}
            type="button"
            size="sm"
            variant={query.view === view.value ? 'secondary' : 'ghost'}
            aria-pressed={query.view === view.value}
            onClick={() => { onQueryChange({ view: view.value, page: 1 }) }}
          >
            {view.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
