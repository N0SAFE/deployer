'use client'

import { useMemo } from 'react'
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'

export type DockerListSortDirection = 'asc' | 'desc'

type SortValue = string | number | boolean | Date | null | undefined

type SortAccessor<TData> = (row: TData) => SortValue

function normalizeSortValue(value: SortValue): string | number {
  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  if (typeof value === 'number') {
    return value
  }

  return value ?? ''
}

export interface UseDockerDataTableOptions<TData, TSortKey extends string> {
  data: TData[]
  sortBy: TSortKey
  sortDirection: DockerListSortDirection
  page: number
  pageSize: number
  sorters: Record<TSortKey, SortAccessor<TData>>
}

export interface UseDockerDataTableResult<TData> {
  rows: TData[]
  totalRows: number
  totalPages: number
  page: number
  pageSize: number
  from: number
  to: number
}

export function useDockerDataTable<TData, TSortKey extends string>({
  data,
  sortBy,
  sortDirection,
  page,
  pageSize,
  sorters,
}: UseDockerDataTableOptions<TData, TSortKey>): UseDockerDataTableResult<TData> {
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20
  const totalRows = data.length
  const totalPages = Math.max(1, Math.ceil(totalRows / normalizedPageSize))
  const normalizedPage = Math.min(Math.max(page, 1), totalPages)

  const columns = useMemo<ColumnDef<TData>[]>(() => {
    return (Object.entries(sorters) as Array<[TSortKey, SortAccessor<TData>]>).map(([columnId, accessor]) => ({
      id: columnId,
      accessorFn: (row) => normalizeSortValue(accessor(row as TData)),
    }))
  }, [sorters])

  const sorting = useMemo<SortingState>(
    () => [{ id: String(sortBy), desc: sortDirection === 'desc' }],
    [sortBy, sortDirection],
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination: {
        pageIndex: normalizedPage - 1,
        pageSize: normalizedPageSize,
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const rows = table.getRowModel().rows.map((row) => row.original)

  const from = totalRows === 0 ? 0 : (normalizedPage - 1) * normalizedPageSize + 1
  const to = totalRows === 0 ? 0 : Math.min(normalizedPage * normalizedPageSize, totalRows)

  return {
    rows,
    totalRows,
    totalPages,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    from,
    to,
  }
}
