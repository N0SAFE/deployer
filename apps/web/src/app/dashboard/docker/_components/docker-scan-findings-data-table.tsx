'use client'

import { useCallback, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { DataTableColumnHeader } from '@repo/ui/components/data-table/column-header'
import { DataTable } from '@repo/ui/components/data-table/data-table'

export interface DockerScanFindingRow {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: string
  packageName: string
  packageType: string
  currentVersion: string
  fixedVersion: string | null
}

interface DockerScanFindingTableRow extends DockerScanFindingRow {
  rowId: string
  severityRank: number
  [key: string]: string | number | null
}

interface DockerScanFindingsDataTableProps {
  findings: DockerScanFindingRow[]
}

interface DataFetchParams {
  page: number
  limit: number
  search: string
  from_date: string
  to_date: string
  sort_by: string
  sort_order: string
}

const severityRankMap: Record<DockerScanFindingRow['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function normalizeValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).toLowerCase()
    : ''
}

function sortRows(
  rows: DockerScanFindingTableRow[],
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): DockerScanFindingTableRow[] {
  const sorted = [...rows]

  sorted.sort((left, right) => {
    const leftValue = left[sortBy as keyof DockerScanFindingTableRow]
    const rightValue = right[sortBy as keyof DockerScanFindingTableRow]

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue
    }

    const leftText = normalizeValue(leftValue)
    const rightText = normalizeValue(rightValue)
    const compare = leftText.localeCompare(rightText)
    return sortOrder === 'asc' ? compare : -compare
  })

  return sorted
}

export function DockerScanFindingsDataTable({ findings }: DockerScanFindingsDataTableProps) {
  const rows = useMemo<DockerScanFindingTableRow[]>(() => {
    return findings.map((finding) => ({
      ...finding,
      rowId: `${finding.source}:${finding.id}:${finding.packageName}:${finding.currentVersion}`,
      severityRank: severityRankMap[finding.severity],
    }))
  }, [findings])

  const getColumns = useCallback(
    () => {
      const columns: ColumnDef<DockerScanFindingTableRow>[] = [
        {
          accessorKey: 'severity',
          header: ({ column }) => <DataTableColumnHeader column={column} title='Severity' />,
          cell: ({ row }) => (
            <Badge variant={row.original.severityRank >= 3 ? 'destructive' : 'outline'}>
              {row.original.severity}
            </Badge>
          ),
          size: 110,
        },
        {
          accessorKey: 'source',
          header: ({ column }) => <DataTableColumnHeader column={column} title='Source' />,
          cell: ({ row }) => <Badge variant='outline'>{row.original.source}</Badge>,
          size: 120,
        },
        {
          accessorKey: 'packageName',
          header: ({ column }) => <DataTableColumnHeader column={column} title='Package' />,
          size: 210,
        },
        {
          accessorKey: 'packageType',
          header: ({ column }) => <DataTableColumnHeader column={column} title='Type' />,
          size: 140,
        },
        {
          accessorKey: 'currentVersion',
          header: ({ column }) => <DataTableColumnHeader column={column} title='Installed' />,
          cell: ({ row }) => <code className='text-[11px]'>{row.original.currentVersion}</code>,
          size: 130,
        },
        {
          accessorKey: 'fixedVersion',
          header: ({ column }) => <DataTableColumnHeader column={column} title='Fixed' />,
          cell: ({ row }) => <code className='text-[11px]'>{row.original.fixedVersion ?? '—'}</code>,
          size: 130,
        },
        {
          accessorKey: 'id',
          header: ({ column }) => <DataTableColumnHeader column={column} title='CVE' />,
          cell: ({ row }) => <code className='text-[11px]'>{row.original.id}</code>,
          size: 170,
        },
      ]

      return columns
    },
    [],
  )

  const fetchDataFn = useCallback(({ page, limit, search, sort_by, sort_order }: DataFetchParams) => {
    const normalizedSearch = search.trim().toLowerCase()

    const filtered = normalizedSearch.length === 0
      ? rows
      : rows.filter((row) => {
        return [
          row.id,
          row.severity,
          row.source,
          row.packageName,
          row.packageType,
          row.currentVersion,
          row.fixedVersion ?? '',
        ].some((candidate) => candidate.toLowerCase().includes(normalizedSearch))
      })

    const sortBy = sort_by in (filtered[0] ?? {}) ? sort_by : 'severityRank'
    const sortOrder: 'asc' | 'desc' = sort_order === 'asc' ? 'asc' : 'desc'
    const sorted = sortRows(filtered, sortBy, sortOrder)

    const safeLimit = limit > 0 ? limit : 10
    const safePage = page > 0 ? page : 1
    const offset = (safePage - 1) * safeLimit
    const paginated = sorted.slice(offset, offset + safeLimit)

    return Promise.resolve({
      success: true,
      data: paginated,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total_pages: Math.max(1, Math.ceil(sorted.length / safeLimit)),
        total_items: sorted.length,
      },
    })
  }, [rows])

  const exportConfig = useMemo(() => {
    return {
      entityName: 'docker-scan-findings',
      headers: ['severity', 'source', 'packageName', 'packageType', 'currentVersion', 'fixedVersion', 'id'],
      columnMapping: {
        severity: 'Severity',
        source: 'Source',
        packageName: 'Package',
        packageType: 'Type',
        currentVersion: 'Installed',
        fixedVersion: 'Fixed',
        id: 'CVE',
      },
      columnWidths: [{ wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 22 }],
      enableCsv: true,
      enableExcel: true,
    }
  }, [])

  return (
    <DataTable<DockerScanFindingTableRow, unknown>
      getColumns={getColumns}
      fetchDataFn={fetchDataFn}
      exportConfig={exportConfig}
      idField='rowId'
      pageSizeOptions={[10, 20, 50, 100]}
      config={{
        enableRowSelection: false,
        enableClickRowSelect: false,
        enableDateFilter: false,
        enableColumnFilters: false,
        enableColumnVisibility: true,
        enableSearch: true,
        enableExport: true,
        enableUrlState: false,
        enableColumnResizing: true,
        enableKeyboardNavigation: true,
        defaultSortBy: 'severityRank',
        defaultSortOrder: 'desc',
        searchPlaceholder: 'Search CVE, package, source…',
        columnResizingTableId: 'docker-security-findings-table',
        size: 'sm',
      }}
    />
  )
}
