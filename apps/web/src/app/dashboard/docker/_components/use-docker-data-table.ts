'use client'

import { useMemo } from 'react'

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

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareSortValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return collator.compare(String(left), String(right))
}

/** Stable sort by one accessor, then slice out one 1-based page. Pure, so it is unit-tested. */
export function sortAndPage<TData>(
  data: readonly TData[],
  accessor: SortAccessor<TData>,
  direction: DockerListSortDirection,
  page: number,
  pageSize: number,
): TData[] {
  const factor = direction === 'desc' ? -1 : 1
  const sorted = data
    .map((row, index) => ({ row, index, value: normalizeSortValue(accessor(row)) }))
    .sort((a, b) => compareSortValues(a.value, b.value) * factor || a.index - b.index)
    .map((entry) => entry.row)
  const start = (page - 1) * pageSize
  return sorted.slice(start, start + pageSize)
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

  const rows = useMemo(
    () => sortAndPage(data, sorters[sortBy], sortDirection, normalizedPage, normalizedPageSize),
    [data, sorters, sortBy, sortDirection, normalizedPage, normalizedPageSize],
  )

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
