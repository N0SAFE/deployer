import type { z } from 'zod'
import type { ImageGroupRow } from './models'

export type ImageSavedView = 'all' | 'failed' | 'popular'
export type ImageSortBy = 'usage' | 'name' | 'failed' | 'lastSeen'
export type ImageSortDirection = 'asc' | 'desc'

export interface ImageFilterConfigOption<TValue extends string> {
  value: TValue
  label: string
}

export interface ImageFilterConfig {
  savedViewOptions: readonly ImageFilterConfigOption<ImageSavedView>[]
  sortByOptions: readonly ImageFilterConfigOption<ImageSortBy>[]
  sortDirectionOptions: readonly ImageFilterConfigOption<ImageSortDirection>[]
}

export const imageFilterConfig: ImageFilterConfig = {
  // Jira-clone style: dedicated filter config exported from a separate module.
  savedViewOptions: [
    { value: 'all', label: 'All' },
    { value: 'failed', label: 'Failed' },
    { value: 'popular', label: 'Popular' },
  ],
  sortByOptions: [
    { value: 'usage', label: 'Sort: Usage' },
    { value: 'name', label: 'Sort: Name' },
    { value: 'failed', label: 'Sort: Failed' },
    { value: 'lastSeen', label: 'Sort: Last seen' },
  ],
  sortDirectionOptions: [
    { value: 'desc', label: 'Desc' },
    { value: 'asc', label: 'Asc' },
  ],
}

export interface ImageListQueryShape {
  q: string
  view: ImageSavedView
  sortBy: ImageSortBy
  sortDirection: ImageSortDirection
  page: number
  pageSize: number
}

export type ImageTableSortKey = 'usageCount' | 'repositoryKey' | 'failed' | 'lastSeenAt'

export function mapImageSortByToTableSort(sortBy: ImageSortBy): ImageTableSortKey {
  switch (sortBy) {
    case 'usage':
      return 'usageCount'
    case 'name':
      return 'repositoryKey'
    case 'failed':
      return 'failed'
    case 'lastSeen':
    default:
      return 'lastSeenAt'
  }
}

export function applyImageFilters(rows: readonly ImageGroupRow[], query: Pick<ImageListQueryShape, 'q' | 'view'>): ImageGroupRow[] {
  const normalizedSearch = query.q.trim().toLowerCase()

  return rows.filter((group) => {
    if (query.view === 'failed' && group.failed === 0) return false
    if (query.view === 'popular' && group.usageCount < 2) return false

    if (!normalizedSearch) return true
    return (
      group.repositoryKey.toLowerCase().includes(normalizedSearch)
      || group.subRows.some((tag) => tag.tag.toLowerCase().includes(normalizedSearch))
    )
  })
}

export function buildImageActiveFilterChips(query: Pick<ImageListQueryShape, 'q' | 'view' | 'sortBy' | 'sortDirection'>) {
  return [
    ...(query.q ? [{ key: 'search', label: 'search', value: query.q }] : []),
    ...(query.view !== 'all' ? [{ key: 'saved-view', label: 'view', value: query.view }] : []),
    ...(query.sortBy !== 'usage' ? [{ key: 'sortBy', label: 'sort', value: query.sortBy }] : []),
    ...(query.sortDirection !== 'desc' ? [{ key: 'sortDirection', label: 'direction', value: query.sortDirection }] : []),
  ]
}

export type ImageListQueryFromSchema<TSchema extends z.ZodTypeAny> = z.infer<TSchema>
