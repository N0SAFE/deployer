import type { ColumnDef } from '@tanstack/react-table'
import type React from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { DataTableColumnHeader } from '@repo/ui/components/data-table/column-header'
import { Button } from '@repo/ui/components/shadcn/button'
import { ChevronRight, Fingerprint, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ImageGroupRow, ImageTagRow, TagSelectionOption } from './models'
import { formatBytes, formatDate } from './models'

export interface ImageActionMenuOption {
  title: string
  icon: 'run' | 'pull'
  options: TagSelectionOption[]
  emptyMessage: string
  onSelect: (value: string) => void
}

export interface ImageColumnsDeps {
  ActionMenu: React.ComponentType<ImageActionMenuOption>
  getPullOptions: (repositoryKey: string) => TagSelectionOption[]
  buildTagOptions: (group: ImageGroupRow) => TagSelectionOption[]
  onRunSelect: (imageRef: string) => void
  onPullSelect: (imageRef: string) => void
}

export interface ImageSubRowColumnsDeps {
  onOpenImageDetail: (imageId: string) => void
}

export interface ImageTableFetchParams {
  page: number
  limit: number
  search: string
  from_date: string
  to_date: string
  sort_by: string
  sort_order: string
}

export function createImageColumns({
  ActionMenu,
  getPullOptions,
  buildTagOptions,
  onRunSelect,
  onPullSelect,
}: ImageColumnsDeps): ColumnDef<ImageGroupRow>[] {
  return [
    {
      id: 'expand',
      header: () => <span className='sr-only'>Expand</span>,
      cell: ({ row }) => {
        if (!row.getCanExpand()) return null

        return (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              row.toggleExpanded()
            }}
            aria-label={row.getIsExpanded() ? 'Collapse image tags' : 'Expand image tags'}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', row.getIsExpanded() && 'rotate-90')} />
          </Button>
        )
      },
      size: 42,
      enableSorting: false,
      enableResizing: false,
    },
    {
      accessorKey: 'repositoryKey',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Image' />,
      cell: ({ row }) => <span className='font-mono text-xs break-all'>{row.original.repositoryKey}</span>,
      size: 320,
    },
    {
      accessorKey: 'tagsCount',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Tags' />,
      cell: ({ row }) => <Badge className='text-[10px]' variant='outline'>{row.original.tagsCount}</Badge>,
      size: 90,
    },
    {
      accessorKey: 'totalSizeBytes',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Size' />,
      cell: ({ row }) => formatBytes(row.original.totalSizeBytes),
      size: 120,
    },
    {
      accessorKey: 'lastSeenAt',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Updated' />,
      cell: ({ row }) => formatDate(row.original.lastSeenAt),
      size: 180,
    },
    {
      id: 'actions',
      header: () => <span>Actions</span>,
      cell: ({ row }) => {
        const group = row.original
        return (
          <div className='flex items-center gap-1.5'>
            <ActionMenu
              title='Run container from pulled tags'
              icon='run'
              options={buildTagOptions(group)}
              emptyMessage='No pulled tags available'
              onSelect={onRunSelect}
            />
            <ActionMenu
              title='Pull tag from registry'
              icon='pull'
              options={getPullOptions(group.repositoryKey)}
              emptyMessage='No tags discovered for this repository'
              onSelect={onPullSelect}
            />
          </div>
        )
      },
      size: 170,
    },
  ]
}

export function createImageSubRowColumns({ onOpenImageDetail }: ImageSubRowColumnsDeps): ColumnDef<ImageTagRow>[] {
  return [
    {
      accessorKey: 'tag',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Tag' />,
      cell: ({ row }) => (
        <button
          type='button'
          className='group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-medium font-mono transition-colors hover:border-primary/40 hover:bg-primary/10'
          onClick={() => {
            onOpenImageDetail(row.original.id)
          }}
          title='Open image detail'
        >
          <Tag className='h-3 w-3 text-muted-foreground transition-colors group-hover:text-primary' />
          <span className='truncate'>{row.original.tag}</span>
        </button>
      ),
      size: 170,
    },
    {
      accessorKey: 'shortId',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Image ID' />,
      cell: ({ row }) => (
        <button
          type='button'
          className='group inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2 py-1 font-mono text-[11px] text-primary transition-colors hover:border-primary/40 hover:bg-primary/5'
          onClick={() => {
            onOpenImageDetail(row.original.id)
          }}
          title='Open image detail'
        >
          <Fingerprint className='h-3 w-3 text-muted-foreground transition-colors group-hover:text-primary' />
          <span className='truncate'>{row.original.shortId}</span>
        </button>
      ),
      size: 120,
    },
    {
      accessorKey: 'sizeBytes',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Size' />,
      cell: ({ row }) => <span className='text-xs text-muted-foreground'>{formatBytes(row.original.sizeBytes)}</span>,
      size: 110,
    },
    {
      id: 'signals',
      header: () => <span className='text-xs text-muted-foreground'>Health</span>,
      cell: ({ row }) => (
        <div className='flex items-center gap-1.5'>
          <Badge variant='secondary' className='rounded-full border border-border/70 bg-muted/40 px-2 text-[10px]'>
            usage {row.original.usageCount}
          </Badge>
          <Badge
            variant={row.original.failed > 0 ? 'destructive' : 'outline'}
            className='rounded-full border border-border/70 px-2 text-[10px]'
          >
            failed {row.original.failed}
          </Badge>
        </div>
      ),
      size: 180,
    },
    {
      accessorKey: 'lastSeenAt',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Updated' />,
      cell: ({ row }) => <span className='text-xs text-muted-foreground'>{formatDate(row.original.lastSeenAt)}</span>,
      size: 180,
    },
  ]
}

export function createImageTableFetchData(rows: ImageGroupRow[]) {
  return async (params: ImageTableFetchParams) => {
    const { page, limit, search, sort_by, sort_order } = params
    const normalizedSearch = search.trim().toLowerCase()

    const searchableRows = normalizedSearch.length === 0
      ? rows
      : rows.filter((row) => {
        return row.repositoryKey.toLowerCase().includes(normalizedSearch)
          || row.subRows.some((tag) => tag.tag.toLowerCase().includes(normalizedSearch))
      })

    const sortable: Record<string, (row: ImageGroupRow) => string | number> = {
      repositoryKey: (row) => row.repositoryKey,
      tagsCount: (row) => row.tagsCount,
      totalSizeBytes: (row) => row.totalSizeBytes,
      usageCount: (row) => row.usageCount,
      failed: (row) => row.failed,
      lastSeenAt: (row) => new Date(row.lastSeenAt).getTime(),
    }

    const sortKey = sort_by in sortable ? sort_by : 'lastSeenAt'
    const direction = sort_order === 'asc' ? 1 : -1

    const sorted = [...searchableRows].sort((left, right) => {
      const leftValue = sortable[sortKey]?.(left)
      const rightValue = sortable[sortKey]?.(right)
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction
      }
      return String(leftValue ?? '').localeCompare(String(rightValue ?? '')) * direction
    })

    const safePage = Math.max(1, page)
    const safeLimit = Math.max(1, limit)
    const offset = (safePage - 1) * safeLimit
    const paginated = sorted.slice(offset, offset + safeLimit)

    return {
      success: true,
      data: paginated,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total_pages: Math.max(1, Math.ceil(sorted.length / safeLimit)),
        total_items: sorted.length,
      },
    }
  }
}
