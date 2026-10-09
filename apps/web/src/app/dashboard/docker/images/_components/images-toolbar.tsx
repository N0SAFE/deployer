'use client'

import { Download, RefreshCw, Search } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { DockerSavedViewSelect } from '../../_components/docker-operations-controls'
import { DockerActiveFilterChips, DockerExportActions, type FilterChip } from '../../_components/docker-page-utilities'
import { imageFilterConfig, type ImageSavedView, type ImageSortBy, type ImageSortDirection } from '../filter-config'


export interface ImagesFilterState {
  q: string
  view: ImageSavedView
  sortBy: ImageSortBy
  sortDirection: ImageSortDirection
}

const SELECT_CLASS = 'h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm'

function isOption<T extends string>(options: readonly { value: T }[], value: string): value is T {
  return options.some((option) => option.value === value)
}

export function ImagesToolbar({ filters, onChange, onPull, onRefresh, isRefreshing, chips, exportRows }: {
  filters: ImagesFilterState
  onChange: (patch: Partial<ImagesFilterState>) => void
  onPull: () => void
  onRefresh: () => void
  isRefreshing: boolean
  chips: FilterChip[]
  exportRows: Record<string, unknown>[]
}) {
  return (
    <div className="space-y-2 border-b border-border/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={filters.q}
            onChange={(event) => { onChange({ q: event.target.value }) }}
            placeholder="Search images or tags…"
            aria-label="Search images"
            className="h-9 border-border/70 bg-background/70 pl-9"
          />
        </div>
        <DockerSavedViewSelect
          storageKey="docker:images:saved-view"
          value={filters.view}
          onChange={(value) => { if (isOption(imageFilterConfig.savedViewOptions, value)) onChange({ view: value }) }}
          options={[...imageFilterConfig.savedViewOptions]}
        />
        <select
          aria-label="Sort images by"
          className={SELECT_CLASS}
          value={filters.sortBy}
          onChange={(event) => { if (isOption(imageFilterConfig.sortByOptions, event.target.value)) onChange({ sortBy: event.target.value }) }}
        >
          {imageFilterConfig.sortByOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select
          aria-label="Sort direction"
          className={SELECT_CLASS}
          value={filters.sortDirection}
          onChange={(event) => { if (isOption(imageFilterConfig.sortDirectionOptions, event.target.value)) onChange({ sortDirection: event.target.value }) }}
        >
          {imageFilterConfig.sortDirectionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <Button type="button" variant="outline" size="lg" onClick={onPull}>
          <Download aria-hidden />
          Pull image
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw aria-hidden className={isRefreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
          Refresh
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DockerActiveFilterChips chips={chips} />
        <div className="ml-auto">
          <DockerExportActions filenameBase="docker-images" rows={exportRows} />
        </div>
      </div>
    </div>
  )
}
