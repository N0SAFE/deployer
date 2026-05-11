import type { ColumnDef } from '@tanstack/react-table'
import type { DockerContainer } from '@repo/contracts-entities'
import type React from 'react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { DataTableColumnHeader } from '@repo/ui/components/data-table/column-header'

export interface ContainerInstanceProjection {
  instanceKey: string
  id: string
  name: string
  status: DockerContainer['status']
  health: DockerContainer['health']
  environment: DockerContainer['environment']
  updatedAt: string
  serviceId: string
}

export interface ContainerProjection {
  id: string
  hash: string
  name: string
  image: string
  imageId: string | null
  status: DockerContainer['status']
  health: DockerContainer['health']
  environment: DockerContainer['environment']
  serviceId: string
  healthCheckUrl: string | null
  domainUrl: string | null
  updatedAt: string
  instanceCount: number
  instanceIds: string[]
  instances: ContainerInstanceProjection[]
}

export interface ContainerTableRow extends ContainerProjection {
  rowId: string
}

export interface ContainerColumnsDeps {
  renderNameCell: (container: ContainerTableRow) => React.ReactNode
  renderImageCell: (container: ContainerTableRow) => React.ReactNode
  renderActionsCell: (container: ContainerTableRow) => React.ReactNode
  getStatusVariant: (status: string) => 'default' | 'secondary' | 'destructive' | 'outline'
}

export interface ContainerTableFetchParams {
  page: number
  limit: number
  search: string
  from_date: string
  to_date: string
  sort_by: string
  sort_order: string
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

export function toContainerTableRows(containers: ContainerProjection[]): ContainerTableRow[] {
  return containers.map((container) => ({
    ...container,
    rowId: container.hash,
  }))
}

export function createContainerColumns({
  renderNameCell,
  renderImageCell,
  renderActionsCell,
  getStatusVariant,
}: ContainerColumnsDeps): ColumnDef<ContainerTableRow, unknown>[] {
  return [
    {
      accessorKey: 'name',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Container' />,
      cell: ({ row }) => renderNameCell(row.original),
      size: 220,
    },
    {
      accessorKey: 'image',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Image' />,
      cell: ({ row }) => renderImageCell(row.original),
      size: 320,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Status' />,
      cell: ({ row }) => (
        <>
          <Badge className='text-[10px]' variant={getStatusVariant(row.original.status)}>{row.original.status}</Badge>
          <span className='ml-2 text-xs text-muted-foreground'>{row.original.health}</span>
        </>
      ),
      size: 160,
    },
    {
      accessorKey: 'environment',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Environment' />,
      cell: ({ row }) => row.original.environment ?? '—',
      size: 120,
    },
    {
      accessorKey: 'serviceId',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Service' />,
      cell: ({ row }) => <span className='font-mono text-xs'>{shortId(row.original.serviceId)}</span>,
      size: 100,
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => <DataTableColumnHeader className='' column={column} title='Updated' />,
      cell: ({ row }) => formatDate(row.original.updatedAt),
      size: 170,
    },
    {
      id: 'actions',
      header: () => <span>Actions</span>,
      cell: ({ row }) => renderActionsCell(row.original),
      size: 150,
    },
  ]
}

export function createContainerTableFetchData(rows: ContainerTableRow[]) {
  return async (params: ContainerTableFetchParams) => {
    const { page, limit, search, sort_by, sort_order } = params
    const normalizedSearch = search.trim().toLowerCase()

    const searchableRows = normalizedSearch.length === 0
      ? rows
      : rows.filter((row) => {
        return row.name.toLowerCase().includes(normalizedSearch)
          || row.image.toLowerCase().includes(normalizedSearch)
          || row.serviceId.toLowerCase().includes(normalizedSearch)
          || row.status.toLowerCase().includes(normalizedSearch)
      })

    const sortable: Record<string, (row: ContainerTableRow) => string | number> = {
      name: (row) => row.name,
      image: (row) => row.image,
      status: (row) => row.status,
      environment: (row) => row.environment ?? '',
      serviceId: (row) => row.serviceId,
      updatedAt: (row) => new Date(row.updatedAt).getTime(),
    }

    const sortKey = sort_by in sortable ? sort_by : 'updatedAt'
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
